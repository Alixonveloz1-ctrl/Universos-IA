// REAL local FFmpeg integration; all media is SYNTHETIC, no Google calls.
import sharp from "sharp";
import { it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assemble, probe, validateMedia, lastFrame } from "../worker/media";
const exec = promisify(execFile);
const colors = [
  "red",
  "lime",
  "blue",
  "yellow",
  "cyan",
  "magenta",
  "white",
  "gray",
];
const expectedColors = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
  [0, 255, 255],
  [255, 0, 255],
  [255, 255, 255],
  [128, 128, 128],
];
async function clips(dir: string, incompatible: boolean) {
  const files = [];
  for (let i = 0; i < 8; i++) {
    const file = path.join(dir, `clip-${i}.mp4`);
    await exec("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=${colors[i]}:s=90x160:r=${incompatible && i === 4 ? 30 : 24}:d=8`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${300 + 100 * i}:sample_rate=48000:duration=8`,
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      file,
    ]);
    files.push(file);
  }
  return files;
}
async function verifyOrder(file: string) {
  for (let i = 0; i < 8; i++) {
    const { stdout: pixel } = await exec(
      "ffmpeg",
      [
        "-v",
        "error",
        "-ss",
        String(i * 8 + 4),
        "-i",
        file,
        "-frames:v",
        "1",
        "-vf",
        "scale=1:1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ],
      { encoding: "buffer" },
    );
    expectedColors[i].forEach((component, channel) =>
      expect(Math.abs(pixel[channel] - component)).toBeLessThan(8),
    );
    const { stdout: audio } = await exec(
      "ffmpeg",
      [
        "-v",
        "error",
        "-ss",
        String(i * 8 + 3),
        "-i",
        file,
        "-t",
        "1",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "8000",
        "-f",
        "s16le",
        "pipe:1",
      ],
      { encoding: "buffer" },
    );
    let crossings = 0,
      energy = 0;
    for (let j = 2; j < audio.length; j += 2) {
      const sample = audio.readInt16LE(j);
      energy += (sample / 32768) ** 2;
      if (audio.readInt16LE(j - 2) <= 0 && sample > 0) crossings++;
    }
    expect(Math.abs(crossings - (300 + 100 * i))).toBeLessThan(4);
    expect(Math.sqrt(energy / (audio.length / 2))).toBeGreaterThan(0.05);
  }
}
for (const normalize of [false, true])
  it(`REAL LOCAL FFmpeg: eight distinct colors and tones, normalization=${normalize}`, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "universos-test-"));
    try {
      const files = await clips(dir, normalize);
      const result = await assemble(dir, files);
      expect(result.report.duration).toBeCloseTo(64, 0);
      expect(result.report.normalized).toBe(normalize);
      await verifyOrder(result.output);
      const p = await probe(files[0]);
      expect(() =>
        validateMedia(
          { ...p, streams: p.streams.filter((s) => s.codec_type !== "audio") },
          8,
        ),
      ).toThrow("audio");
      expect(() => validateMedia(p, 6)).toThrow("Duración");
      const truncated = structuredClone(p);
      truncated.streams.find((s) => s.codec_type === "audio")!.duration = "4";
      expect(() => validateMedia(truncated, 8)).toThrow("truncada");
      const incomplete = structuredClone(p);
      incomplete.streams.find((s) => s.codec_type === "video")!.nb_read_frames =
        "N/A";
      expect(() => validateMedia(incomplete, 8)).toThrow("incompletos");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120000);

it("REGRESSION last-frame extraction selects the final frame, not the previous frame", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "universos-frame-"));
  try {
    const file = path.join(dir, "source.mp4"),
      out = path.join(dir, "last.png");
    await exec("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=90x160:r=24:d=8",
      "-vf",
      "drawbox=x=0:y=0:w=iw:h=ih:color=red:t=fill:enable='eq(n,191)'",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      file,
    ]);
    await lastFrame(file, out);
    const { channels } = await sharp(out).stats();
    expect(channels[0].mean).toBeGreaterThan(245);
    expect(channels[2].mean).toBeLessThan(10);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
