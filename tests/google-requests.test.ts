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
  expect(response.headers.get("content-length")).toBe("3");
  expect(response.headers.get("accept-ranges")).toBe("bytes");
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
it("answers Safari's two-byte probe when storage ignores Range", async () => {
  const cancelled = vi.fn();
  const bytes = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array([0, 1, 2, 3])); },
    cancel: cancelled,
  });
  const request = vi.fn().mockResolvedValue(new Response(bytes, {
    headers: { "content-length": "100", "content-type": "binary/octet-stream" },
  }));
  vi.stubGlobal("fetch", request);
  const response = await mediaResponse("universos-ia/project/video.mp4", "bytes=0-1");
  expect(response.status).toBe(206);
  expect(response.headers.get("content-range")).toBe("bytes 0-1/100");
  expect(response.headers.get("content-length")).toBe("2");
  expect(response.headers.get("accept-ranges")).toBe("bytes");
  expect(response.headers.get("content-type")).toBe("video/mp4");
  expect(response.headers.get("cache-control")).toContain("no-transform");
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 1]);
  expect(cancelled).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledOnce();
  expect(request.mock.calls[0][1].headers["Accept-Encoding"]).toBe("identity");
});
it.each([
  ["bytes=3-5", "bytes 3-5/8", [3, 4, 5]],
  ["bytes=5-", "bytes 5-7/8", [5, 6, 7]],
  ["bytes=-2", "bytes 6-7/8", [6, 7]],
  ["bytes=6-100", "bytes 6-7/8", [6, 7]],
])("supports seeking across streamed chunks: %s", async (range, contentRange, expected) => {
  const bytes = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([0, 1]));
      controller.enqueue(new Uint8Array([2, 3, 4]));
      controller.enqueue(new Uint8Array([5, 6, 7]));
      controller.close();
    },
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(bytes, { headers: { "content-length": "8" } })));
  const response = await mediaResponse("universos-ia/project/video.mp4", range);
  expect(response.status).toBe(206);
  expect(response.headers.get("content-range")).toBe(contentRange);
  expect(response.headers.get("content-length")).toBe(String(expected.length));
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual(expected);
});
it("preserves storage's unsatisfiable range response instead of turning it into a server error", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("invalid range", {
    status: 416, headers: { "content-range": "bytes */100" },
  })));
  const response = await mediaResponse("universos-ia/project/video.mp4", "bytes=200-");
  expect(response.status).toBe(416);
  expect(response.headers.get("content-range")).toBe("bytes */100");
  expect(await response.text()).toBe("");
});
it.each(["bytes=8-", "bytes=5-2", "bytes=-0"])("rejects an unsatisfiable fallback range: %s", async (range) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array(8), { headers: { "content-length": "8" } })));
  const response = await mediaResponse("universos-ia/project/video.mp4", range);
  expect(response.status).toBe(416);
  expect(response.headers.get("content-range")).toBe("bytes */8");
  expect(await response.text()).toBe("");
});
it("keeps full MP4 downloads intact", async () => {
  const bytes = new Uint8Array([0, 1, 2, 3]);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(bytes, { headers: { "content-length": "4" } })));
  const response = await mediaResponse("universos-ia/project/video.mp4");
  expect(response.status).toBe(200);
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...bytes]);
});
it("refuses an unknown full-response size rather than sending a broken partial response", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("abc")));
  await expect(mediaResponse("universos-ia/project/video.mp4", "bytes=0-1")).rejects.toMatchObject({ code: "MEDIA_READ" });
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
