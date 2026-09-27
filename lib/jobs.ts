import { db, googlePost } from "./persistence/google";
import { required } from "./config";
import { AppError, assert } from "./errors";
import type { Job } from "./types";
export async function dispatch(job: Job) {
  const resource = required("CLOUD_RUN_JOB_RESOURCE");
  assert(
    /^projects\/[a-z0-9-]+\/locations\/[a-z0-9-]+\/jobs\/[a-z0-9-]+$/.test(
      resource,
    ),
    "Recurso de Cloud Run inválido",
  );
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
