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
    const executionName = typeof r.metadata?.name === "string" &&
      r.metadata.name.startsWith(`${resource}/executions/`) ? r.metadata.name : undefined;
    await db().doc(`jobs/${job.id}`).update({
      ...(executionName ? { executionName } : {}),
      operationName: r.name,
      dispatchedAt: Date.now(),
    });
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

// Status checks never dispatch an automatic paid retry.
export async function diagnoseQueuedJob(job: Job) {
  if (job.type === "plan" && job.state === "failed" && job.error?.code === "DIRECTOR_JSON") {
    try {
      const { diagnoseFailedPlan } = await import("./director/plan-diagnostics");
      return await diagnoseFailedPlan(job);
    } catch {
      // Diagnostics must not prevent the owner from opening the project.
      return job;
    }
  }
  if (job.backend === "direct") {
    const stalled = !(job.leaseUntil > Date.now()) &&
      ((job.state === "queued" && Date.now() - Math.max(job.heartbeat || 0, job.dispatchedAt || job.createdAt) > 90000) ||
       (["running", "waiting"].includes(job.state) && Date.now() - job.heartbeat > 180000));
    if (!stalled) return job;
    await db().runTransaction(async tx => {
      const ref = db().doc(`jobs/${job.id}`);
      const current = (await tx.get(ref)).data() as Job | undefined;
      if (current?.backend === "direct" && current.state === job.state && current.heartbeat === job.heartbeat && !(current.leaseUntil > Date.now()))
        tx.update(ref, { state: current.checkpoint.pendingCall ? "needsReview" : "failed", error: {
          code: current.checkpoint.pendingCall ? "AMBIGUOUS" : "DIRECT_CONTINUATION",
          message: current.checkpoint.pendingCall ? "La llamada terminó sin una respuesta guardada. Comprueba la recuperación antes de repetirla." : "Se interrumpió el proceso. Reanudar continuará desde la última parte guardada.",
        } });
    });
    return (await db().doc(`jobs/${job.id}`).get()).data() as Job;
  }
  if (job.state !== "queued" || job.attempts > 0 || job.stopRequested ||
      Date.now() - (job.dispatchedAt || job.createdAt) < 45000) return job;
  const operation = job.operationName || (job.executionName?.includes("/operations/") ? job.executionName : undefined);
  if (operation) {
    const expected = `${required("CLOUD_RUN_JOB_RESOURCE").split("/jobs/")[0]}/operations/`;
    if (!operation.startsWith(expected)) return job;
    try {
      const token = await googleAuth().getAccessToken();
      const res = await fetch(`https://run.googleapis.com/v2/${operation}`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return { ...job, error: { code: "RUN_STATUS", message: `Google no permitió comprobar la ejecución (HTTP ${res.status}). El trabajo sigue sin comenzar; no pulses Reanudar hasta revisar su estado.` } };
      const status = await res.json();
      if (!status.done) return job;
      const error = status.error
        ? { code: "RUN_FAILED", message: `Google no pudo iniciar el ejecutor (${status.error.code || "error"}): ${String(status.error.message || "sin detalles").slice(0, 250)}` }
        : { code: "RUN_NO_JOB", message: "Google terminó la ejecución, pero el trabajo nunca comenzó. Revisa la configuración del ejecutor; no se iniciaron generaciones desde este intento." };
      await db().runTransaction(async tx => {
        const ref = db().doc(`jobs/${job.id}`);
        const current = (await tx.get(ref)).data() as Job | undefined;
        if (current?.state === "queued" && current.attempts === 0 && current.operationName === job.operationName && !(current.leaseUntil > Date.now()))
          tx.update(ref, { error, state: "failed" });
      });
      return (await db().doc(`jobs/${job.id}`).get()).data() as Job;
    } catch {
      return { ...job, error: { code: "RUN_STATUS", message: "No se pudo comprobar la ejecución en Google. Espera unos minutos y actualiza el estado." } };
    }
  }
  if (job.error || job.executionName) return job;
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
