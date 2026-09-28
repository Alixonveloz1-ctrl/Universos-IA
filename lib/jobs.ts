import { db, googlePost, googleAuth } from "./persistence/google";
import { required } from "./config";
import { AppError, assert } from "./errors";
import { DATA_SCOPE } from "./persistence/scope";
import type { Job } from "./types";
export async function dispatch(job: Job) {
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
  const labels = current.ok ? (await current.json()).labels : undefined;
  if (!labels || labels["firestore-scope"] !== DATA_SCOPE ||
      (job.snapshot?.project.automaticUniverse && labels["story-flow"] !== "automatic-universe-v1"))
    throw new AppError("WORKER_UPDATE", "Actualiza el ejecutor con ./s en Cloud Shell antes de generar.", 503);
  try {
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
    await db()
      .doc(`jobs/${job.id}`)
      .update({
        dispatchError:
          "No se confirmó el arranque. Reanudar conserva el mismo trabajo.",
      });
    throw new AppError(
      "DISPATCH",
      e instanceof AppError
        ? e.message
        : "No se confirmó el arranque del ejecutor.",
      503,
    );
  }
}
