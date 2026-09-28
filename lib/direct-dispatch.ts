import { after } from "next/server";
import { db } from "./persistence/google";
import { required } from "./config";
import { dispatch } from "./jobs";
import { continuationToken } from "./direct-token";
import { logFailure } from "./errors";
import type { Job } from "./types";

export function scheduleDirect(job: Job) {
  after(async () => {
    const started = Date.now();
    try {
      const { execute } = await import("../worker/main");
      for (;;) {
        const next = await execute(job.id, true);
        if (!next) return;
        const ref = db().doc(`jobs/${job.id}`);
        const current = (await ref.get()).data() as Job;
        if (!current || current.state !== "queued") return;
        if (current.stopRequested) {
          await db().runTransaction(async tx => {
            const latest = (await tx.get(ref)).data() as Job | undefined;
            if (latest?.state === "queued" && latest.stopRequested && !(latest.leaseUntil > Date.now())) tx.update(ref, { state: "stopped" });
          });
          return;
        }
        if (next === "cloud") {
          await ref.update({ backend: "cloud" });
          await dispatch(current);
          return;
        }
        // Continue short saved steps locally. Leave enough time for a full
        // 210s text call + persistence inside Vercel's 300s execution.
        if (Date.now() - started < 30000) continue;
        const step = Number(current.checkpoint.directStep || 0);
        const url = new URL(`/api/work/${job.id}`, required("APP_ORIGIN"));
        // Retrying this handoff never retries a model call: the signed step,
        // transaction lease and stored checkpoints make duplicate delivery safe.
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const result = await fetch(url, {
              method: "POST", redirect: "error",
              headers: { "Authorization": `Bearer ${continuationToken(job.id, step)}`, "x-universos-step": String(step) },
              signal: AbortSignal.timeout(10000),
            });
            if (!result.ok) throw new Error(`Continuation HTTP ${result.status}`);
            return;
          } catch (error) {
            logFailure("continuation_delivery", error);
            if (attempt === 2) throw error;
          }
        }
      }
    } catch (e) {
      logFailure("direct_generation", e);
      // Do not overwrite an invocation that already accepted the handoff.
      await db().runTransaction(async tx => {
        const ref = db().doc(`jobs/${job.id}`);
        const j = (await tx.get(ref)).data() as Job | undefined;
        if (j?.state === "queued" && j.backend === "direct" && !(j.leaseUntil > Date.now()))
          tx.update(ref, { state: "failed", error: { code: "DIRECT_CONTINUATION", message: "Se interrumpió la continuación. Reanudar conserva las partes terminadas." } });
      });
    }
  });
}

export async function launch(job: Job) {
  if (job.type === "finalize") return dispatch(job);
  await db().doc(`jobs/${job.id}`).update({ backend: "direct", dispatchedAt: Date.now() });
  scheduleDirect(job);
}
