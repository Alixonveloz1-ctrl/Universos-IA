import type { Job } from "../types";
import { db } from "../persistence/google";
import { planDraftKeys, validateGeneratedPlan, planIssues, describePlanIssues } from "./plan-runner";

// Inspect a saved failed response during the existing authenticated status
// check. This never calls a model, changes a story, resumes or creates a job.
export async function diagnoseFailedPlan(job: Job): Promise<Job> {
  const key = planDraftKeys(job.checkpoint)[0];
  if (!key || job.type !== "plan" || job.state !== "failed" || job.error?.code !== "DIRECTOR_JSON" || job.leaseUntil > Date.now() || job.checkpoint.pendingCall) return job;
  const stamp = `plan-diagnostic-v2:${key}`;
  if (job.checkpoint.planDiagnosticStamp === stamp) return job;
  const ref = db().doc(`jobs/${job.id}`);
  const stored = job.checkpoint[key];
  const external = stored && typeof stored === "object" && "checkpointRef" in stored;
  const raw = external ? (await ref.collection("checkpoints").doc(key).get()).data()?.value : stored;
  if (raw === undefined) return job;
  let issues: ReturnType<typeof planIssues> = [];
  let recoverable = false;
  try { validateGeneratedPlan(raw, job.snapshot); recoverable = true; }
  catch (error) { issues = planIssues(error); }
  const error = { code: "DIRECTOR_JSON", message: recoverable
    ? "El borrador guardado puede recuperarse con la validación actual. Reanudar lo recuperará sin volver a generarlo."
    : `El Director no pudo completar el guion. ${describePlanIssues(issues)}` };
  const updated = await db().runTransaction(async tx => {
    const current = (await tx.get(ref)).data() as Job | undefined;
    if (!current || current.type !== "plan" || current.state !== "failed" || current.error?.code !== "DIRECTOR_JSON" || current.leaseUntil > Date.now() || current.checkpoint.pendingCall || planDraftKeys(current.checkpoint)[0] !== key || current.checkpoint.planDiagnosticStamp === stamp) return false;
    tx.update(ref, { error, checkpoint: { ...current.checkpoint, planDiagnosticStamp: stamp, planDiagnostic: { draftKey: key, recoverable, issues } } });
    return true;
  });
  if (updated) console.warn("director_saved_plan_diagnostic", { jobId: job.id, draftKey: key, recoverable, issues });
  return (await ref.get()).data() as Job;
}
