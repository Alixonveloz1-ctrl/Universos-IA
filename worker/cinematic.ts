import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { db, googleAuth, objectPath, privateObject, readPrivateObject } from "../lib/persistence/google";
import { config } from "../lib/config";
import { AppError, assert, safeError } from "../lib/errors";
import { validateCinematicPlan } from "../lib/cinematic/schema";
import type { CinematicAsset, CinematicFinalizeJob, CinematicProject } from "../lib/cinematic/types";
import { probe, validateMedia } from "./media";

const exec = promisify(execFile);

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
    signal: AbortSignal.timeout(600000),
  });
  if (!result.ok)
    throw new AppError("STORAGE_UPLOAD", `No se pudo guardar el ensamblado cinematográfico (Google ${result.status}).`, 502);
  const saved = await readPrivateObject(key);
  if (!saved.equals(bytes))
    throw new AppError("STORAGE_INTEGRITY", "El archivo cinematográfico guardado no coincide con el ensamblado local.", 502);
}

export async function executeCinematicFinalize(jobId: string) {
  assert(/^[a-f0-9-]{36}$/.test(jobId), "CINEMATIC_JOB_ID inválido.");
  const jobRef = db().doc(`cinematicJobs/${jobId}`);
  const job = (await jobRef.get()).data() as CinematicFinalizeJob | undefined;
  assert(job && ["queued", "running"].includes(job.state), "Trabajo cinematográfico no disponible.");
  const projectRef = db().doc(`cinematicProjects/${job.projectId}`);
  const project = (await projectRef.get()).data() as CinematicProject | undefined;
  assert(project?.owner === "personal" && project.mode === "cinematic-v1" && project.plan, "Producción cinematográfica no disponible.");
  const plan = validateCinematicPlan(project.plan, project.durationSeconds);
  await jobRef.update({ state: "running", updatedAt: Date.now(), error: null });
  const dir = await mkdtemp(path.join(tmpdir(), "universos-cinematic-"));
  try {
    const files: string[] = [];
    for (const segment of plan.segments) {
      const assetId = project.approvedVideos[String(segment.number)];
      assert(assetId, `Falta el bloque aprobado ${segment.number}.`);
      const asset = (await projectRef.collection("assets").doc(assetId).get()).data() as CinematicAsset | undefined;
      assert(asset?.kind === "video" && asset.role === "segment-video" && asset.state === "completed" && asset.storageObject,
        `El bloque ${segment.number} no está listo para ensamblar.`);
      const file = path.join(dir, `segment-${String(segment.number).padStart(2, "0")}.mp4`);
      await writeFile(file, await readPrivateObject(asset.storageObject));
      validateMedia(await probe(file), segment.durationSeconds);
      files.push(file);
    }

    const manifest = path.join(dir, "segments.ffconcat");
    await writeFile(
      manifest,
      "ffconcat version 1.0\n" + files.map(file => `file '${path.basename(file)}'`).join("\n"),
    );
    const output = path.join(dir, "final.mp4");
    try {
      await exec("ffmpeg", [
        "-v", "error", "-y",
        "-f", "concat",
        "-safe", "1",
        "-i", manifest,
        "-c", "copy",
        "-movflags", "+faststart",
        output,
      ], { timeout: 600000, maxBuffer: 8 * 1024 * 1024 });
    } catch (error) {
      const e = error as { stderr?: string; message?: string };
      throw new AppError(
        "CINEMATIC_ASSEMBLY",
        `No se pudieron unir los bloques cinematográficos: ${String(e.stderr || e.message || error).split("\n").filter(Boolean).at(-1)?.slice(0, 700) || "FFmpeg falló"}`,
        422,
      );
    }
    validateMedia(await probe(output), project.durationSeconds);
    const bytes = await readFile(output);
    const storageObject = objectPath("cinematic", project.id, `final-${job.id}.mp4`);
    await uploadBytes(storageObject, bytes, "video/mp4");
    const now = Date.now();
    await projectRef.update({
      final: {
        jobId: job.id,
        storageObject,
        createdAt: now,
        durationSeconds: project.durationSeconds,
      },
      activeFinalizeJobId: null,
      updatedAt: now,
    });
    await jobRef.update({ state: "completed", updatedAt: now, error: null });
  } catch (error) {
    const safe = safeError(error);
    await jobRef.update({ state: "failed", error: safe, updatedAt: Date.now() }).catch(() => {});
    await projectRef.update({ activeFinalizeJobId: null, updatedAt: Date.now() }).catch(() => {});
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

if (process.env.CINEMATIC_JOB_SELF_TEST === "1") {
  const id = randomUUID();
  console.log("cinematic worker loaded", id.length);
}
