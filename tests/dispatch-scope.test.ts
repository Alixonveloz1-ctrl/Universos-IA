import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ post: vi.fn(), update: vi.fn(), job: { state: "queued", leaseUntil: 0, attempts: 0 } as Record<string, unknown> }));
vi.mock("../lib/persistence/google", () => ({
  googleAuth: () => ({ getAccessToken: async () => "test-token" }),
  googlePost: mocks.post,
  db: () => ({
    doc: () => ({ update: mocks.update, get: async () => ({ data: () => mocks.job }) }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
      get: async () => ({ data: () => mocks.job }),
      update: (_ref: unknown, patch: unknown) => mocks.update(patch),
    }),
  }),
}));
import { dispatch, diagnoseQueuedJob } from "../lib/jobs";
import type { Job } from "../lib/types";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); mocks.job = { state: "queued", leaseUntil: 0, attempts: 0 }; });
it("never launches a legacy worker against shared data", async () => {
  vi.stubEnv("CLOUD_RUN_JOB_RESOURCE", "projects/test-project/locations/us-central1/jobs/universos-worker");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ labels: {} })));
  await expect(dispatch({ id: "job" } as Job)).rejects.toThrow("./s");
  expect(mocks.post).not.toHaveBeenCalled();
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ state: "failed", error: expect.objectContaining({ code: "WORKER_UPDATE" }) }));
});
it("launches the isolated worker and tracks the execution", async () => {
  vi.stubEnv("CLOUD_RUN_JOB_RESOURCE", "projects/test-project/locations/us-central1/jobs/universos-worker");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ labels: { "firestore-scope": "universos-ia-v1" } })));
  mocks.post.mockResolvedValue({ name: "projects/test-project/locations/us-central1/operations/abc", metadata: { name: "projects/test-project/locations/us-central1/jobs/universos-worker/executions/example" } });
  await dispatch({ id: "job" } as Job);
  expect(mocks.post).toHaveBeenCalledOnce();
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ executionName: "projects/test-project/locations/us-central1/jobs/universos-worker/executions/example", operationName: "projects/test-project/locations/us-central1/operations/abc" }));
});
it("blocks automatic-universe projects on a worker with the old story flow", async () => {
  vi.stubEnv("CLOUD_RUN_JOB_RESOURCE", "projects/test-project/locations/us-central1/jobs/universos-worker");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ labels: { "firestore-scope": "universos-ia-v1" } })));
  await expect(dispatch({ id: "job", snapshot: { project: { automaticUniverse: true } } } as Job)).rejects.toThrow("./s");
  expect(mocks.post).not.toHaveBeenCalled();
});
it("reports denied Cloud Run access without pretending the worker is outdated", async () => {
  vi.stubEnv("CLOUD_RUN_JOB_RESOURCE", "projects/test-project/locations/us-central1/jobs/universos-worker");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 403 })));
  await expect(dispatch({ id: "job" } as Job)).rejects.toThrow("HTTP 403");
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ state: "failed" }));
  expect(mocks.post).not.toHaveBeenCalled();
});
it("flags a completed Cloud Run operation that never started the stored job without launching another", async () => {
  vi.stubEnv("CLOUD_RUN_JOB_RESOURCE", "projects/test-project/locations/us-central1/jobs/universos-worker");
  const operationName = "projects/test-project/locations/us-central1/operations/abc";
  mocks.job = { state: "queued", leaseUntil: 0, attempts: 0, operationName };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ done: true, response: { name: "execution" } })));
  const job = { id: "job", projectId: "story", state: "queued", operationName, createdAt: Date.now() - 60000, leaseUntil: 0, attempts: 0 } as Job;
  await diagnoseQueuedJob(job);
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ state: "failed", error: expect.objectContaining({ code: "RUN_NO_JOB" }) }));
  expect(mocks.post).not.toHaveBeenCalled();
});
