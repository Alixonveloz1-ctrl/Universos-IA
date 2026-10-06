import { randomUUID } from "node:crypto";
import { z } from "zod";
import { bucket } from "@/lib/persistence/google";
import {
  db,
  googleAuth,
  googlePost,
  mediaResponse,
  objectPath,
  privateObject,
  readPrivateObject,
} from "@/lib/persistence/google";
import { config, required } from "@/lib/config";
import { AppError, assert, safeError } from "@/lib/errors";
import { originCheck, requireSession } from "@/lib/auth";
import { imageLimits, model } from "@/lib/models";
import {
  imageGenerate,
  pollVideo,
  startVideo,
  type ImageRef,
} from "@/lib/providers/vertex";
import {
  cinematicId,
  cinematicProjectInput,
  validateCinematicPlan,
} from "@/lib/cinematic/schema";
import {
  cinematicNegativePrompt,
  compileCinematicCharacterPrompt,
  compileCinematicOpeningImagePrompt,
  compileCinematicVideoPrompt,
  generateCinematicPlan,
} from "@/lib/cinematic/director";
import { cinematicStyle } from "@/lib/cinematic/options";
import type {
  CinematicAsset,
  CinematicFinalizeJob,
  CinematicProject,
  CinematicPlanRun,
} from "@/lib/cinematic/types";
import { cinematicImageCharacterIds } from "@/lib/cinematic/types";
import { findCinematicVideoObject } from "@/lib/cinematic/video-output";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const revision = (p: CinematicProject) => p.revision || 0;
const planRevision = (p: CinematicProject) => p.planRevision || 0;

function requestId(value: unknown) {
  return z.string().uuid().parse(value);
}

async function reserveGeneration(project: CinematicProject, id: string, asset: CinematicAsset) {
  const ref = projectRef(project.id);
  const doc = ref.collection("assets").doc(id);
  return db().runTransaction(async tx => {
    const [snapshot, existing] = await Promise.all([tx.get(ref), tx.get(doc)]);
    if (existing.exists) return existing.data() as CinematicAsset;
    const current = snapshot.data() as CinematicProject | undefined;
    assert(current && !current.deleting && revision(current) === revision(project) && planRevision(current) === planRevision(project),
      "La producción cambió. Actualiza antes de generar.");
    assert(!current.activeGenerationId, "Hay una generación sin resolver. Consulta su estado antes de iniciar otra.");
    tx.create(doc, asset);
    tx.update(ref, { activeGenerationId: id, updatedAt: Date.now() });
    return null;
  });
}

async function finishGeneration(projectId: string, id: string, changes: Partial<CinematicAsset>, keepLock = false) {
  const ref = projectRef(projectId);
  await db().runTransaction(async tx => {
    const snap = await tx.get(ref);
    const current = snap.data() as CinematicProject | undefined;
    const doc = ref.collection("assets").doc(id);
    tx.update(doc, changes);
    if (!keepLock && current?.activeGenerationId === id)
      tx.update(ref, { activeGenerationId: null, updatedAt: Date.now() });
  });
}

async function failGeneration(projectId: string, id: string, error: unknown) {
  const safe = safeError(error);
  await finishGeneration(projectId, id, {
    state: safe.code === "AMBIGUOUS" ? "uncertain" : "failed",
    error: safe.message,
  }, safe.code === "AMBIGUOUS");
  // Ambiguous requests retain a lock: no silent second paid call.
}

async function requestJson(req: Request) {
  if (!req.headers.get("content-type")?.startsWith("application/json"))
    throw new AppError("JSON", "Se requiere JSON.", 415);
  const text = await req.text();
  if (text.length > 250000) throw new AppError("SIZE", "Solicitud demasiado grande.", 413);
  try { return JSON.parse(text); }
  catch { throw new AppError("JSON", "JSON inválido.", 400); }
}

function projectRef(id: string) {
  cinematicId.parse(id);
  return db().doc(`cinematicProjects/${id}`);
}

async function readProject(id: string) {
  const ref = projectRef(id);
  const project = (await ref.get()).data() as CinematicProject | undefined;
  assert(project?.owner === "personal" && project.mode === "cinematic-v1", "Producción cinematográfica no encontrada.", "NOT_FOUND");
  return { ref, project };
}

async function readAsset(projectId: string, assetId: string) {
  cinematicId.parse(assetId);
  const { ref } = await readProject(projectId);
  const doc = ref.collection("assets").doc(assetId);
  const asset = (await doc.get()).data() as CinematicAsset | undefined;
  assert(asset?.projectId === projectId, "Activo cinematográfico no encontrado.", "NOT_FOUND");
  return { doc, asset };
}

async function uploadBytes(key: string, bytes: Buffer, contentType: string) {
  privateObject(key);
  const token = await googleAuth().getAccessToken();
  const upload = new URL(`https://storage.googleapis.com/upload/storage/v1/b/${config().bucket}/o`);
  upload.searchParams.set("uploadType", "media");
  upload.searchParams.set("name", key);
  upload.searchParams.set("ifGenerationMatch", "0");
  const result = await fetch(upload, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(60000),
  });
  if (!result.ok)
    throw new AppError("STORAGE_UPLOAD", `No se pudo guardar el activo (Google ${result.status}).`, 502);
}

function imageExtension(mime: string) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

async function assetRefs(project: CinematicProject, ids: string[]) {
  const refs: ImageRef[] = [];
  for (const id of ids) {
    const asset = (await projectRef(project.id).collection("assets").doc(id).get()).data() as CinematicAsset | undefined;
    assert(asset?.kind === "image" && asset.storageObject, "Falta una referencia de imagen aprobada.");
    const bytes = await readPrivateObject(asset.storageObject);
    refs.push({ bytesBase64Encoded: bytes.toString("base64"), mimeType: asset.storageObject.endsWith(".png") ? "image/png" : asset.storageObject.endsWith(".webp") ? "image/webp" : "image/jpeg" });
  }
  return refs;
}

async function saveImageCandidate(
  project: CinematicProject,
  role: "character" | "segment-image",
  prompt: string,
  refs: ImageRef[],
  inputRefs: string[],
  characterId?: string,
  segmentNumber?: number,
  assetId?: string,
) {
  assert(assetId, "Falta el identificador de intento.");
  const asset: CinematicAsset = {
    id: assetId,
    projectId: project.id,
    kind: "image",
    role,
    model: project.models.image,
    prompt,
    inputRefs,
    state: "submitting",
    planRevision: planRevision(project),
    createdAt: Date.now(),
    ...(characterId ? { characterId } : {}),
    ...(segmentNumber ? { segmentNumber } : {}),
  };
  const existing = await reserveGeneration(project, assetId, asset);
  if (existing) {
    assert(existing.role === role && existing.characterId === characterId && existing.segmentNumber === segmentNumber,
      "El identificador de intento pertenece a otra generación.");
    return existing;
  }
  try {
    const result = await imageGenerate(project.models.image, prompt, refs);
    const ext = imageExtension(result.mime);
    const storageObject = objectPath("cinematic", project.id, `${role}-${characterId || segmentNumber || "asset"}-${assetId}.${ext}`);
    await uploadBytes(storageObject, result.bytes, result.mime);
    await finishGeneration(project.id, assetId, { state: "candidate", storageObject });
    return { ...asset, state: "candidate", storageObject };
  } catch (error) {
    await failGeneration(project.id, assetId, error);
    throw error;
  }
}

async function dispatchFinalize(job: CinematicFinalizeJob) {
  const resource = required("CLOUD_RUN_JOB_RESOURCE");
  const token = await googleAuth().getAccessToken();
  const current = await fetch(`https://run.googleapis.com/v2/${resource}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!current.ok)
    throw new AppError("WORKER_ACCESS", `No se pudo consultar el ensamblador (HTTP ${current.status}).`, 503);
  const labels = (await current.json()).labels || {};
  if (labels["cinematic-flow"] !== "v1")
    throw new AppError("WORKER_UPDATE", "Actualiza el ejecutor con ./s antes de ensamblar producciones cinematográficas.", 503);
  const run = await googlePost(
    `https://run.googleapis.com/v2/${resource}:run`,
    {
      overrides: {
        containerOverrides: [{ env: [{ name: "CINEMATIC_JOB_ID", value: job.id }] }],
        taskCount: 1,
        timeout: "3600s",
      },
    },
    true, // A transport error or 5xx can occur after Cloud Run accepted the job.
  );
  if (typeof run.name !== "string" || !run.name)
    throw new AppError("AMBIGUOUS", "Cloud Run pudo aceptar el trabajo sin devolver su operación.", 502);
  const executionName = typeof run.metadata?.name === "string" &&
    run.metadata.name.startsWith(`${resource}/executions/`) ? run.metadata.name : undefined;
  await db().doc(`cinematicJobs/${job.id}`).update({
    ...(executionName ? { executionName } : {}),
    operationName: run.name,
    dispatchState: "accepted",
    updatedAt: Date.now(),
  });
}

async function handler(req: Request, context: { params: Promise<{ path?: string[] }> }) {
  try {
    if (req.method !== "GET") originCheck(req);
    requireSession(req);
    const parts = (await context.params).path || [];

    if (!parts.length) {
      if (req.method === "GET") {
        const docs = (await db().collection("cinematicProjects").where("owner", "==", "personal").get()).docs;
        return json(docs.map(d => {
          const p = d.data() as CinematicProject;
          return {
            id: p.id, title: p.title, concept: p.concept,
            visualStyle: cinematicStyle(p.visualStyle), genre: p.genre, subgenre: p.subgenre,
            durationSeconds: p.durationSeconds, createdAt: p.createdAt,
            updatedAt: p.updatedAt, hasPlan: !!p.plan, hasFinal: !!p.final,
          };
        }).sort((a, b) => b.updatedAt - a.updatedAt));
      }
      if (req.method === "POST") {
        const input = cinematicProjectInput.parse(await requestJson(req));
        for (const kind of ["text", "image", "video"] as const) model(input.models[kind], kind);
        const id = randomUUID();
        const now = Date.now();
        const project: CinematicProject = {
          ...input,
          id,
          owner: "personal",
          mode: "cinematic-v1",
          title: "Nueva producción cinematográfica",
          approvedCharacters: {},
          approvedImages: {},
          approvedVideos: {},
          revision: 0,
          planRevision: 0,
          final: null,
          createdAt: now,
          updatedAt: now,
        };
        await projectRef(id).create(project);
        return json(project, 201);
      }
      throw new AppError("METHOD", "Método no permitido.", 405);
    }

    const pid = cinematicId.parse(parts[0]);
    const { ref, project } = await readProject(pid);

    if (parts.length === 4 && parts[1] === "generations" && parts[3] === "resolve" && req.method === "POST") {
      const id = cinematicId.parse(parts[2]);
      assert((await requestJson(req)).acknowledge === true, "Confirma la revisión del intento antes de liberarlo.");
      const assetRef = ref.collection("assets").doc(id);
      const runRef = ref.collection("planRuns").doc(id);
      const asset = (await assetRef.get()).data() as CinematicAsset | undefined;
      const run = (await runRef.get()).data() as CinematicPlanRun | undefined;
      assert(project.activeGenerationId === id && (asset || run), "No hay un intento activo con ese ID.");
      const attempt = asset || run!;
      assert(["uncertain", "submitting"].includes(attempt.state), "El intento ya terminó.");
      if (asset) {
        const prefix = asset.kind === "video" ? asset.outputPrefix! :
          objectPath("cinematic", pid, `${asset.role}-${asset.characterId || asset.segmentNumber || "asset"}-${id}.`);
        const [files] = await bucket().getFiles({ prefix });
        assert(files.length <= 1, "Hay varios archivos en este intento; revísalos antes de continuar.");
        const completed = files.find(f => asset.kind === "video" ? f.name.endsWith(".mp4") : /\.(png|jpe?g|webp)$/.test(f.name));
        if (completed) {
          await db().runTransaction(async tx => {
            const [currentDoc, assetDoc] = await Promise.all([tx.get(ref), tx.get(assetRef)]);
            const current = currentDoc.data() as CinematicProject;
            const attempt = assetDoc.data() as CinematicAsset;
            assert(current.activeGenerationId === id && ["uncertain", "submitting"].includes(attempt.state), "El intento ya cambió.");
            tx.update(assetRef, { state: asset.kind === "video" ? "completed" : "candidate",
              storageObject: completed.name, error: null });
            tx.update(ref, { activeGenerationId: null, updatedAt: Date.now() });
          });
          return json({ state: asset.kind === "video" ? "completed" : "candidate" });
        }
      }
      const waitMs = asset?.kind === "video" ? 24 * 60 * 60 * 1000 : 6 * 60 * 1000;
      assert(Date.now() - attempt.createdAt > waitMs,
        "Este intento aún puede estar procesándose. Espera antes de liberarlo.");
      await db().runTransaction(async tx => {
        const [currentDoc, attemptDoc] = await Promise.all([tx.get(ref), tx.get(asset ? assetRef : runRef)]);
        const current = currentDoc.data() as CinematicProject;
        const fresh = attemptDoc.data() as CinematicAsset | CinematicPlanRun;
        assert(current.activeGenerationId === id && ["uncertain", "submitting"].includes(fresh.state), "El intento ya cambió.");
        tx.update(asset ? assetRef : runRef, { state: "failed", error: "Intento incierto cerrado tras revisión explícita." });
        tx.update(ref, { activeGenerationId: null, updatedAt: Date.now() });
      });
      return json({ state: "failed" });
    }

    if (parts.length === 1) {
      if (req.method === "PATCH") {
        const change = z.object({ models: cinematicProjectInput.shape.models }).strict().parse(await requestJson(req));
        for (const kind of ["text", "image", "video"] as const) model(change.models[kind], kind);
        await db().runTransaction(async tx => {
          const current = (await tx.get(ref)).data() as CinematicProject;
          assert(!current.deleting && !current.activeGenerationId, "Hay una generación pendiente.");
          tx.update(ref, { models: change.models, updatedAt: Date.now() });
        });
        return json({ ok: true });
      }
      if (req.method === "GET") {
        const assets = (await ref.collection("assets").get()).docs
          .map(d => d.data() as CinematicAsset)
          .sort((a, b) => a.createdAt - b.createdAt);
        const finalizeJob = (project.activeFinalizeJobId || project.lastFinalizeJobId)
          ? (await db().doc(`cinematicJobs/${project.activeFinalizeJobId || project.lastFinalizeJobId}`).get()).data() as CinematicFinalizeJob || null
          : null;
        const generation = project.activeGenerationId
          ? (await ref.collection("assets").doc(project.activeGenerationId).get()).data() ||
            (await ref.collection("planRuns").doc(project.activeGenerationId).get()).data() || null
          : null;
        const recoverableFinalize = !!finalizeJob && ["queued", "running"].includes(finalizeJob.state) &&
          Date.now() - (finalizeJob.dispatchAttemptAt || finalizeJob.createdAt) > 70 * 60 * 1000 &&
          (finalizeJob.leaseUntil || 0) < Date.now();
        return json({ project, assets, finalizeJob, generation, recoverableFinalize });
      }
      if (req.method === "DELETE") {
        await db().runTransaction(async tx => {
          const [projectDoc, assetDocs] = await Promise.all([tx.get(ref), tx.get(ref.collection("assets"))]);
          const current = projectDoc.data() as CinematicProject;
          assert(!current.activeGenerationId && !current.activeFinalizeJobId,
            "Espera o resuelve las generaciones y el ensamblado activos antes de borrar.");
          assert(!assetDocs.docs.some(d => ["waiting", "submitting", "uncertain"].includes((d.data() as CinematicAsset).state)),
            "Espera o resuelve los videos pendientes antes de borrar.");
          tx.update(ref, { deleting: true });
        });
        const prefix = `${config().prefix}/cinematic/${pid}/`;
        const [objects] = await bucket().getFiles({ prefix });
        for (const object of objects) await object.delete({ ignoreNotFound: true });
        const jobs = await db().collection("cinematicJobs").where("projectId", "==", pid).get();
        for (const job of jobs.docs) await job.ref.delete();
        await db().recursiveDelete(ref);
        return json({ ok: true });
      }
    }

    if (parts.length === 2 && parts[1] === "plan" && req.method === "POST") {
      const id = requestId((await requestJson(req)).requestId);
      const runRef = ref.collection("planRuns").doc(id);
      const existing = await db().runTransaction(async tx => {
        const [currentDoc, runDoc] = await Promise.all([tx.get(ref), tx.get(runRef)]);
        if (runDoc.exists) return runDoc.data() as CinematicPlanRun;
        const current = currentDoc.data() as CinematicProject;
        assert(!current.deleting && !current.activeGenerationId && revision(current) === revision(project),
          "Hay otra generación activa o el proyecto cambió.");
        tx.create(runRef, { id, state: "submitting", baseRevision: revision(current), model: current.models.text, createdAt: Date.now() } satisfies CinematicPlanRun);
        tx.update(ref, { activeGenerationId: id });
        return null;
      });
      if (existing) {
        if (existing.state === "failed") throw new AppError("RUN_FAILED", existing.error || "El intento anterior falló.", 409);
        const current = (await ref.get()).data() as CinematicProject;
        return json({ run: existing, plan: existing.state === "completed" ? current.plan : null }, 202);
      }
      try {
        const plan = await generateCinematicPlan(project, project.plan);
        await db().runTransaction(async tx => {
          const current = (await tx.get(ref)).data() as CinematicProject;
          assert(current.activeGenerationId === id && revision(current) === revision(project),
            "El proyecto cambió durante la generación del plan.");
          tx.update(ref, {
            title: plan.title, plan, shotLayout: "one-shot-per-video",
            approvedCharacters: {}, approvedImages: {}, approvedVideos: {},
            final: null, revision: revision(current) + 1, planRevision: planRevision(current) + 1,
            activeGenerationId: null, updatedAt: Date.now(),
          });
          tx.update(runRef, { state: "completed" });
        });
        return json(plan);
      } catch (error) {
        const safe = safeError(error);
        await db().runTransaction(async tx => {
          const current = (await tx.get(ref)).data() as CinematicProject;
          tx.update(runRef, { state: safe.code === "AMBIGUOUS" ? "uncertain" : "failed", error: safe.message });
          if (safe.code !== "AMBIGUOUS" && current.activeGenerationId === id)
            tx.update(ref, { activeGenerationId: null });
        });
        throw error;
      }
    }

    if (parts.length === 4 && parts[1] === "characters" && parts[3] === "image" && req.method === "POST") {
      const id = requestId((await requestJson(req)).requestId);
      const prior = (await ref.collection("assets").doc(id).get()).data() as CinematicAsset | undefined;
      if (prior) {
        assert(prior.role === "character" && prior.characterId === parts[2], "El intento pertenece a otra generación.");
        return json(prior, 202);
      }
      const characterId = cinematicId.parse(parts[2]);
      assert(project.plan, "Genera primero el plan cinematográfico.");
      const character = project.plan.characters.find(c => c.id === characterId);
      assert(character, "Personaje no encontrado.");
      const prompt = compileCinematicCharacterPrompt(project.plan, character, cinematicStyle(project.visualStyle));
      const asset = await saveImageCandidate(project, "character", prompt, [], [], characterId, undefined, id);
      return json(asset, 201);
    }

    if (parts.length === 4 && parts[1] === "segments" && parts[3] === "image" && req.method === "POST") {
      const id = requestId((await requestJson(req)).requestId);
      const prior = (await ref.collection("assets").doc(id).get()).data() as CinematicAsset | undefined;
      if (prior) {
        assert(prior.role === "segment-image" && prior.segmentNumber === Number(parts[2]), "El intento pertenece a otra generación.");
        return json(prior, 202);
      }
      assert(project.plan, "Genera primero el plan cinematográfico.");
      const number = Number(parts[2]);
      const segment = project.plan.segments.find(s => s.number === number);
      assert(segment, "Bloque cinematográfico no encontrado.");
      const imageCast = cinematicImageCharacterIds(segment, project.shotLayout);
      const refIds = imageCast.map(id => project.approvedCharacters[id]).filter((x): x is string => !!x);
      assert(refIds.length === imageCast.length, "Aprueba primero las referencias de todos los personajes visibles en esta toma.");
      const limits = imageLimits(project.models.image);
      assert(refIds.length <= limits.maxReferenceImages,
        `Este bloque necesita ${refIds.length} referencias y el generador de imagen seleccionado admite ${limits.maxReferenceImages}. Cambia manualmente de generador o reduce el reparto del bloque.`);
      const refs = await assetRefs(project, refIds);
      const prompt = compileCinematicOpeningImagePrompt(project.plan, segment, cinematicStyle(project.visualStyle));
      const asset = await saveImageCandidate(project, "segment-image", prompt, refs, refIds, undefined, number, id);
      return json(asset, 201);
    }

    if (parts.length === 4 && parts[1] === "segments" && parts[3] === "video" && req.method === "POST") {
      const assetId = requestId((await requestJson(req)).requestId);
      const prior = (await ref.collection("assets").doc(assetId).get()).data() as CinematicAsset | undefined;
      if (prior) {
        assert(prior.role === "segment-video" && prior.segmentNumber === Number(parts[2]), "El intento pertenece a otra generación.");
        return json(prior, 202);
      }
      assert(project.plan, "Genera primero el plan cinematográfico.");
      const number = Number(parts[2]);
      const segment = project.plan.segments.find(s => s.number === number);
      assert(segment, "Bloque cinematográfico no encontrado.");
      const imageId = project.approvedImages[String(number)];
      assert(imageId, "Aprueba primero la imagen inicial de este bloque.");
      const imageAsset = (await ref.collection("assets").doc(imageId).get()).data() as CinematicAsset | undefined;
      assert(imageAsset?.storageObject && imageAsset.kind === "image", "La imagen inicial aprobada no está disponible.");
      const bytes = await readPrivateObject(imageAsset.storageObject);
      const imageRef: ImageRef = {
        bytesBase64Encoded: bytes.toString("base64"),
        mimeType: imageAsset.storageObject.endsWith(".png") ? "image/png" : imageAsset.storageObject.endsWith(".webp") ? "image/webp" : "image/jpeg",
      };
      const outputPrefix = objectPath("cinematic", project.id, `segment-video-${number}-${assetId}-provider`) + "/";
      const prompt = compileCinematicVideoPrompt(project.plan, segment, project.language, project.accent,
        cinematicStyle(project.visualStyle));
      const asset: CinematicAsset = {
        id: assetId,
        projectId: project.id,
        kind: "video",
        role: "segment-video",
        model: project.models.video,
        prompt,
        inputRefs: [imageId],
        state: "submitting",
        planRevision: planRevision(project),
        outputPrefix,
        segmentNumber: number,
        createdAt: Date.now(),
      };
      const existing = await reserveGeneration(project, assetId, asset);
      if (existing) {
        assert(existing.role === "segment-video" && existing.segmentNumber === number,
          "El intento pertenece a otra generación.");
        return json(existing, 202);
      }
      try {
        const operation = await startVideo(
          project.models.video,
          [
            "SOURCE CONTEXT: The supplied starting image and all described people are original fictional AI-generated adult characters for this private production. Preserve their fictional identities without inferring real-world identity.",
            prompt,
          ].join("\n\n"),
          [imageRef],
          `gs://${config().bucket}/${outputPrefix}`,
          segment.durationSeconds,
          cinematicNegativePrompt(project.visualStyle),
        );
        await finishGeneration(project.id, assetId, { state: "waiting", operation });
        return json({ ...asset, state: "waiting", operation }, 202);
      } catch (error) {
        await failGeneration(project.id, assetId, error);
        throw error;
      }
    }

    if ((parts.length === 3 && parts[1] === "videos" && req.method === "GET") ||
        (parts.length === 4 && parts[1] === "videos" && parts[3] === "recover" && req.method === "POST")) {
      const { doc, asset } = await readAsset(pid, parts[2]);
      assert(asset.kind === "video" && asset.role === "segment-video", "Activo de video inválido.");
      const recovery = parts.length === 4;
      if (asset.state === "completed" || (asset.state === "failed" && !recovery)) return json(asset);
      if (recovery) assert(asset.state === "failed", "Esta operación ya no necesita recuperación.");
      if (asset.state === "submitting" || asset.state === "uncertain") return json(asset);
      assert(asset.operation && asset.outputPrefix, "La operación de Veo no está registrada.");
      const result = await pollVideo(asset.model, asset.operation);
      if (!result.done) {
        if (recovery) await doc.update({ state: "waiting", error: null });
        return json({ ...asset, state: "waiting", error: null });
      }
      const storageObject = await findCinematicVideoObject(result, asset.outputPrefix, asset.id);
      if (storageObject) {
        await doc.update({ state: "completed", storageObject, error: null });
        return json({ ...asset, state: "completed", storageObject, error: null });
      }
      const error = result.error ? String(result.error.message || "Veo no pudo completar este bloque.").slice(0, 700)
        : Number(result.response?.raiMediaFilteredCount) > 0
          ? "Veo filtró este intento y no entregó un archivo de video. Puedes regenerar solo este bloque."
          : "Veo terminó, pero no entregó un video en el bucket. Puedes volver a buscar el archivo sin generar otra vez.";
      await doc.update({ state: "failed", error });
      return json({ ...asset, state: "failed", error });
    }

    if (parts.length === 4 && parts[1] === "assets" && parts[3] === "approve" && req.method === "POST") {
      const assetId = cinematicId.parse(parts[2]);
      const { asset } = await readAsset(pid, assetId);
      assert(asset.state === "candidate" || asset.state === "completed", "El activo todavía no puede aprobarse.");
      await db().runTransaction(async tx => {
        const current = (await tx.get(ref)).data() as CinematicProject;
        assert(!current.deleting && current.plan && (asset.planRevision || 0) === planRevision(current),
          "Este activo pertenece a un plan anterior. Genera uno nuevo.");
        const approvedCharacters = { ...current.approvedCharacters };
        const approvedImages = { ...current.approvedImages };
        const approvedVideos = { ...current.approvedVideos };
        if (asset.role === "character" && current.approvedCharacters[asset.characterId || ""] === asset.id ||
            asset.role === "segment-image" && current.approvedImages[String(asset.segmentNumber)] === asset.id ||
            asset.role === "segment-video" && current.approvedVideos[String(asset.segmentNumber)] === asset.id) return;
        if (asset.role === "character") {
          assert(asset.characterId && current.plan.characters.some(c => c.id === asset.characterId), "Referencia de personaje inválida.");
          approvedCharacters[asset.characterId] = asset.id;
          for (const segment of current.plan.segments.filter(s => s.characterIds.includes(asset.characterId!))) {
            delete approvedImages[String(segment.number)];
            delete approvedVideos[String(segment.number)];
          }
        } else if (asset.role === "segment-image") {
          const segment = current.plan.segments.find(s => s.number === asset.segmentNumber);
          assert(segment, "Imagen de bloque inválida.");
          const imageCast = cinematicImageCharacterIds(segment, current.shotLayout);
          assert(asset.inputRefs.length === imageCast.length &&
            imageCast.every((id, i) => asset.inputRefs[i] === current.approvedCharacters[id]),
            "Las referencias del bloque cambiaron. Genera una imagen nueva.");
          approvedImages[String(segment.number)] = asset.id;
          delete approvedVideos[String(segment.number)];
        } else {
          assert(current.plan.segments.some(s => s.number === asset.segmentNumber), "Video de bloque inválido.");
          assert(asset.inputRefs[0] === approvedImages[String(asset.segmentNumber)] && asset.inputRefs.length === 1,
            "La imagen inicial cambió. Genera un video nuevo.");
          approvedVideos[String(asset.segmentNumber)] = asset.id;
        }
        tx.update(ref, { approvedCharacters, approvedImages, approvedVideos,
          revision: revision(current) + 1, final: null, updatedAt: Date.now() });
      });
      return json({ ok: true });
    }

    if (parts.length === 2 && parts[1] === "finalize" && req.method === "POST") {
      assert(project.plan, "Falta el plan cinematográfico.");
      validateCinematicPlan(project.plan, project.durationSeconds,
        project.shotLayout === "one-shot-per-video" ? "shot" : "legacy");
      const jobId = randomUUID();
      const now = Date.now();
      const jobRef = db().doc(`cinematicJobs/${jobId}`);
      const job = await db().runTransaction(async tx => {
        const current = (await tx.get(ref)).data() as CinematicProject;
        assert(!current.deleting && !current.activeFinalizeJobId && !current.activeGenerationId,
          "Hay un ensamblado o una generación en curso.");
        assert(current.plan && planRevision(current) === planRevision(project), "El plan cambió.");
        const plan = validateCinematicPlan(current.plan, current.durationSeconds,
          current.shotLayout === "one-shot-per-video" ? "shot" : "legacy");
        const ids = plan.segments.map(s => current.approvedVideos[String(s.number)]);
        assert(ids.every(Boolean), "Aprueba todos los videos antes de ensamblar.");
        const snapshots = await Promise.all(ids.map(id => tx.get(ref.collection("assets").doc(id))));
        const segments = plan.segments.map((s, i) => {
          const asset = snapshots[i].data() as CinematicAsset | undefined;
          assert(asset?.state === "completed" && asset.role === "segment-video" && asset.segmentNumber === s.number &&
            asset.storageObject && (asset.planRevision || 0) === planRevision(current) &&
            asset.inputRefs[0] === current.approvedImages[String(s.number)],
            `El video aprobado del bloque ${s.number} no está vigente.`);
          return { number: s.number, assetId: asset.id, storageObject: asset.storageObject, durationSeconds: s.durationSeconds };
        });
        const created: CinematicFinalizeJob = {
          id: jobId, projectId: pid, state: "queued", dispatchState: "pending", dispatchAttemptAt: now,
          revision: revision(current), planRevision: planRevision(current),
          durationSeconds: current.durationSeconds, segments, error: null, createdAt: now, updatedAt: now,
        };
        tx.create(jobRef, created);
        tx.update(ref, { activeFinalizeJobId: jobId, lastFinalizeJobId: jobId, updatedAt: now });
        return created;
      });
      try {
        await dispatchFinalize(job);
      } catch (error) {
        const safe = safeError(error);
        const definite = ["WORKER_ACCESS", "WORKER_UPDATE", "PROVIDER_REJECTED", "PROVIDER_AUTH", "QUOTA"].includes(safe.code);
        await db().runTransaction(async tx => {
          const current = (await tx.get(ref)).data() as CinematicProject;
          tx.update(jobRef, { dispatchState: definite ? "failed" : "uncertain",
            ...(definite ? { state: "failed" } : {}), error: safe, updatedAt: Date.now() });
          if (definite && current.activeFinalizeJobId === jobId)
            tx.update(ref, { activeFinalizeJobId: null });
        });
        throw error;
      }
      return json(job, 202);
    }

    if (parts.length === 4 && parts[1] === "finalize" && parts[3] === "recover" && req.method === "POST") {
      assert((await requestJson(req)).acknowledge === true, "Confirma la revisión antes de reenviar el ensamblado.");
      const jobId = cinematicId.parse(parts[2]);
      const jobRef = db().doc(`cinematicJobs/${jobId}`);
      const job = await db().runTransaction(async tx => {
        const [projectDoc, jobDoc] = await Promise.all([tx.get(ref), tx.get(jobRef)]);
        const current = projectDoc.data() as CinematicProject;
        const old = jobDoc.data() as CinematicFinalizeJob | undefined;
        assert(old?.projectId === pid && current.activeFinalizeJobId === jobId &&
          ["queued", "running"].includes(old.state), "El trabajo ya no está pendiente.");
        assert(Date.now() - (old.dispatchAttemptAt || old.createdAt) > 70 * 60 * 1000 &&
          (old.leaseUntil || 0) < Date.now(), "La ejecución anterior todavía puede estar activa.");
        tx.update(jobRef, { state: "queued", leaseOwner: null, dispatchState: "pending",
          dispatchAttemptAt: Date.now(), updatedAt: Date.now() });
        return old;
      });
      try { await dispatchFinalize(job); }
      catch (error) {
        const safe = safeError(error);
        const definite = ["WORKER_ACCESS", "WORKER_UPDATE", "PROVIDER_REJECTED", "PROVIDER_AUTH", "QUOTA"].includes(safe.code);
        await db().runTransaction(async tx => {
          const current = (await tx.get(ref)).data() as CinematicProject;
          tx.update(jobRef, { dispatchState: definite ? "failed" : "uncertain",
            ...(definite ? { state: "failed" } : {}), error: safe, updatedAt: Date.now() });
          if (definite && current.activeFinalizeJobId === jobId)
            tx.update(ref, { activeFinalizeJobId: null });
        });
        throw error;
      }
      return json({ state: "queued", jobId }, 202);
    }

    if (parts.length === 3 && parts[1] === "media" && req.method === "GET") {
      const { asset } = await readAsset(pid, parts[2]);
      assert(asset.storageObject, "El archivo todavía no está disponible.");
      return mediaResponse(asset.storageObject, req.headers.get("range"));
    }

    if (parts.length === 2 && parts[1] === "final" && req.method === "GET") {
      assert(project.final?.storageObject, "La producción final todavía no está disponible.");
      return mediaResponse(project.final.storageObject, req.headers.get("range"));
    }

    throw new AppError("NOT_FOUND", "Ruta cinematográfica no encontrada.", 404);
  } catch (error) {
    if (error instanceof z.ZodError)
      return json({ error: { code: "VALIDATION", message: error.issues[0]?.message || "Datos inválidos." } }, 400);
    const safe = safeError(error);
    const status = error instanceof AppError ? error.status : 500;
    return json({ error: safe }, status);
  }
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
