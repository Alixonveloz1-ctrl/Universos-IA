import type { Job } from "./types";

// A local failure or stop does not prove that a paid provider operation ended.
export function blocksNewJob(job: Job, now = Date.now()) {
  return (
    job.leaseUntil > now ||
    ["queued", "running", "waiting", "needsReview"].includes(job.state) ||
    (!job.checkpoint.closedAt &&
      (!!job.checkpoint.pendingCall ||
        (!!job.checkpoint.operation &&
          !job.checkpoint.videoObject &&
          !job.checkpoint.operationFailed &&
          job.state !== "completed")))
  );
}
