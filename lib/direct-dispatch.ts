import { after } from "next/server";
import { db } from "./persistence/google";
import { required } from "./config";
import { dispatch } from "./jobs";
import { continuationToken } from "./direct-token";
import { safeError } from "./errors";
import type { Job } from "./types";

export function scheduleDirect(job: Job) {
  after(async () => {
    try {
      const { execute } = await import("../worker/main");
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
      const step = Number(current.checkpoint.directStep || 0);
      const url = new URL(`/api/work/${job.id}`, required("APP_ORIGIN"));
      const result = await fetch(url, {
        method: "POST", redirect: "error",
        headers: { "Authorization": `Bearer ${continuationToken(job.id, step)}`, "x-universos-step": String(step) },
        signal: AbortSignal.timeout(20000),
      });
      if (!result.ok) throw new Error(`Continuation HTTP ${result.status}`);
    } catch (e) {
      console.error("Direct generation continuation", safeError(e));
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
