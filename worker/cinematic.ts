import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { db, googleAuth, objectPath, privateObject, readPrivateObject } from "../lib/persistence/google";
import { config } from "../lib/config";
import { AppError, assert, safeError } from "../lib/errors";
import type { CinematicAsset, CinematicFinalizeJob, CinematicProject } from "../lib/cinematic/types";
import { probe, validateMedia, validateTimeline } from "./media";

const exec = promisify(execFile);

async function uploadBytes(key: string, bytes: Buffer) {
  privateObject(key);
  const token = await googleAuth().getAccessToken();
  const upload = new URL(`https://storage.googleapis.com/upload/storage/v1/b/${config().bucket}/o`);
  upload.searchParams.set("uploadType", "media");
  upload.searchParams.set("name", key);
  upload.searchParams.set("ifGenerationMatch", "0");
  const result = await fetch(upload, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "video/mp4" },
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(600000),
  });
  // A prior execution may have uploaded before its Firestore commit.
  if (!result.ok && result.status !== 412)
    throw new AppError("STORAGE_UPLOAD", `No se pudo guardar el ensamblado cinematográfico (Google ${result.status}).`, 502);
  const saved = await readPrivateObject(key);
  if (result.ok && !saved.equals(bytes) || !saved.length)
    throw new AppError("STORAGE_INTEGRITY", "El archivo cinematográfico guardado no coincide con el ensamblado local.", 502);
}

export function currentManifest(project: CinematicProject, job: CinematicFinalizeJob) {
  return !project.deleting && project.activeFinalizeJobId === job.id &&
    (project.revision || 0) === job.revision &&
    (project.planRevision || 0) === job.planRevision &&
    job.segments.every(s => project.approvedVideos[String(s.number)] === s.assetId);
}

export async function executeCinematicFinalize(jobId: string) {
  assert(/^[a-f0-9-]{36}$/.test(jobId), "CINEMATIC_JOB_ID inválido.");
  const jobRef = db().doc(`cinematicJobs/${jobId}`);
  const initial = (await jobRef.get()).data() as CinematicFinalizeJob | undefined;
  assert(initial?.projectId, "Trabajo cinematográfico no disponible.");
  const projectRef = db().doc(`cinematicProjects/${initial.projectId}`);
  const owner = randomUUID();
  const job = await db().runTransaction(async tx => {
    const [jobDoc, projectDoc] = await Promise.all([tx.get(jobRef), tx.get(projectRef)]);
    const j = jobDoc.data() as CinematicFinalizeJob | undefined;
    const p = projectDoc.data() as CinematicProject | undefined;
    assert(j && p && p.owner === "personal" && p.mode === "cinematic-v1" && j.projectId === p.id,
      "Producción cinematográfica no disponible.");
    if (j.state === "completed" || j.state === "superseded") return null;
    assert(j.state === "queued" || j.state === "running", "Trabajo cinematográfico no disponible.");
    if (!Array.isArray(j.segments) || !j.segments.length) {
      tx.update(jobRef, { state: "failed", error: { code: "MANIFEST", message: "El trabajo anterior no tiene manifiesto. Vuelve a ensamblar." }, updatedAt: Date.now() });
      if (p.activeFinalizeJobId === jobId) tx.update(projectRef, { activeFinalizeJobId: null });
      return null;
    }
    if (!currentManifest(p, j)) {
      tx.update(jobRef, { state: "superseded", updatedAt: Date.now() });
      if (p.activeFinalizeJobId === jobId) tx.update(projectRef, { activeFinalizeJobId: null });
      return null;
    }
    assert(j.state !== "running" || (j.leaseUntil || 0) < Date.now(),
      "Otro ejecutor sigue ensamblando este trabajo.");
    tx.update(jobRef, { state: "running", leaseOwner: owner,
      leaseUntil: Date.now() + 70 * 60 * 1000, updatedAt: Date.now(), error: null });
    return j;
  });
  if (!job) return;

  const dir = await mkdtemp(path.join(tmpdir(), "universos-cinematic-"));
  try {
    const files: string[] = [];
    for (const segment of job.segments) {
      const asset = (await projectRef.collection("assets").doc(segment.assetId).get()).data() as CinematicAsset | undefined;
      assert(asset?.state === "completed" && asset.role === "segment-video" &&
        asset.storageObject === segment.storageObject && asset.segmentNumber === segment.number,
        `El bloque ${segment.number} del manifiesto no está disponible.`);
      const file = path.join(dir, `segment-${String(segment.number).padStart(2, "0")}.mp4`);
      await writeFile(file, await readPrivateObject(segment.storageObject));
      validateMedia(await probe(file), segment.durationSeconds);
      files.push(file);
    }

    // Normalize streams and timestamps. Valid Veo clips can have different
    // codecs and time bases, which cannot safely be joined with stream copy.
    const filters = job.segments.flatMap((s, i) => [
      `[${i}:v]fps=30,scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=0.1,trim=duration=${s.durationSeconds},setpts=PTS-STARTPTS[v${i}]`,
      `[${i}:a]aresample=async=1:first_pts=0,apad,atrim=duration=${s.durationSeconds},asetpts=PTS-STARTPTS[a${i}]`,
    ]).join(";") + ";" + job.segments.map((_, i) => `[v${i}][a${i}]`).join("") +
      `concat=n=${job.segments.length}:v=1:a=1[v][a]`;
    const output = path.join(dir, "final.mp4");
    try {
      await exec("ffmpeg", [
        "-v", "error", "-y", ...files.flatMap(file => ["-i", file]),
        "-filter_complex", filters, "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30",
        "-c:a", "aac", "-ar", "48000", "-ac", "2",
        "-movflags", "+faststart", output,
      ], { timeout: 3000000, maxBuffer: 8 * 1024 * 1024 });
    } catch (error) {
      const e = error as { stderr?: string; message?: string };
      throw new AppError("CINEMATIC_ASSEMBLY",
        `No se pudieron unir los bloques: ${String(e.stderr || e.message || error).split("\n").filter(Boolean).at(-1)?.slice(0, 700) || "FFmpeg falló"}`, 422);
    }
    validateMedia(await probe(output), job.durationSeconds);
    await validateTimeline(output, 0.07);
    const storageObject = objectPath("cinematic", job.projectId, `final-${job.id}.mp4`);
    await uploadBytes(storageObject, await readFile(output));
    await db().runTransaction(async tx => {
      const [projectDoc, jobDoc] = await Promise.all([tx.get(projectRef), tx.get(jobRef)]);
      const current = projectDoc.data() as CinematicProject;
      const state = jobDoc.data() as CinematicFinalizeJob;
      assert(state.state === "running" && state.leaseOwner === owner, "El trabajo ya tiene otro ejecutor.");
      const now = Date.now();
      tx.update(jobRef, { state: currentManifest(current, job) ? "completed" : "superseded",
        storageObject, leaseOwner: null, updatedAt: now, error: null });
      if (current.activeFinalizeJobId === job.id) {
        tx.update(projectRef, currentManifest(current, job)
          ? { final: { jobId: job.id, storageObject, createdAt: now, durationSeconds: job.durationSeconds },
              activeFinalizeJobId: null, updatedAt: now }
          : { activeFinalizeJobId: null, updatedAt: now });
      }
    });
  } catch (error) {
    const safe = safeError(error);
    await db().runTransaction(async tx => {
      const [jobDoc, projectDoc] = await Promise.all([tx.get(jobRef), tx.get(projectRef)]);
      const state = jobDoc.data() as CinematicFinalizeJob | undefined;
      const p = projectDoc.data() as CinematicProject | undefined;
      if (state?.state !== "running" || state.leaseOwner !== owner) return;
      tx.update(jobRef, { state: "failed", error: safe, leaseOwner: null, updatedAt: Date.now() });
      if (p?.activeFinalizeJobId === job.id) tx.update(projectRef, { activeFinalizeJobId: null });
    }).catch(() => {});
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
