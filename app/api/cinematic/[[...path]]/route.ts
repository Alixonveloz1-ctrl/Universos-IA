import { randomUUID } from "node:crypto";
import { z } from "zod";
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
import { imageLimits, model, MODELS, defaults } from "@/lib/models";
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
  type CinematicPlan,
} from "@/lib/cinematic/schema";
import {
  compileCinematicCharacterPrompt,
  compileCinematicOpeningImagePrompt,
  compileCinematicVideoPrompt,
  generateCinematicPlan,
} from "@/lib/cinematic/director";
import type {
  CinematicAsset,
  CinematicFinalizeJob,
  CinematicProject,
} from "@/lib/cinematic/types";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

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
) {
  const result = await imageGenerate(project.models.image, prompt, refs);
  const assetId = randomUUID();
  const ext = imageExtension(result.mime);
  const storageObject = objectPath("cinematic", project.id, `${role}-${characterId || segmentNumber || "asset"}-${assetId}.${ext}`);
  await uploadBytes(storageObject, result.bytes, result.mime);
  const asset: CinematicAsset = {
    id: assetId,
    projectId: project.id,
    kind: "image",
    role,
    model: project.models.image,
    prompt,
    inputRefs,
    state: "candidate",
    storageObject,
    createdAt: Date.now(),
    ...(characterId ? { characterId } : {}),
    ...(segmentNumber ? { segmentNumber } : {}),
  };
  await projectRef(project.id).collection("assets").doc(assetId).set(asset);
  return asset;
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
  );
  const executionName = typeof run.metadata?.name === "string" &&
    run.metadata.name.startsWith(`${resource}/executions/`) ? run.metadata.name : undefined;
  await db().doc(`cinematicJobs/${job.id}`).update({
    ...(executionName ? { executionName } : {}),
    operationName: run.name,
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

    if (parts.length === 1) {
      if (req.method === "GET") {
        const assets = (await ref.collection("assets").get()).docs
          .map(d => d.data() as CinematicAsset)
          .sort((a, b) => a.createdAt - b.createdAt);
        const finalizeJob = project.activeFinalizeJobId
          ? (await db().doc(`cinematicJobs/${project.activeFinalizeJobId}`).get()).data() || null
          : null;
        return json({ project, assets, finalizeJob });
      }
      if (req.method === "DELETE") {
        const assets = (await ref.collection("assets").get()).docs.map(d => d.data() as CinematicAsset);
        for (const asset of assets) if (asset.storageObject) await privateObject(asset.storageObject).delete({ ignoreNotFound: true });
        if (project.final?.storageObject) await privateObject(project.final.storageObject).delete({ ignoreNotFound: true });
        await db().recursiveDelete(ref);
        return json({ ok: true });
      }
    }

    if (parts.length === 2 && parts[1] === "plan" && req.method === "POST") {
      const plan = await generateCinematicPlan(project);
      await ref.update({
        title: plan.title,
        plan,
        approvedCharacters: {},
        approvedImages: {},
        approvedVideos: {},
        final: null,
        updatedAt: Date.now(),
      });
      return json(plan);
    }

    if (parts.length === 4 && parts[1] === "characters" && parts[3] === "image" && req.method === "POST") {
      const characterId = cinematicId.parse(parts[2]);
      assert(project.plan, "Genera primero el plan cinematográfico.");
      const character = project.plan.characters.find(c => c.id === characterId);
      assert(character, "Personaje no encontrado.");
      const prompt = compileCinematicCharacterPrompt(project.plan, character);
      const asset = await saveImageCandidate(project, "character", prompt, [], [], characterId);
      return json(asset, 201);
    }

    if (parts.length === 4 && parts[1] === "segments" && parts[3] === "image" && req.method === "POST") {
      assert(project.plan, "Genera primero el plan cinematográfico.");
      const number = Number(parts[2]);
      const segment = project.plan.segments.find(s => s.number === number);
      assert(segment, "Bloque cinematográfico no encontrado.");
      const refIds = segment.characterIds.map(id => project.approvedCharacters[id]).filter((x): x is string => !!x);
      assert(refIds.length === segment.characterIds.length, "Aprueba primero las referencias de todos los personajes visibles en este bloque.");
      const limits = imageLimits(project.models.image);
      assert(refIds.length <= limits.maxReferenceImages,
        `Este bloque necesita ${refIds.length} referencias y el generador de imagen seleccionado admite ${limits.maxReferenceImages}. Cambia manualmente de generador o reduce el reparto del bloque.`);
      const refs = await assetRefs(project, refIds);
      const prompt = compileCinematicOpeningImagePrompt(project.plan, segment);
      const asset = await saveImageCandidate(project, "segment-image", prompt, refs, refIds, undefined, number);
      return json(asset, 201);
    }

    if (parts.length === 4 && parts[1] === "segments" && parts[3] === "video" && req.method === "POST") {
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
      const assetId = randomUUID();
      const outputPrefix = objectPath("cinematic", project.id, `segment-video-${number}-${assetId}-provider`) + "/";
      const prompt = compileCinematicVideoPrompt(project.plan, segment, project.language, project.accent);
      const operation = await startVideo(
        project.models.video,
        [
          "SOURCE CONTEXT: The supplied starting image and all described people are original fictional AI-generated adult characters for this private production. Preserve their fictional identities without inferring real-world identity.",
          prompt,
        ].join("\n\n"),
        [imageRef],
        `gs://${config().bucket}/${outputPrefix}`,
        segment.durationSeconds,
      );
      const asset: CinematicAsset = {
        id: assetId,
        projectId: project.id,
        kind: "video",
        role: "segment-video",
        model: project.models.video,
        prompt,
        inputRefs: [imageId],
        state: "waiting",
        operation,
        outputPrefix,
        segmentNumber: number,
        createdAt: Date.now(),
      };
      await ref.collection("assets").doc(assetId).set(asset);
      return json(asset, 202);
    }

    if (parts.length === 3 && parts[1] === "videos" && req.method === "GET") {
      const { doc, asset } = await readAsset(pid, parts[2]);
      assert(asset.kind === "video" && asset.role === "segment-video", "Activo de video inválido.");
      if (asset.state === "completed" || asset.state === "failed") return json(asset);
      assert(asset.operation && asset.outputPrefix, "La operación de Veo no está registrada.");
      const result = await pollVideo(asset.model, asset.operation);
      if (!result.done) return json(asset);
      if (result.error) {
        const error = String(result.error.message || "Veo no pudo completar este bloque.").slice(0, 700);
        await doc.update({ state: "failed", error });
        return json({ ...asset, state: "failed", error });
      }
      const uri = result.response?.generatedVideos?.[0]?.video?.uri ||
        result.response?.videos?.[0]?.gcsUri;
      const expected = `gs://${config().bucket}/${asset.outputPrefix}`;
      assert(typeof uri === "string" && uri.startsWith(expected), "Google devolvió un video fuera del destino esperado.");
      const storageObject = uri.slice(`gs://${config().bucket}/`.length);
      await doc.update({ state: "completed", storageObject });
      return json({ ...asset, state: "completed", storageObject });
    }

    if (parts.length === 4 && parts[1] === "assets" && parts[3] === "approve" && req.method === "POST") {
      const assetId = cinematicId.parse(parts[2]);
      const { asset } = await readAsset(pid, assetId);
      assert(asset.state === "candidate" || asset.state === "completed", "El activo todavía no puede aprobarse.");
      const approvedCharacters = { ...project.approvedCharacters };
      const approvedImages = { ...project.approvedImages };
      const approvedVideos = { ...project.approvedVideos };
      if (asset.role === "character") {
        assert(asset.characterId && project.plan, "Referencia de personaje inválida.");
        approvedCharacters[asset.characterId] = asset.id;
        for (const segment of project.plan.segments.filter(s => s.characterIds.includes(asset.characterId!))) {
          delete approvedImages[String(segment.number)];
          delete approvedVideos[String(segment.number)];
        }
      } else if (asset.role === "segment-image") {
        assert(asset.segmentNumber, "Imagen de bloque inválida.");
        approvedImages[String(asset.segmentNumber)] = asset.id;
        delete approvedVideos[String(asset.segmentNumber)];
      } else {
        assert(asset.segmentNumber, "Video de bloque inválido.");
        approvedVideos[String(asset.segmentNumber)] = asset.id;
      }
      await ref.update({
        approvedCharacters,
        approvedImages,
        approvedVideos,
        final: null,
        updatedAt: Date.now(),
      });
      return json({ ok: true });
    }

    if (parts.length === 2 && parts[1] === "finalize" && req.method === "POST") {
      assert(project.plan, "Falta el plan cinematográfico.");
      validateCinematicPlan(project.plan, project.durationSeconds);
      for (const segment of project.plan.segments) {
        const videoId = project.approvedVideos[String(segment.number)];
        assert(videoId, `Aprueba el video del bloque ${segment.number} antes de ensamblar.`);
        const asset = (await ref.collection("assets").doc(videoId).get()).data() as CinematicAsset | undefined;
        assert(asset?.state === "completed" && asset.storageObject, `El video aprobado del bloque ${segment.number} no está disponible.`);
      }
      if (project.activeFinalizeJobId) {
        const active = (await db().doc(`cinematicJobs/${project.activeFinalizeJobId}`).get()).data() as CinematicFinalizeJob | undefined;
        if (active && ["queued", "running"].includes(active.state))
          throw new AppError("ACTIVE_JOB", "Ya hay un ensamblado cinematográfico en ejecución.", 409);
      }
      const jobId = randomUUID();
      const now = Date.now();
      const job: CinematicFinalizeJob = {
        id: jobId,
        projectId: project.id,
        state: "queued",
        error: null,
        createdAt: now,
        updatedAt: now,
      };
      await db().doc(`cinematicJobs/${jobId}`).create(job);
      await ref.update({ activeFinalizeJobId: jobId, updatedAt: now });
      try {
        await dispatchFinalize(job);
      } catch (error) {
        const safe = safeError(error);
        await db().doc(`cinematicJobs/${jobId}`).update({ state: "failed", error: safe, updatedAt: Date.now() });
        throw error;
      }
      return json(job, 202);
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
    const safe = safeError(error);
    const status = error instanceof AppError ? error.status : 500;
    return json({ error: safe }, status);
  }
}

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
