import { db } from "@/lib/persistence/google";
import { validContinuation } from "@/lib/direct-token";
import { scheduleDirect } from "@/lib/direct-dispatch";
import type { Job } from "@/lib/types";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9]{64}$/.test(id)) return new Response(null, { status: 404 });
  const token = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  // Authenticate before reading Firestore. The signature binds this job and step.
  const stepHeader = req.headers.get("x-universos-step");
  const step = Number(stepHeader);
  if (stepHeader === null || !Number.isInteger(step) || step < 0 || !validContinuation(token, id, step))
    return new Response(null, { status: 401 });
  const job = (await db().doc(`jobs/${id}`).get()).data() as Job | undefined;
  if (!job) return new Response(null, { status: 404 });
  if (job.backend === "direct" && job.state === "queued" && !job.stopRequested &&
      !(job.leaseUntil > Date.now()) && Number(job.checkpoint.directStep || 0) === step)
    scheduleDirect(job);
  return Response.json({ accepted: true }, { status: 202 });
}
