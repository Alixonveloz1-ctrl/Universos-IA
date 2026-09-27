import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ post: vi.fn(), update: vi.fn() }));
vi.mock("../lib/persistence/google", () => ({
  googleAuth: () => ({ getAccessToken: async () => "test-token" }),
  googlePost: mocks.post,
  db: () => ({ doc: () => ({ update: mocks.update }) }),
}));
import { dispatch } from "../lib/jobs";
import type { Job } from "../lib/types";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
it("never launches a legacy worker against shared data", async () => {
  vi.stubEnv("CLOUD_RUN_JOB_RESOURCE", "projects/test-project/locations/us-central1/jobs/universos-worker");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ labels: {} })));
  await expect(dispatch({ id: "job" } as Job)).rejects.toThrow("./s");
  expect(mocks.post).not.toHaveBeenCalled();
});
it("launches the isolated worker and tracks the execution", async () => {
  vi.stubEnv("CLOUD_RUN_JOB_RESOURCE", "projects/test-project/locations/us-central1/jobs/universos-worker");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ labels: { "firestore-scope": "universos-ia-v1" } })));
  mocks.post.mockResolvedValue({ name: "execution" });
  await dispatch({ id: "job" } as Job);
  expect(mocks.post).toHaveBeenCalledOnce();
  expect(mocks.update).toHaveBeenCalledWith({ executionName: "execution" });
});
