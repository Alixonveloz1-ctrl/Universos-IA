import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("google-auth-library", () => ({ GoogleAuth: class { getAccessToken() { return Promise.resolve("unit-test-access"); } }, IdentityPoolClient: class {} }));
vi.mock("@google-cloud/storage", () => ({ Storage: class { bucket() { return { file: () => ({}) }; } } }));
import { mediaResponse } from "../lib/persistence/google";
import { textGenerate } from "../lib/providers/vertex";
beforeEach(() => { vi.stubEnv("GCP_PROJECT_ID", "test-project"); vi.stubEnv("GCS_OUTPUT_BUCKET", "test-bucket"); vi.stubEnv("GCS_PREFIX", "universos-ia"); vi.stubEnv("VERCEL", ""); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("reads existing image bytes directly without signing or exposing credentials", async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 0, 1]);
  const request = vi.fn().mockResolvedValue(new Response(bytes, { headers: { "content-type": "image/png" } })); vi.stubGlobal("fetch", request);
  const response = await mediaResponse("universos-ia/project/version/image.png");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(response.headers.get("authorization")).toBeNull();
  expect(request.mock.calls[0][0]).toContain("?alt=media");
  expect(request.mock.calls[0][1].headers.Authorization).toBe("Bearer unit-test-access");
});
it("preserves video range responses and rejects foreign bucket prefixes", async () => {
  const request = vi.fn().mockResolvedValue(new Response("abc", { status: 206, headers: { "content-range": "bytes 0-2/100", "content-type": "video/mp4" } })); vi.stubGlobal("fetch", request);
  const response = await mediaResponse("universos-ia/project/video.mp4", "bytes=0-2");
  expect(response.status).toBe(206); expect(response.headers.get("content-range")).toBe("bytes 0-2/100");
  expect(request.mock.calls[0][1].headers.Range).toBe("bytes=0-2");
  await expect(mediaResponse("other-project/image.png")).rejects.toMatchObject({ code: "PATH" });
  expect(request).toHaveBeenCalledTimes(1);
});
it("serves a recovered MP4 with a playable MIME type when storage labels it as bytes", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("abc", {
    status: 206, headers: { "content-range": "bytes 0-2/100", "content-type": "application/octet-stream" },
  })));
  const response = await mediaResponse("universos-ia/cinematic/project/recovered.mp4", "bytes=0-2");
  expect(response.status).toBe(206);
  expect(response.headers.get("content-type")).toBe("video/mp4");
  expect(response.headers.get("content-range")).toBe("bytes 0-2/100");
});
it("requests low reasoning on the selected text model and structured JSON", async () => {
  const request = vi.fn().mockResolvedValue(Response.json({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] })); vi.stubGlobal("fetch", request);
  expect(await textGenerate("gemini-3-flash-preview", "A short approved character description", { type: "object" })).toEqual({ ok: true });
  const [url, options] = request.mock.calls[0]; const body = JSON.parse(options.body);
  expect(url).toContain("gemini-3-flash-preview:generateContent");
  expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "LOW" });
  expect(body.generationConfig.responseMimeType).toBe("application/json");
});

it("gives text a bounded 210-second window and a compact output budget", async () => {
  const timeout = vi.spyOn(AbortSignal, "timeout");
  const request = vi.fn().mockResolvedValue(Response.json({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }));
  vi.stubGlobal("fetch", request);
  await textGenerate("gemini-3-flash-preview", "Three brief ideas");
  expect(timeout).toHaveBeenCalledWith(210000);
  expect(JSON.parse(request.mock.calls[0][1].body).generationConfig.maxOutputTokens).toBe(8192);
  timeout.mockRestore();
});
