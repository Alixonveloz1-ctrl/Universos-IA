import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { Transaction } from "@google-cloud/firestore";
import { db } from "./google";
import { assert } from "../errors";
import { validateChapterBible, validateChapterPlan } from "../continuity/chapters";
import { blocksNewJob } from "../job-state";
import { affected, prerequisites } from "../continuity/rules";
import {
  bible,
  plan,
  story,
  state,
  validatePlan,
  type Action,
  universe,
  idea,
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
export async function deleteEmptyUniverse(id: string) {
  await db().runTransaction(async tx => {
    const ref = projectRef(id);
    const p = (await tx.get(ref)).data() as Project | undefined;
    assert(p?.owner === "personal", "Universo no encontrado.");
    assert(p.automaticUniverse && (!p.universeId || p.universeId === `story-${id}`) &&
      (p.chapterNumber || 1) === 1 && !p.previousChapter && !p.nextChapterId &&
      !p.story && !p.bible && !p.plan,
      "Solo puedes borrar un universo sin historia desarrollada ni capítulos.");
    const [assets, targets, narratives, exports, jobs] = await Promise.all([
      tx.get(ref.collection("assets")), tx.get(ref.collection("targets")),
      tx.get(ref.collection("narratives")), tx.get(ref.collection("exports")),
      tx.get(db().collection("jobs").where("projectId", "==", id)),
    ]);
    assert(!assets.docs.length && !targets.docs.length && !narratives.docs.length && !exports.docs.length,
      "Este universo ya tiene material producido; no se puede borrar como borrador.");
    assert(jobs.docs.length < 50 && jobs.docs.every(s => {
      const j = s.data() as Job;
      return ["failed", "stopped", "completed"].includes(j.state) &&
        !(j.leaseUntil > Date.now()) && !j.checkpoint?.pendingCall &&
        !j.checkpoint?.operation && ["ideas", "story"].includes(j.type);
    }), "Hay una generación activa o pendiente. No se borró nada.");
    assert(!p.activeJobId || jobs.docs.some(s => s.id === p.activeJobId),
      "No se pudo comprobar el último trabajo. No se borró nada.");
    let savedUniverse;
    if (p.universeId) {
      savedUniverse = (await tx.get(db().doc(`universes/${p.universeId}`))).data();
      assert(savedUniverse?.projectId === id, "Este universo tiene otra referencia y no se puede borrar.");
    }
    const checkpoints = await Promise.all(jobs.docs.map(s =>
      tx.get(db().doc(`jobs/${s.id}`).collection("checkpoints"))));
    assert(checkpoints.reduce((n, q) => n + q.docs.length, 0) < 400,
      "Demasiados intentos para borrar de una sola vez.");
    for (let i = 0; i < jobs.docs.length; i++) {
      for (const c of checkpoints[i].docs)
        tx.delete(db().doc(`jobs/${jobs.docs[i].id}`).collection("checkpoints").doc(c.id));
      tx.delete(db().doc(`jobs/${jobs.docs[i].id}`));
    }
    if (p.universeId) tx.delete(db().doc(`universes/${p.universeId}`));
    tx.delete(ref);
  });
}
export async function recoverReviewedIdeas(id: string) {
  return db().runTransaction(async tx => {
    const ref = db().doc(`jobs/${id}`);
    const j = (await tx.get(ref)).data() as Job | undefined;
    assert(j?.type === "ideas" && j.state === "failed" && j.error?.code === "CONTINUITY" &&
      !(j.leaseUntil > Date.now()) && !j.checkpoint?.pendingCall,
      "Este intento no tiene tres propuestas recuperables.");
    const project = projectRef(j.projectId);
    const p = (await tx.get(project)).data() as Project | undefined;
    assert(p?.owner === "personal" && p.activeJobId === id &&
      p.revision === j.snapshot.project.revision && !p.nextChapterId,
      "La historia cambió; no se modificaron sus propuestas.");
    const schema = z.object({ ideas: z.array(idea.extend({ universe })).length(3) }).strict()
      .refine(v => new Set(v.ideas.map(i => i.id)).size === 3);
    const latest = await tx.get(ref.collection("checkpoints").doc("director_1"));
    const original = await tx.get(ref.collection("checkpoints").doc("director_0"));
    const candidate = [latest.data()?.value, original.data()?.value]
      .map(v => schema.safeParse(v)).find(v => v.success);
    assert(candidate?.success, "No hay tres propuestas completas guardadas.");
    const ideas = j.optionId
      ? p.ideas.map(i => i.id === j.optionId ? { ...candidate.data.ideas[0], id: i.id } : i)
      : candidate.data.ideas;
    assert(ideas.length === 3, "No hay tres propuestas para recuperar.");
    tx.update(project, { ideas, revision: p.revision + 1, updatedAt: Date.now() });
    tx.update(ref, { state: "completed", error: null, checkpoint: { ...j.checkpoint, recoveredFromReview: true } });
    return { recovered: true, projectId: p.id };
  });
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
  assert(!input.universeId, "Cada historia nueva crea su propio universo. Usa Crear siguiente capítulo para continuar.");
  const u = {
    name: "Pendiente de elegir historia", beings: input.beings, visualStyle: input.visualStyle,
    environment: "El Director propondrá el entorno según cada historia.",
    worldRules: "El Director definirá reglas coherentes con cada propuesta.", characterCanon: "", revision: 0,
  };
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
      chapterNumber: 1,
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
    assert(!p.nextChapterId, "Este capítulo ya tiene continuación y se conserva como historial.");
    if (change.models && !change.selectedIdeaId && !change.kind && !change.versionId && !change.approve && change.data === undefined) {
      // Models are preferences for future jobs; an executing snapshot stays unchanged.
      const active = p.activeJobId ? (await tx.get(db().doc(`jobs/${p.activeJobId}`))).data() as Job | undefined : undefined;
      if (active?.state === "queued" && active.attempts === 0 && !(active.leaseUntil > Date.now()) && !active.checkpoint.pendingCall && !active.checkpoint.operation)
        tx.update(db().doc(`jobs/${active.id}`), { state: "stopped", stopRequested: true, error: null, checkpoint: { ...active.checkpoint, closedAt: Date.now(), reason: "models-changed-before-start" } });
      const updated = { models: change.models, updatedAt: Date.now() };
      tx.update(projectRef(projectId), updated);
      return { ...p, ...updated };
    }
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
        const universeId = `story-${p.id}`;
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
        if (t.approvedVersionId && !(p.previousChapter && ["character", "location"].includes(t.role)))
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
            : validatePlan(data, s.bible!, !!p.previousChapter);
      if (kind === "bible") validateChapterBible(p, bible.parse(data));
      if (kind === "plan") validateChapterPlan(p, plan.parse(data));
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
            needsReview: !!old?.approvedVersionId && !(p.previousChapter && JSON.stringify(s.bible?.[t.role === "character" ? "characters" : "locations"].find(x => x.id === t.entityId)) === JSON.stringify(b[t.role === "character" ? "characters" : "locations"].find(x => x.id === t.entityId))),
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
          kind !== "plan" &&
          !(p.previousChapter && ["character", "location"].includes(t.role))
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
    assert(!p.nextChapterId, "Este capítulo ya tiene continuación y se conserva como historial.");
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
    assert(!p.nextChapterId, "Este capítulo ya tiene continuación y se conserva como historial.");
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
      const neverStarted = j.state === "queued" && j.attempts === 0 && !(j.leaseUntil > Date.now()) && !j.checkpoint.pendingCall && !j.checkpoint.operation;
      tx.update(ref, { stopRequested: true, ...(neverStarted ? { state: "stopped" } : {}) });
      return j;
    }
    const p = (await tx.get(projectRef(j.projectId))).data() as Project;
    assert(p?.activeJobId === id, "Este intento ya no es el trabajo activo.");
    assert(!p.nextChapterId, "Este capítulo ya tiene continuación y se conserva como historial.");
    assert(
      !j.checkpoint.closedAt,
      "El intento fue cerrado y no puede ejecutarse otra vez.",
    );
    assert(j.leaseUntil < Date.now(), "El ejecutor sigue activo.");
    assert(j.state !== "completed", "Trabajo ya completado.");
    assert(!(j.state === "queued" && (j.operationName || j.executionName)),
      "Google ya recibió este trabajo. Espera a que termine la comprobación antes de reanudar.");
    tx.update(ref, { stopRequested: false, state: "queued", error: null, executionName: "", operationName: "", dispatchedAt: Date.now() });
    return { ...j, stopRequested: false, state: "queued" as const, executionName: "", operationName: "" };
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

export async function createNextChapter(projectId: string, revision: number) {
  return db().runTransaction(async (tx) => {
    const s = await readSnapshot(projectId, tx), p = s.project;
    if (p.nextChapterId) {
      const existing = (await tx.get(projectRef(p.nextChapterId))).data() as Project;
      assert(existing?.previousChapter?.projectId === p.id && existing.universeId === p.universeId, "Continuación no disponible.");
      return existing;
    }
    assert(p.revision === revision, "El capítulo cambió. Actualiza.", "REVISION");
    assert(p.universeId, "Elige primero la historia de este universo.");
    const exports = await tx.get(projectRef(p.id).collection("exports"));
    const active = p.activeJobId ? (await tx.get(db().doc(`jobs/${p.activeJobId}`))).data() as Job | undefined : undefined;
    assert(!active || !blocksNewJob(active), "Espera a que termine el trabajo actual.");
    prerequisites(s, { type: "finalize", expectedRevision: revision, requestId: randomUUID(), instructions: "" });
    const clips = s.targets.filter(t => t.role === "clip").sort((a, b) => a.clipNumber! - b.clipNumber!);
    const manifest = clips.map(t => t.approvedVersionId);
    const completed = exports.docs.map(d => d.data()).filter(e => e.state === "completed" && JSON.stringify(e.approvedClipVersionIds) === JSON.stringify(manifest)).sort((a, b) => b.createdAt - a.createdAt)[0];
    assert(completed, "Une primero los ocho clips aprobados de este capítulo.");
    const lastClip = s.assets.find(a => a.id === clips[7].approvedVersionId);
    assert(lastClip?.lastFrameObject, "Falta el fotograma final del capítulo anterior.");
    const { versionId: _versionId, ...observedEnd } = s.observed[clips[7].id] as Record<string, unknown>;
    void _versionId;
    const finalState = state.parse(observedEnd);
    const now = Date.now(), nextId = randomUUID();
    const next: Project = {
      id: nextId, owner: "personal", universeId: p.universeId, universeSnapshot: p.universeSnapshot,
      automaticUniverse: false, chapterNumber: (p.chapterNumber || 1) + 1, rootProjectId: p.rootProjectId || p.id,
      title: `${p.universeSnapshot.name} · Capítulo ${(p.chapterNumber || 1) + 1}`,
      genre: p.genre, subgenre: p.subgenre, plotType: p.plotType, tone: p.tone, ending: p.ending,
      language: p.language, accent: p.accent, models: p.models, revision: 0, stage: "ideas", ideas: [],
      bible: { ...p.bible!, approvedAt: 0 },
      history: [...(p.history || []), { projectId: p.id, chapterNumber: p.chapterNumber || 1, title: p.title, story: p.story!.data, finalState, exportId: completed.id }],
      previousChapter: { projectId: p.id, exportId: completed.id, finalState, lastClip, bible: s.bible! },
      createdAt: now, updatedAt: now,
    };
    assert(Buffer.byteLength(JSON.stringify(next)) < 400000, "El historial supera el tamaño admitido; no se ha recortado ni perdido información.");
    const canonical = s.targets.filter(t => ["character", "location"].includes(t.role));
    for (const t of canonical) {
      const asset = s.assets.find(a => a.id === t.approvedVersionId);
      assert(asset && !t.needsReview, "Aprueba las referencias de personajes y escenarios antes de continuar.");
    }
    tx.create(projectRef(next.id), next);
    for (const t of canonical) {
      const asset = s.assets.find(a => a.id === t.approvedVersionId)!;
      tx.create(projectRef(next.id).collection("targets").doc(t.id), { ...t, needsReview: false });
      tx.create(projectRef(next.id).collection("assets").doc(asset.id), asset);
    }
    tx.update(projectRef(p.id), { nextChapterId: next.id, updatedAt: now });
    return next;
  });
}
