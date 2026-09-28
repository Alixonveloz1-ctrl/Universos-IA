import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { Transaction } from "@google-cloud/firestore";
import type { SaveOptions } from "@google-cloud/storage";
import { db, privateObject, objectPath, googleAuth } from "../lib/persistence/google";
import { imageLimits } from "../lib/models";
import { imageReferenceIds } from "../lib/continuity/rules";
import { config } from "../lib/config";
import { AppError, assert, safeError, logFailure } from "../lib/errors";
import { projectRef } from "../lib/persistence/projects";
import {
  compileImagePrompt,
  compileVideoPrompt,
  runDirector,
  reviewClipTiming,
  directPrompt,
} from "../lib/director";
import {
  imageGenerate,
  pollVideo,
  startVideo,
  type ImageRef,
} from "../lib/providers/vertex";
import { assemble, lastFrame, probe, validateMedia } from "./media";
import type { Asset, Job, Narrative, Project, Target } from "../lib/types";
import { recoverImage, recoverVideo, assertNoPendingCall } from "./recovery";
const LEASE = 180000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function saveVerifiedObject(key: string, data: Buffer | string, options: SaveOptions = {}) {
  const file = privateObject(key);
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  // The SDK upload has returned incorrect bytes in the deployed environment.
  // Never accept an asset until we have read the original bytes back.
  if (!process.env.VERCEL) {
    await file.save(bytes, { ...options, validation: false });
    const [stored] = await file.download({ validation: false });
    if (stored.equals(bytes)) return;
    console.error(`La biblioteca de Storage devolvió ${stored.length} bytes; se enviaron ${bytes.length}. Reintentando con la API de Google.`);
    await file.delete();
  }
  const token = await googleAuth().getAccessToken();
  assert(token, "No se pudo autenticar la subida al bucket.", "STORAGE_AUTH");
  const encoded = encodeURIComponent(key),
    base = `https://storage.googleapis.com/storage/v1/b/${config().bucket}/o/${encoded}`,
    upload = new URL(`https://storage.googleapis.com/upload/storage/v1/b/${config().bucket}/o`);
  upload.searchParams.set("uploadType", "media");
  upload.searchParams.set("name", key);
  if (options.preconditionOpts?.ifGenerationMatch === 0)
    upload.searchParams.set("ifGenerationMatch", "0");
  const headers = { Authorization: `Bearer ${token}` };
  const sent = await fetch(upload, {
    method: "POST",
    headers: { ...headers, "Content-Type": options.metadata?.contentType || "application/octet-stream" },
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(process.env.VERCEL ? 30000 : 600000),
  });
  if (!sent.ok)
    throw new AppError("STORAGE_UPLOAD", `Google rechazó la subida directa (${sent.status}).`, 502);
  const received = await fetch(`${base}?alt=media`, {
    headers,
    signal: AbortSignal.timeout(process.env.VERCEL ? 30000 : 600000),
  });
  if (!received.ok)
    throw new AppError("STORAGE_READ", `Google rechazó la lectura directa (${received.status}).`, 502);
  const actual = Buffer.from(await received.arrayBuffer());
  if (!actual.equals(bytes))
    throw new AppError("STORAGE_INTEGRITY", `Google guardó ${actual.length} bytes; se enviaron ${bytes.length}.`, 502);
  if (!process.env.VERCEL) {
    const [sdkRead] = await file.download({ validation: false });
    if (!sdkRead.equals(bytes))
      throw new AppError("STORAGE_READ", `Google devolvió ${actual.length} bytes correctos, pero la biblioteca leyó ${sdkRead.length}.`, 502);
  }
}
class DirectYield extends Error {
  constructor(public destination: "continue" | "cloud") { super(destination); }
}
export async function execute(jobId: string, direct = false): Promise<"continue" | "cloud" | undefined> {
  assert(/^[a-f0-9]{64}$/.test(jobId), "JOB_ID inválido");
  const ref = db().doc(`jobs/${jobId}`),
    owner = randomUUID();
  const acquired = await db().runTransaction(async (tx) => {
    const j = (await tx.get(ref)).data() as Job;
    assert(j, "Trabajo no encontrado");
    if (
      !["queued", "running", "waiting"].includes(j.state) ||
      j.leaseUntil > Date.now()
    )
      return false;
    const project = (await tx.get(projectRef(j.projectId))).data() as Project;
    if (project.activeJobId !== j.id) return false;
    const globalRef = db().doc("system/workerSlots"),
      slots = (await tx.get(globalRef)).data()?.slots || {};
    const live = Object.fromEntries(
      Object.entries(slots).filter(([, v]) => Number(v) > Date.now()),
    );
    const limit = Number(process.env.MAX_ACTIVE_JOBS || 1);
    if (!Number.isInteger(limit) || limit < 1 || limit > 10)
      throw new AppError("CONFIG", "MAX_ACTIVE_JOBS inválido");
    if (Object.keys(live).length >= limit && !live[jobId])
      throw new AppError(
        "CONCURRENCY",
        "Hay otro trabajo en ejecución. Reanuda cuando termine.",
      );
    live[jobId] = Date.now() + LEASE;
    tx.set(globalRef, { slots: live });
    tx.update(ref, {
      state: "running",
      leaseOwner: owner,
      leaseUntil: Date.now() + LEASE,
      heartbeat: Date.now(),
      attempts: j.attempts + 1,
    });
    return true;
  }).catch(async (e) => {
    await db().runTransaction(async tx => {
      const current = (await tx.get(ref)).data() as Job | undefined;
      if (current?.state === "queued" && !(current.leaseUntil > Date.now()))
        tx.update(ref, { state: "failed", error: safeError(e) });
    }).catch(() => {});
    throw e;
  });
  if (!acquired) return;
  const job = (await ref.get()).data() as Job;
  let persistedCheckpoint = { ...job.checkpoint };
  const dir = await mkdtemp(path.join(tmpdir(), "universos-"));
  let lost = false;
  let paidCalls = 0;
  async function guarded(
    patch: Record<string, unknown> = {},
    allowStop = false,
    write?: (tx: Transaction) => void,
  ) {
    await db().runTransaction(async (tx) => {
      const j = (await tx.get(ref)).data() as Job;
      const sr = db().doc("system/workerSlots"),
        slots = (await tx.get(sr)).data()?.slots || {};
      assert(
        !lost && j.leaseOwner === owner && j.leaseUntil > Date.now(),
        "Se perdió el lease",
        "LEASE",
      );
      if (j.stopRequested && !allowStop)
        throw new AppError(
          "STOPPED",
          "Detenido. Los resultados ya enviados se conservan.",
        );
      tx.update(ref, {
        ...patch,
        leaseUntil: Date.now() + LEASE,
        heartbeat: Date.now(),
      });
      tx.set(sr, { slots: { ...slots, [jobId]: Date.now() + LEASE } });
      write?.(tx);
    });
  }
  const timer = setInterval(() => {
    void guarded({}, true).catch(() => {
      lost = true;
    });
  }, 30000);
  async function checkpoint(key: string, value: unknown) {
    const external =
      typeof value === "object" ||
      (typeof value === "string" && value.length > 1024);
    if (external) {
      assert(
        Buffer.byteLength(JSON.stringify(value)) < 750000,
        "El resultado excede el tamaño de un checkpoint.",
      );
    }
    const cp = {
      ...persistedCheckpoint,
      [key]: external ? { checkpointRef: key } : value,
      pendingCall: null,
      submitted: false,
    };
    await guarded({ checkpoint: cp }, true, external
      ? (tx) => { tx.set(ref.collection("checkpoints").doc(key), { value }); }
      : undefined);
    persistedCheckpoint = cp;
    job.checkpoint = {
      ...job.checkpoint,
      [key]: value,
      pendingCall: null,
      submitted: false,
    };
  }
  async function reconciled() {
    const reconciledAt = Date.now();
    persistedCheckpoint = { ...persistedCheckpoint, reconciledAt };
    await guarded({ checkpoint: persistedCheckpoint }, true);
    job.checkpoint = { ...job.checkpoint, reconciledAt };
  }
  async function beforeCall(key: string) {
    await guarded();
    assertNoPendingCall(job.checkpoint.pendingCall);
    // A Vercel slice performs at most one paid request. Its result is persisted
    // before another invocation continues, within the 300-second lifetime.
    if (direct && paidCalls > 0) throw new DirectYield("continue");
    paidCalls++;
    const cp = { ...persistedCheckpoint, pendingCall: key, submitted: true };
    await guarded({ checkpoint: cp });
    persistedCheckpoint = cp;
    job.checkpoint = { ...job.checkpoint, pendingCall: key, submitted: true };
  }
  async function refsFor(
    versions: string[],
    maxBytes = 20 * 1024 * 1024,
  ): Promise<ImageRef[]> {
    const out: ImageRef[] = [];
    for (const id of versions) {
      const a = job.snapshot.assets.find((x) => x.id === id);
      assert(a && a.kind === "image", "Referencia no disponible");
      const [bytes] = await privateObject(a.storageObject).download();
      assert(bytes.length <= maxBytes, "Referencia demasiado grande");
      out.push({
        bytesBase64Encoded: bytes.toString("base64"),
        mimeType: a.mime,
      });
    }
    return out;
  }
  async function generate(t: Target) {
    const key = "asset_" + t.id;
    if (job.checkpoint[key]) return;
    await guarded();
    const versionId = createHash("sha256")
      .update(job.id + ":" + t.id)
      .digest("hex");
    const assetRef = projectRef(job.projectId)
      .collection("assets")
      .doc(versionId);
    const existing = await assetRef.get();
    if (existing.exists) {
      await checkpoint(key, versionId);
      return;
    }
    const s = job.snapshot;
    let inputRefs: string[] = t.kind === "image" ? imageReferenceIds(s, t) : [];
    let prompt: string;
    let object: string;
    let mime: string;
    let technicalReport: Record<string, unknown>;
    let lastFrameObject: string | undefined;
    let checksum: string;
    let settings: Record<string, unknown>;
    if (t.kind === "image") {
      // The approved Bible already contains the visual direction. Avoid a
      // second text generation just to rephrase it before every image.
      const savedPrompt = job.checkpoint[`prompt_${t.id}`] as { prompt?: string } | undefined;
      prompt = savedPrompt?.prompt || compileImagePrompt(s, t, job.instructions || t.instructions);
      const recovered = await recoverImage(job.projectId, versionId);
      if (job.checkpoint.pendingCall === key) await reconciled();
      let result;
      if (recovered) result = recovered;
      else {
        assertNoPendingCall(job.checkpoint.pendingCall);
        const refs = await refsFor(
          inputRefs,
          imageLimits(s.project.models.image).maxInlineBytes,
        );
        await beforeCall(key);
        result = await imageGenerate(s.project.models.image, prompt, refs);
      }
      const metadata = await sharp(result.bytes).metadata();
      assert(
        metadata.width &&
          metadata.height &&
          Math.abs(metadata.width / metadata.height - 9 / 16) < 0.02,
        "La imagen no es 9:16",
      );
      mime = result.mime;
      const extension = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
      }[mime];
      assert(extension, "MIME desconocido");
      object = objectPath(job.projectId, versionId, "image." + extension);
      await guarded({}, true);
      if (!recovered)
        await saveVerifiedObject(object, result.bytes, {
          resumable: false,
          preconditionOpts: { ifGenerationMatch: 0 },
          metadata: { contentType: mime },
        });
      checksum = createHash("sha256").update(result.bytes).digest("hex");
      technicalReport = {
        width: metadata.width,
        height: metadata.height,
        mime,
      };
      settings = { aspectRatio: "9:16", mode: "references" };
    } else {
      const c = s.plan!.clips[t.clipNumber! - 1];
      prompt = await directPrompt(
        job,
        t,
        compileVideoPrompt(s, c, job.instructions || t.instructions),
        beforeCall,
        checkpoint,
      );
      const previous = s.targets.find(
        (x) => x.role === "clip" && x.clipNumber === c.number - 1,
      );
      let refs: ImageRef[];
      if (c.startMode === "previousFrame") {
        const v = c.number === 1 ? s.project.previousChapter?.lastClip : s.assets.find((x) => x.id === previous?.approvedVersionId);
        assert(
          v?.lastFrameObject,
          "Falta el último fotograma del clip aprobado",
        );
        const [bytes] = await privateObject(v.lastFrameObject).download();
        refs = [
          {
            bytesBase64Encoded: bytes.toString("base64"),
            mimeType: "image/png",
          },
        ];
        inputRefs = [v.id];
      } else {
        const image = s.targets.find(
          (x) => x.entityId === c.shots[0].id && x.role === "shot",
        );
        assert(image?.approvedVersionId, "Falta imagen inicial");
        inputRefs = [image.approvedVersionId];
        refs = await refsFor(inputRefs);
      }
      let operation = job.checkpoint.operation as string | undefined;
      let recoveredObject = job.checkpoint.videoObject as string | undefined;
      if (
        !operation &&
        !recoveredObject &&
        job.checkpoint.pendingCall === key
      ) {
        recoveredObject =
          (await recoverVideo(job.projectId, versionId)) || undefined;
        await reconciled();
        if (recoveredObject) await checkpoint("videoObject", recoveredObject);
      }
      if (!operation && !recoveredObject) {
        await beforeCall(key);
        operation = await startVideo(
          s.project.models.video,
          prompt,
          refs,
          `gs://${config().bucket}/${objectPath(job.projectId, versionId, "provider")}/`,
        );
        await checkpoint("operation", operation);
        await guarded({ state: "waiting" }, true);
      }
      let response;
      // Veo has already accepted the request. Cloud Run only polls that same
      // operation and processes the resulting video with ffmpeg.
      if (direct) throw new DirectYield("cloud");
      for (let i = 0; !recoveredObject && i < 100; i++) {
        await guarded({}, true);
        try {
          const r = await pollVideo(s.project.models.video, operation!);
          if (r.done) {
            if (r.error) {
              await checkpoint("operationFailed", true);
              throw new AppError(
                "PROVIDER_REJECTED",
                "Veo no pudo completar el clip. Revisa cuota o restricciones.",
                502,
              );
            }
            response = r.response;
            break;
          }
        } catch (e) {
          if (e instanceof AppError && e.code === "PROVIDER_REJECTED") throw e;
          if (i === 99) throw e;
        }
        await sleep(Math.min(15000, 1000 * 2 ** Math.min(i, 4)));
      }
      if (!response && !recoveredObject)
        throw new AppError(
          "OPERATION_PENDING",
          "Veo sigue procesando. Reanudar consultará la misma operación.",
          503,
        );
      const uri = recoveredObject
        ? `gs://${config().bucket}/${recoveredObject}`
        : response.videos?.[0]?.gcsUri;
      const expected = `gs://${config().bucket}/${objectPath(job.projectId, versionId, "provider")}/`;
      assert(
        typeof uri === "string" && uri.startsWith(expected),
        "Veo devolvió un archivo fuera de su destino",
      );
      object = uri.slice(`gs://${config().bucket}/`.length);
      if (!recoveredObject) await checkpoint("videoObject", object);
      const file = path.join(dir, "clip.mp4");
      await privateObject(object).download({ destination: file });
      technicalReport = {
        ...validateMedia(await probe(file), 8),
        continuity: reviewClipTiming(s, c),
      };
      const frame = path.join(dir, "last.png");
      await lastFrame(file, frame);
      lastFrameObject = objectPath(job.projectId, versionId, "last.png");
      await saveVerifiedObject(lastFrameObject, await readFile(frame), {
        resumable: false,
        metadata: { contentType: "image/png" },
      });
      mime = "video/mp4";
      checksum = createHash("sha256")
        .update(await readFile(file))
        .digest("hex");
      settings = {
        durationSeconds: 8,
        generateAudio: true,
        aspectRatio: "9:16",
        mode: "initial",
        resolution: "720p",
        plannedEndState: c.plannedEndState,
        operation,
      };
    }
    const prev = s.targets.find(
      (x) => x.role === "clip" && x.clipNumber === (t.clipNumber || 0) - 1,
    );
    const asset: Asset = {
      id: versionId,
      targetId: t.id,
      kind: t.kind,
      status: "candidate",
      model:
        t.kind === "image" ? s.project.models.image : s.project.models.video,
      prompt,
      inputRefs,
      settings,
      storageObject: object,
      mime,
      checksum,
      sourceRevisions: {
        project: s.project.revision,
        bible: s.project.bible?.id || "",
        plan: s.project.plan?.id || "",
        previousClip: prev?.approvedVersionId || (t.clipNumber === 1 ? s.project.previousChapter?.lastClip.id : null) || null,
      },
      createdAt: Date.now(),
      technicalReport,
      ...(lastFrameObject ? { lastFrameObject } : {}),
    };
    await guarded({}, true, (tx) => { tx.create(assetRef, asset); });
    await checkpoint(key, versionId);
  }
  try {
    for (const [key, value] of Object.entries(persistedCheckpoint)) {
      if (value && typeof value === "object" && "checkpointRef" in value) {
        assert(
          value.checkpointRef === key,
          "Referencia de checkpoint inválida.",
        );
        const saved = await ref.collection("checkpoints").doc(key).get();
        assert(saved.exists, "Falta un resultado persistido del trabajo.");
        job.checkpoint[key] = saved.data()!.value;
      }
    }
    if (typeof job.checkpoint.pendingCall === "string") {
      const key = job.checkpoint.pendingCall;
      const saved = await ref.collection("checkpoints").doc(key).get();
      if (saved.exists) await checkpoint(key, saved.data()!.value);
    }
    if (
      typeof job.checkpoint.pendingCall === "string" &&
      !job.checkpoint.pendingCall.startsWith("asset_")
    ) {
      // A synchronous text response cannot be polled at Google. We have checked
      // the durable result above. End this recovery without another paid call;
      // a separate explicit retry can request just the missing part.
      await reconciled();
      const missingCall = job.checkpoint.pendingCall;
      const lostTextCalls = [...(Array.isArray(job.checkpoint.lostTextCalls) ? job.checkpoint.lostTextCalls : []),
        { key: missingCall, reconciledAt: Date.now(), possibleCharge: true }];
      persistedCheckpoint = { ...persistedCheckpoint, lostTextCalls, pendingCall: null, submitted: false };
      job.checkpoint = { ...job.checkpoint, lostTextCalls, pendingCall: null, submitted: false };
      throw new AppError("TEXT_RESPONSE_LOST", "No se encontró una respuesta de texto guardada. Puedes generar de nuevo solo la parte perdida; las partes terminadas se conservan. El intento anterior pudo consumir créditos.", 502);
    }
    if (["ideas", "story", "bible", "plan"].includes(job.type)) {
      const result = await runDirector(job, beforeCall, checkpoint);
      await db().runTransaction(async (tx) => {
        const p = (await tx.get(projectRef(job.projectId))).data() as Project;
        const j = (await tx.get(ref)).data() as Job;
        assert(
          j.leaseOwner === owner && j.leaseUntil > Date.now(),
          "Lease perdido",
        );
        if (job.type === "ideas") {
          assert(
            p.revision === job.snapshot.project.revision,
            "La historia cambió durante la generación",
          );
          let ideas;
          if (job.optionId) {
            ideas = p.ideas.map((i) =>
              i.id === job.optionId
                ? { ...(result as Project["ideas"][number]), id: i.id }
                : i,
            );
          } else ideas = (result as { ideas: Project["ideas"] }).ideas;
          assert(ideas.length === 3, "Se requieren tres propuestas");
          tx.update(projectRef(job.projectId), {
            ideas,
            revision: p.revision + 1,
          });
        } else {
          const kind = job.type as Narrative["kind"];
          const v: Narrative = {
            id: job.id,
            kind,
            data: result,
            sourceRevision: job.snapshot.project.revision,
            createdAt: Date.now(),
          };
          tx.set(
            projectRef(job.projectId).collection("narratives").doc(v.id),
            v,
          ); /* Narrative is a candidate, explicitly accepted in the editor. */
        }
      });
    } else if (job.type === "image") {
      const t = job.snapshot.targets.find((t) => t.id === job.targetId);
      assert(t, "Imagen no encontrada");
      await generate(t);
    } else if (job.type === "images") {
      const targets = job.snapshot.targets.filter(
        (t) =>
          t.kind === "image" &&
          !t.approvedVersionId &&
          (t.role !== "shot" || job.snapshot.project.plan?.approvedAt),
      );
      for (const t of targets) await generate(t);
    } else if (job.type === "video") {
      const t = job.snapshot.targets.find((t) => t.id === job.targetId);
      assert(t, "Clip no encontrado");
      await generate(t);
    } else if (job.type === "finalize") {
      const ids = job.snapshot.manifest!;
      const hash = createHash("sha256")
        .update(JSON.stringify(ids))
        .digest("hex");
      const files: string[] = [];
      for (let i = 0; i < ids.length; i++) {
        await guarded();
        const a = job.snapshot.assets.find((x) => x.id === ids[i]);
        assert(a, "Versión exportada no encontrada");
        const local = path.join(dir, `clip-${i}.mp4`);
        await privateObject(a.storageObject).download({ destination: local });
        const sum = createHash("sha256")
          .update(await readFile(local))
          .digest("hex");
        assert(sum === a.checksum, "Checksum incorrecto");
        files.push(local);
      }
      const r = await assemble(dir, files);
      await guarded();
      const object = objectPath(job.projectId, job.id, "final.mp4"),
        reportObject = objectPath(job.projectId, job.id, "report.json");
      await saveVerifiedObject(object, await readFile(r.output), {
        resumable: false,
        metadata: { contentType: "video/mp4" },
      });
      await saveVerifiedObject(reportObject, JSON.stringify(r.report), {
        resumable: false,
        metadata: { contentType: "application/json" },
      });
      await guarded({}, true, (tx) => { tx.set(projectRef(job.projectId).collection("exports").doc(job.id), {
        id: job.id,
        approvedClipVersionIds: ids,
        manifestHash: hash,
        storageObject: object,
        reportObject,
        technicalReport: r.report,
        state: "completed",
        createdAt: Date.now(),
      }); });
    }
    await guarded({ state: "completed" }, true);
  } catch (e) {
    if (e instanceof DirectYield) {
      persistedCheckpoint = { ...persistedCheckpoint, directStep: Number(persistedCheckpoint.directStep || 0) + 1 };
      await guarded({ state: "queued", checkpoint: persistedCheckpoint, error: null }, true);
      return e.destination;
    }
    logFailure(`worker:${job.type}`, e);
    const err = safeError(e);
    // A provider's explicit 4xx rejection cannot be a lost paid response.
    // Keep the error, but unblock a later user-requested attempt.
    if (["PROVIDER_REJECTED", "PROVIDER_AUTH", "QUOTA", "PROVIDER_BLOCKED"].includes(err.code) && job.checkpoint.pendingCall && !job.checkpoint.operation) {
      persistedCheckpoint = { ...persistedCheckpoint, pendingCall: null, submitted: false };
      job.checkpoint = { ...job.checkpoint, pendingCall: null, submitted: false };
    }
    const state =
      job.checkpoint.operation && !job.checkpoint.videoObject && !job.checkpoint.operationFailed
        ? "waiting"
        : err.code === "STOPPED"
          ? "stopped"
          : err.code === "AMBIGUOUS" ||
            (job.checkpoint.pendingCall && !job.checkpoint.operation)
          ? "needsReview"
          : "failed";
    await guarded({ state, error: err, checkpoint: persistedCheckpoint }, true).catch(() => {});
    if (!direct) process.exitCode = 1;
  } finally {
    clearInterval(timer);
    await db().runTransaction(async (tx) => {
      const j = (await tx.get(ref)).data() as Job;
      const sr = db().doc("system/workerSlots"),
        slots = (await tx.get(sr)).data()?.slots || {};
      if (j.leaseOwner === owner) {
        delete slots[jobId];
        tx.update(ref, { leaseOwner: null, leaseUntil: 0 });
        tx.set(sr, { slots });
      }
    });
    await rm(dir, { recursive: true, force: true });
  }
}
export async function startupCheck() {
  const key = objectPath("system", randomUUID(), "startup.txt");
  let step = "escritura en Firestore";
  try {
    console.log(`Comprobando ${step}…`);
    await db().doc("system/startupCheck").set({ at: Date.now(), status: "checking" });
    step = "escritura en el bucket";
    console.log(`Comprobando ${step}…`);
    await saveVerifiedObject(key, "universos-ia-startup", { resumable: false });
    step = "eliminación del archivo de prueba";
    console.log(`Comprobando ${step}…`);
    await privateObject(key).delete();
    step = "confirmación en Firestore";
    console.log(`Comprobando ${step}…`);
    await db().doc("system/startupCheck").set({ at: Date.now(), status: "ok" });
    console.log("Arranque, Firestore y almacenamiento verificados. Sin llamadas a generadores.");
  } catch (e) {
    // This is only written to the private Cloud Run log; the public API still
    // returns safeError without revealing details from Google services.
    const error = e as { code?: unknown; message?: unknown };
    console.error("Falló la comprobación de " + step, {
      code: typeof error?.code === "string" || typeof error?.code === "number" ? error.code : "UNKNOWN",
      message: typeof error?.message === "string" ? error.message.slice(0, 1200) : "Sin detalles",
    });
    throw e;
  }
}
if (process.env.WORKER_SELF_TEST === "1")
  startupCheck().catch(e => { console.error(safeError(e)); process.exitCode = 1; });
else if (process.env.JOB_ID)
  execute(process.env.JOB_ID).catch((e) => {
    console.error(safeError(e));
    process.exitCode = 1;
  });
