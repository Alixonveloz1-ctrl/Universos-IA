import { db, googlePost, googleAuth } from "./persistence/google";
import { required } from "./config";
import { AppError, assert, safeError } from "./errors";
import { DATA_SCOPE } from "./persistence/scope";
import type { Job, Project } from "./types";
export async function checkWorker(project?: Project) {
  const resource = required("CLOUD_RUN_JOB_RESOURCE");
  assert(
    /^projects\/[a-z0-9-]+\/locations\/[a-z0-9-]+\/jobs\/[a-z0-9-]+$/.test(
      resource,
    ),
    "Recurso de Cloud Run inválido",
  );
  // Refuse to launch a legacy worker that still reads shared collections.
  const token = await googleAuth().getAccessToken();
  const current = await fetch(`https://run.googleapis.com/v2/${resource}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!current.ok) throw new AppError("WORKER_ACCESS", `No se pudo consultar el ejecutor de Google Cloud (HTTP ${current.status}). Revisa sus permisos y configuración.`, 503);
  const labels = (await current.json()).labels;
  if (!labels || labels["firestore-scope"] !== DATA_SCOPE ||
      ((project?.automaticUniverse || project?.previousChapter) && labels["story-flow"] !== "chapters-v1"))
    throw new AppError("WORKER_UPDATE", "Actualiza el ejecutor con ./s en Cloud Shell antes de generar.", 503);
  if (project?.models.text === "gemini-3.1-pro-preview" && labels["model-catalog"] !== "text-v2")
    throw new AppError("WORKER_UPDATE", "Actualiza el ejecutor con ./s para usar este Director.", 503);
  return resource;
}
export async function dispatch(job: Job) {
  let sent = false;
  try {
    const resource = await checkWorker(job.snapshot?.project);
    sent = true;
    const r = await googlePost(
      `https://run.googleapis.com/v2/${resource}:run`,
      {
        overrides: {
          containerOverrides: [{ env: [{ name: "JOB_ID", value: job.id }] }],
          taskCount: 1,
          timeout: "3600s",
        },
      },
    );
    await db().doc(`jobs/${job.id}`).update({ executionName: r.name });
  } catch (e) {
    const error = e instanceof AppError ? safeError(e) : {
      code: "DISPATCH", message: sent
        ? "Google no confirmó el arranque. Reanudar conserva el mismo trabajo."
        : "No se pudo conectar con el ejecutor de Google Cloud. No se inició la generación.",
    };
    await db().runTransaction(async tx => {
      const ref = db().doc(`jobs/${job.id}`);
      const current = (await tx.get(ref)).data() as Job | undefined;
      if (current?.state === "queued" && !current.executionName && !(current.leaseUntil > Date.now()))
        tx.update(ref, { error, ...(!sent ? { state: "failed" } : {}) });
    });
    throw new AppError(error.code, error.message, 503);
  }
}

// Read-only startup check for old queue entries: no automatic paid retry.
export async function diagnoseQueuedJob(job: Job) {
  if (job.state !== "queued" || job.error || job.executionName || Date.now() - job.createdAt < 30000) return job;
  try { await checkWorker(job.snapshot?.project); }
  catch (e) {
    const error = e instanceof AppError ? safeError(e) : { code: "WORKER_ACCESS", message: "No se pudo conectar con el ejecutor de Google Cloud." };
    await db().runTransaction(async tx => {
      const ref = db().doc(`jobs/${job.id}`);
      const current = (await tx.get(ref)).data() as Job | undefined;
      if (current?.state === "queued" && !current.executionName && !(current.leaseUntil > Date.now()))
        tx.update(ref, { error, state: "failed" });
    });
    return (await db().doc(`jobs/${job.id}`).get()).data() as Job;
  }
  return job;
}
