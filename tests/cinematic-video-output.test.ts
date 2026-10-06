import { beforeEach, expect, it, vi } from "vitest";

const getFiles = vi.hoisted(() => vi.fn());
const getMetadata = vi.hoisted(() => vi.fn());
const copy = vi.hoisted(() => vi.fn());
vi.mock("../lib/persistence/google", () => ({
  bucket: () => ({ getFiles, file: (name: string) => ({ name, getMetadata: () => getMetadata(name), copy: (to: { name: string }) => copy(name, to.name) }) }),
  privateObject: (name: string) => {
    if (!name.startsWith("isolated/")) throw new Error("Objeto fuera del prefijo");
  },
}));
vi.mock("../lib/config", () => ({ config: () => ({ bucket: "right", prefix: "isolated" }) }));

import { findCinematicVideoObject } from "../lib/cinematic/video-output";

const prefix = "isolated/cinematic/project/segment-video-4-attempt-provider/";

beforeEach(() => {
  getFiles.mockReset();
  getMetadata.mockReset();
  copy.mockReset();
  getFiles.mockResolvedValue([[]]);
  getMetadata.mockResolvedValue([{ size: "12345", contentType: "video/mp4" }]);
});

it("recovers the actual MP4 from this attempt's bucket prefix when Veo omits its URI", async () => {
  const key = prefix + "timestamp/sample_0.mp4";
  getFiles.mockResolvedValue([[{ name: key }]]);
  expect(await findCinematicVideoObject({ response: { videos: [] } }, prefix, "attempt"))
    .toBe(key);
  expect(getFiles).toHaveBeenCalledWith({ prefix, maxResults: 20 });
  expect(copy).not.toHaveBeenCalled();
});

it("copies a real video returned by this operation outside the private attempt directory", async () => {
  const key = "timestamped-output/sample_0.mp4";
  expect(await findCinematicVideoObject({ response: { videos: [{ gcsUri: `gs://right/${key}` }] } }, prefix, "attempt"))
    .toBe(prefix + "recovered-attempt.mp4");
  expect(copy).toHaveBeenCalledWith(key, prefix + "recovered-attempt.mp4");
});

it("uses the exact operation URI even if bucket listing is temporarily unavailable", async () => {
  getFiles.mockRejectedValue(new Error("listing unavailable"));
  const key = prefix + "sample_0.mp4";
  expect(await findCinematicVideoObject({ response: { videos: [{ gcsUri: `gs://right/${key}` }] } }, prefix, "attempt"))
    .toBe(key);
});

it("does not invent a video when Google filtered the operation or returned another bucket", async () => {
  expect(await findCinematicVideoObject({ response: { raiMediaFilteredCount: 1 } }, prefix, "attempt"))
    .toBeNull();
  expect(await findCinematicVideoObject({ response: { videos: [{ gcsUri: "gs://other/sample_0.mp4" }] } }, prefix, "attempt"))
    .toBeNull();
  expect(copy).not.toHaveBeenCalled();
});

it("never exposes an empty object as a playable candidate", async () => {
  getFiles.mockResolvedValue([[{ name: prefix + "sample_0.mp4" }]]);
  getMetadata.mockResolvedValue([{ size: "0", contentType: "video/mp4" }]);
  expect(await findCinematicVideoObject({ response: {} }, prefix, "attempt")).toBeNull();
});
