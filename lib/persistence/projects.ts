import { randomUUID, createHash } from "node:crypto";
import type { Transaction } from "@google-cloud/firestore";
import { db } from "./google";
import { assert } from "../errors";
import { blocksNewJob } from "../job-state";
import { affected, prerequisites } from "../continuity/rules";
import {
  bible,
  plan,
  story,
  state,
  validatePlan,
  type Action,
  type Universe,
  universe,
  projectInput,
} from "../schemas";
import type {
  Asset,
  Job,
  Narrative,
  Project,
  Snapshot,
  Target,
} from "../types";
export const projectRef = (id: string) => db().collection("projects").doc(id);
export async function getProject(id: string) {
  const p = (await projectRef(id).get()).data() as Project | undefined;
  assert(p?.owner === "personal", "Historia no encontrada.");
  return p;
}
export async function readSnapshot(
  id: string,
  tx?: Transaction,
): Promise<Snapshot> {
  const ref = projectRef(id);
  const read = async (collection: string) =>
    tx
      ? await tx.get(ref.collection(collection))
      : await ref.collection(collection).get();
  const p = (tx ? await tx.get(ref) : await ref.get()).data() as
    | Project
    | undefined;
  assert(p?.owner === "personal", "Historia no encontrada.");
  const [t, a, o] = await Promise.all([
    read("targets"),
    read("assets"),
    read("observed"),
  ]);
  return {
    project: p,
    targets: t.docs.map((d) => d.data() as Target),
    assets: a.docs.map((d) => d.data() as Asset),
    bible: p.bible ? bible.parse(p.bible.data) : null,
    plan: p.plan ? plan.parse(p.plan.data) : null,
    observed: Object.fromEntries(o.docs.map((d) => [d.id, d.data()])),
  };
}
export async function createProject(
  input: ReturnType<typeof projectInput.parse>,
) {
  const u = input.universeId
    ? (await db().doc(`universes/${input.universeId}`).get()).data() as (Universe & { revision: number }) | undefined
    : {
        name: "Pendiente de elegir historia",
        beings: input.beings,
        visualStyle: input.visualStyle,
        environment: "El Director propondrá el entorno según cada historia.",
        worldRules: "El Director definirá reglas coherentes con cada propuesta.",
        characterCanon: "",
        revision: 0,
      };
  assert(u, "Universo no encontrado.");
  const now = Date.now(),
    p: Project = {
      ...input,
      universeId: input.universeId || "",
      automaticUniverse: !input.universeId,
      id: randomUUID(),
      owner: "personal",
      universeSnapshot: u,
      title: "Nueva historia",
      revision: 0,
      stage: "ideas",
      ideas: [],
      createdAt: now,
      updatedAt: now,
    };
  await projectRef(p.id).create(p);
  return p;
}
export async function enqueue(projectId: string, a: Action) {
  const now = Date.now(),
    jobId = createHash("sha256")
      .update(projectId + ":" + a.requestId)
      .digest("hex");
  return db().runTransaction(async (tx) => {
    const jr = db().doc(`jobs/${jobId}`),
      old = await tx.get(jr);
    if (old.exists) {
      const previous = old.data() as Job;
      assert(
        previous.type === a.type &&
          previous.targetId === a.targetId &&
          previous.optionId === a.optionId &&
          previous.instructions === a.instructions &&
          previous.snapshot.project.revision === a.expectedRevision,
        "La clave de idempotencia ya pertenece a otra solicitud.",
      );
      return previous;
    }
    const s = await readSnapshot(projectId, tx);
    prerequisites(s, a);
    if (s.project.activeJobId) {
      const active = (
        await tx.get(db().doc(`jobs/${s.project.activeJobId}`))
      ).data() as Job;
      if (
        active &&
        ["queued", "running", "waiting", "needsReview"].includes(
          active.state,
        ) &&
        active.type === a.type &&
        active.targetId === a.targetId &&
        active.optionId === a.optionId &&
        active.instructions === a.instructions &&
        active.snapshot.project.revision === a.expectedRevision
      )
        return active;
      assert(
        active && !blocksNewJob(active),
        "Ya hay un trabajo activo o ambiguo. Revísalo antes de generar.",
      );
    }
    if (a.optionId)
      assert(
        s.project.ideas.some((i) => i.id === a.optionId),
        "Propuesta no encontrada.",
      );
    const selected = s.assets.filter((x) =>
      s.targets.some((t) => t.approvedVersionId === x.id),
    );
    s.assets = selected;
    if (a.type === "finalize")
      s.manifest = s.targets
        .filter((t) => t.role === "clip")
        .sort((a, b) => a.clipNumber! - b.clipNumber!)
        .map((t) => t.approvedVersionId!);
    assert(
      Buffer.byteLength(JSON.stringify(s)) < 650000,
      "La historia excede el tamaño admitido para una operación.",
    );
    const job: Job = {
      id: jobId,
      projectId,
      type: a.type,
      ...(a.targetId ? { targetId: a.targetId } : {}),
      ...(a.optionId ? { optionId: a.optionId } : {}),
      instructions: a.instructions,
      state: "queued",
      requestId: a.requestId,
      snapshot: s,
      createdAt: now,
      heartbeat: now,
      leaseOwner: null,
      leaseUntil: 0,
      attempts: 0,
      stopRequested: false,
      checkpoint: {},
    };
    tx.create(jr, job);
    tx.update(projectRef(projectId), { activeJobId: jobId, updatedAt: now });
    return job;
  });
}
export async function editProject(
  projectId: string,
  revision: number,
  change: {
    selectedIdeaId?: string;
    kind?: "story" | "bible" | "plan";
    data?: unknown;
    approve?: boolean;
    versionId?: string;
    models?: Project["models"];
  },
) {
  return db().runTransaction(async (tx) => {
    const s = await readSnapshot(projectId, tx),
      p = s.project;
    assert(
      p.revision === revision,
      "La historia cambió. Actualiza.",
      "REVISION",
    );
    const patch: Partial<Project> = {
      revision: p.revision + 1,
      updatedAt: Date.now(),
    };
    // Read a restored narrative before scheduling any writes in the transaction.
    let kind = change.kind;
    let candidate: Narrative | undefined;
    if (change.versionId) {
      const v = await tx.get(
        projectRef(projectId).collection("narratives").doc(change.versionId),
      );
      candidate = v.data() as Narrative | undefined;
      assert(candidate, "Versión narrativa no encontrada.");
      kind = candidate.kind;
    }
    if (change.models) patch.models = change.models;
    if (change.selectedIdeaId) {
      const idea = p.ideas.find((i) => i.id === change.selectedIdeaId);
      assert(idea, "Propuesta no encontrada.");
      if (p.automaticUniverse) {
        const generated = universe.parse(idea.universe);
        const universeId = `story-${p.id}-${idea.id}`;
        const saved = {
          ...generated,
          beings: p.universeSnapshot.beings,
          visualStyle: p.universeSnapshot.visualStyle,
          revision: 1,
        };
        tx.set(db().doc(`universes/${universeId}`), { ...saved, projectId: p.id });
        patch.universeId = universeId;
        patch.universeSnapshot = saved;
      }
      patch.selectedIdeaId = idea.id;
      patch.title = idea.title;
      patch.stage = "story";
      if (p.story) patch.story = { ...p.story, approvedAt: 0 };
      if (p.bible) patch.bible = { ...p.bible, approvedAt: 0 };
      if (p.plan) patch.plan = { ...p.plan, approvedAt: 0 };
      for (const t of s.targets)
        if (t.approvedVersionId)
          tx.update(projectRef(projectId).collection("targets").doc(t.id), {
            needsReview: true,
          });
    }
    if (kind) {
      if (kind === "bible") assert(p.story?.approvedAt, "Aprueba la historia.");
      if (kind === "plan")
        prerequisites(s, {
          type: "plan",
          expectedRevision: revision,
          requestId: randomUUID(),
          instructions: "",
        });
      let data = change.data ?? candidate?.data ?? p[kind]?.data;
      data =
        kind === "story"
          ? story.parse(data)
          : kind === "bible"
            ? bible.parse(data)
            : validatePlan(data, s.bible!);
      const v: Narrative = {
        id: randomUUID(),
        kind,
        data,
        sourceRevision: p.revision,
        createdAt: Date.now(),
        ...(change.approve ? { approvedAt: Date.now() } : {}),
      };
      patch[kind] = v;
      tx.create(projectRef(projectId).collection("narratives").doc(v.id), v);
      patch.stage = change.approve
        ? kind === "story"
          ? "bible"
          : kind === "bible"
            ? "references"
            : "images"
        : kind;
      if (kind === "bible") {
        const b = bible.parse(data);
        const desired = [
          ...b.characters.map((c) => ({
            id: "character_" + c.id,
            role: "character" as const,
            entityId: c.id,
          })),
          ...b.locations.map((l) => ({
            id: "location_" + l.id,
            role: "location" as const,
            entityId: l.id,
          })),
        ];
        for (const t of desired) {
          const old = s.targets.find((x) => x.id === t.id);
          tx.set(projectRef(projectId).collection("targets").doc(t.id), {
            ...t,
            kind: "image",
            instructions: old?.instructions || "",
            needsReview: !!old?.approvedVersionId,
            ...(old?.approvedVersionId
              ? { approvedVersionId: old.approvedVersionId }
              : {}),
          });
        }
        for (const t of s.targets.filter(
          (t) =>
            ["character", "location"].includes(t.role) &&
            !desired.some((x) => x.id === t.id),
        ))
          tx.delete(projectRef(projectId).collection("targets").doc(t.id));
      }
      if (kind === "plan") {
        const q = plan.parse(data),
          desired: Target[] = q.clips.flatMap((c) => [
            {
              id: "clip_" + c.number,
              kind: "video" as const,
              role: "clip" as const,
              entityId: String(c.number),
              clipNumber: c.number,
              instructions: "",
              needsReview: false,
            },
            ...c.shots.map((sh) => ({
              id: "shot_" + sh.id,
              kind: "image" as const,
              role: "shot" as const,
              entityId: sh.id,
              clipNumber: c.number,
              instructions: "",
              needsReview: false,
            })),
          ]);
        for (const t of desired) {
          const old = s.targets.find((x) => x.id === t.id);
          const changed =
            JSON.stringify(s.plan?.clips[(t.clipNumber || 1) - 1]) !==
            JSON.stringify(q.clips[(t.clipNumber || 1) - 1]);
          tx.set(projectRef(projectId).collection("targets").doc(t.id), {
            ...t,
            instructions: old?.instructions || "",
            needsReview:
              !!old?.needsReview || (!!old?.approvedVersionId && changed),
            ...(old?.approvedVersionId
              ? { approvedVersionId: old.approvedVersionId }
              : {}),
          });
        }
        for (const t of s.targets.filter(
          (t) =>
            ["shot", "clip"].includes(t.role) &&
            !desired.some((x) => x.id === t.id),
        ))
          tx.delete(projectRef(projectId).collection("targets").doc(t.id));
      }
      // Narrative changes invalidate approvals without deleting historical documents or assets.
      if (kind === "story") {
        if (p.bible) patch.bible = { ...p.bible, approvedAt: 0 };
        if (p.plan) patch.plan = { ...p.plan, approvedAt: 0 };
      }
      if (kind === "bible" && p.plan) patch.plan = { ...p.plan, approvedAt: 0 };
      for (const t of s.targets)
        if (
          t.approvedVersionId &&
          !(kind === "bible" && ["character", "location"].includes(t.role)) &&
          kind !== "plan"
        )
          tx.update(projectRef(projectId).collection("targets").doc(t.id), {
            needsReview: true,
          });
    }
    tx.update(projectRef(projectId), patch);
    return { ...p, ...patch };
  });
}
export async function approveAsset(
  projectId: string,
  targetId: string,
  versionId: string,
  revision: number,
  observed?: unknown,
) {
  await db().runTransaction(async (tx) => {
    const s = await readSnapshot(projectId, tx),
      p = s.project;
    assert(
      p.revision === revision,
      "La historia cambió. Actualiza.",
      "REVISION",
    );
    const t = s.targets.find((x) => x.id === targetId),
      v = s.assets.find((x) => x.id === versionId);
    assert(
      t && v && v.targetId === targetId && v.status !== "rejected",
      "Versión no aprobable.",
    );
    prerequisites(s, {
      type: t.kind,
      targetId: t.id,
      expectedRevision: revision,
      requestId: randomUUID(),
      instructions: "",
    });
    const obs = t.kind === "video" ? state.parse(observed) : null;
    if (obs)
      assert(
        obs.characters.every((c) =>
          s.bible?.characters.some((x) => x.id === c.characterId),
        ),
        "El estado observado contiene personajes ajenos.",
      );
    const previousObserved = s.observed[t.id] as Record<string, unknown> | undefined;
    const observedChanged = obs && JSON.stringify({ ...obs, versionId: v.id }) !== JSON.stringify(previousObserved);
    const changes = t.approvedVersionId !== v.id || observedChanged
      ? affected(t, s.targets, s.assets, t.approvedVersionId)
      : new Set<string>();
    tx.update(projectRef(projectId).collection("targets").doc(t.id), {
      approvedVersionId: v.id,
      needsReview: false,
    });
    if (obs)
      tx.set(projectRef(projectId).collection("observed").doc(t.id), {
        ...obs,
        versionId: v.id,
      });
    for (const id of changes)
      tx.update(projectRef(projectId).collection("targets").doc(id), {
        needsReview: true,
      });
    tx.create(projectRef(projectId).collection("approvals").doc(randomUUID()), {
      targetId,
      versionId,
      by: "personal",
      at: Date.now(),
      sourceRevisions: v.sourceRevisions,
    });
    tx.update(projectRef(projectId), {
      revision: p.revision + 1,
      updatedAt: Date.now(),
    });
  });
}
export async function resolveReview(
  projectId: string,
  targetId: string,
  revision: number,
  note: string,
) {
  await db().runTransaction(async (tx) => {
    const p = (await tx.get(projectRef(projectId))).data() as Project;
    const ref = projectRef(projectId).collection("targets").doc(targetId);
    const t = (await tx.get(ref)).data() as Target;
    assert(
      p?.revision === revision && t?.approvedVersionId,
      "Revisión no disponible",
    );
    assert(note.trim().length > 0, "Explica la comprobación de continuidad.");
    tx.update(ref, { needsReview: false });
    tx.create(projectRef(projectId).collection("reviews").doc(randomUUID()), {
      targetId,
      versionId: t.approvedVersionId,
      note,
      at: Date.now(),
    });
    tx.update(projectRef(projectId), { revision: p.revision + 1 });
  });
}
export async function jobControl(id: string, operation: "stop" | "resume") {
  return db().runTransaction(async (tx) => {
    const ref = db().doc(`jobs/${id}`),
      j = (await tx.get(ref)).data() as Job;
    assert(j, "Trabajo no encontrado");
    if (operation === "stop") {
      tx.update(ref, { stopRequested: true });
      return j;
    }
    const p = (await tx.get(projectRef(j.projectId))).data() as Project;
    assert(p?.activeJobId === id, "Este intento ya no es el trabajo activo.");
    assert(
      !j.checkpoint.closedAt,
      "El intento fue cerrado y no puede ejecutarse otra vez.",
    );
    assert(j.leaseUntil < Date.now(), "El ejecutor sigue activo.");
    assert(j.state !== "completed", "Trabajo ya completado.");
    tx.update(ref, { stopRequested: false, state: "queued", error: null });
    return { ...j, stopRequested: false, state: "queued" as const };
  });
}

export async function closeAmbiguousJob(
  id: string,
  note: string,
  acknowledged: boolean,
) {
  assert(
    acknowledged && note.trim().length > 0,
    "Confirma que revisaste el intento y su posible consumo de créditos.",
  );
  return db().runTransaction(async (tx) => {
    const ref = db().doc(`jobs/${id}`);
    const j = (await tx.get(ref)).data() as Job;
    assert(
      j && j.state === "needsReview" && !j.checkpoint.operation,
      "El intento no admite cierre manual.",
    );
    assert(j.leaseUntil < Date.now(), "El ejecutor sigue activo.");
    assert(
      j.checkpoint.reconciledAt,
      "Comprueba la recuperación antes de cerrar este intento.",
    );
    const p = (await tx.get(projectRef(j.projectId))).data() as Project;
    assert(p?.activeJobId === id, "El trabajo activo cambió.");
    const resolution = {
      closedAt: Date.now(),
      note: note.trim(),
      acknowledgedPossibleCharge: true,
    };
    tx.update(ref, {
      state: "failed",
      checkpoint: { ...j.checkpoint, ...resolution },
    });
    tx.create(projectRef(j.projectId).collection("reviews").doc(randomUUID()), {
      jobId: id,
      type: "ambiguous-attempt-closed",
      ...resolution,
    });
    // Preserve submitted, snapshot and every asset. This does not dispatch anything.
    return { id, state: "failed" as const };
  });
}
