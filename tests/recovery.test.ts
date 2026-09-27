// SIMULATED GCS failures/recovery. These tests make no Google requests.
import { beforeEach, expect, it, vi } from "vitest";
const store = vi.hoisted(() => ({
  objects: new Map<string, Buffer>(),
  fail: false,
  listed: [] as string[],
}));
vi.mock("../lib/persistence/google", () => ({
  objectPath: (p: string, v: string, n: string) => `${p}/${v}/${n}`,
  bucket: () => ({
    getFiles: async () => [store.listed.map((name) => ({ name }))],
  }),
  privateObject: (key: string) => ({
    exists: async () => {
      if (store.fail) throw Error("storage unavailable");
      return [store.objects.has(key)];
    },
    download: async () => [store.objects.get(key)],
  }),
}));
import {
  recoverImage,
  recoverVideo,
  assertNoPendingCall,
} from "../worker/recovery";
beforeEach(() => {
  store.objects.clear();
  store.fail = false;
  store.listed = [];
});
it("REGRESSION recovers bytes saved before asset registration without another paid request", async () => {
  store.objects.set("p/version/image.webp", Buffer.from("saved response"));
  const result = await recoverImage("p", "version");
  expect(result?.mime).toBe("image/webp");
  expect(result?.bytes.toString()).toBe("saved response");
});
it("never mistakes a different attempt for the missing result", async () => {
  store.objects.set("p/old/image.png", Buffer.from("old approved image"));
  expect(await recoverImage("p", "new")).toBeNull();
  expect(() => assertNoPendingCall("asset_target")).toThrow("créditos");
});
it("storage errors remain errors rather than triggering a new paid generation", async () => {
  store.fail = true;
  await expect(recoverImage("p", "v")).rejects.toThrow("storage unavailable");
});

it("recovers a completed Veo object when its operation response was lost", async () => {
  store.listed = ["p/version/provider/sample.mp4"];
  expect(await recoverVideo("p", "version")).toBe(store.listed[0]);
});
it("ambiguous or foreign Veo output cannot be silently selected", async () => {
  store.listed = ["p/version/provider/a.mp4", "p/version/provider/b.mp4"];
  await expect(recoverVideo("p", "version")).rejects.toThrow("varios");
  store.listed = ["p/other/provider/a.mp4"];
  await expect(recoverVideo("p", "version")).rejects.toThrow("intento");
});
