import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Job } from "../lib/types";
const m = vi.hoisted(() => ({ after: vi.fn(), execute: vi.fn(), dispatch: vi.fn(), update: vi.fn(), get: vi.fn() }));
vi.mock("next/server", () => ({ after: m.after }));
vi.mock("../worker/main", () => ({ execute: m.execute }));
vi.mock("../lib/jobs", () => ({ dispatch: m.dispatch }));
vi.mock("../lib/persistence/google", () => ({ db: () => ({ doc: () => ({ update: m.update, get: m.get }) }) }));
import { launch } from "../lib/direct-dispatch";
import { validContinuation } from "../lib/direct-token";
const job = { id: "a".repeat(64), type: "bible", state: "queued", backend: "direct", checkpoint: { directStep: 2 } } as unknown as Job;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("APP_ORIGIN", "https://example.test"); vi.stubEnv("SESSION_SECRET", "test-secret"); m.get.mockResolvedValue({ data: () => job }); });
it("continues a saved direct step with a signed server request", async () => {
  const request = vi.fn().mockResolvedValue({ ok: true }); vi.stubGlobal("fetch", request);
  let now = 100000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  m.execute.mockImplementation(async () => { now += 95000; return "continue"; });
  await launch(job);
  expect(m.dispatch).not.toHaveBeenCalled();
  await m.after.mock.calls[0][0]();
  expect(m.execute).toHaveBeenCalledWith(job.id, true);
  const [url, options] = request.mock.calls[0];
  expect(url.toString()).toBe(`https://example.test/api/work/${job.id}`);
  expect(validContinuation(options.headers.Authorization.slice(7), job.id, 2)).toBe(true);
  expect(options.headers["x-universos-step"]).toBe("2");
});
it("hands an already submitted video to Cloud Run without another provider call", async () => {
  m.execute.mockResolvedValue("cloud"); await launch(job); await m.after.mock.calls[0][0]();
  expect(m.update).toHaveBeenCalledWith({ backend: "cloud" });
  expect(m.dispatch).toHaveBeenCalledWith(job);
});
it("keeps final file assembly on Cloud Run", async () => {
  const final = { ...job, type: "finalize" } as Job; await launch(final);
  expect(m.dispatch).toHaveBeenCalledWith(final); expect(m.after).not.toHaveBeenCalled();
});

it("runs short Bible steps in the same invocation without a network handoff", async () => {
  const request = vi.fn(); vi.stubGlobal("fetch", request);
  m.execute.mockResolvedValueOnce("continue").mockResolvedValueOnce("continue").mockResolvedValueOnce(undefined);
  await launch(job); await m.after.mock.calls[0][0]();
  expect(m.execute).toHaveBeenCalledTimes(3); expect(request).not.toHaveBeenCalled();
});
it("retries a failed delivery with the same step, without reexecuting the paid generation", async () => {
  let now = 100000; vi.spyOn(Date, "now").mockImplementation(() => now);
  m.execute.mockImplementation(async () => { now += 95000; return "continue"; });
  const request = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", request);
  await launch(job); await m.after.mock.calls[0][0]();
  expect(m.execute).toHaveBeenCalledTimes(1); expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls.map(c => c[1].headers["x-universos-step"])).toEqual(["2", "2"]);
});
