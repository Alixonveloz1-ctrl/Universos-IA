import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError, assert } from "../lib/errors";
const exec = promisify(execFile);
export interface Probe {
  streams: {
    codec_type: string;
    codec_name: string;
    time_base: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
    nb_read_frames?: string;
    sample_rate?: string;
    channels?: number;
    duration?: string;
    start_time?: string;
    pix_fmt?: string;
    channel_layout?: string;
  }[];
  format: { duration: string; format_name: string };
}
export async function probe(file: string) {
  const { stdout } = await exec(
    "ffprobe",
    [
      "-v",
      "error",
      "-count_frames",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      file,
    ],
    { maxBuffer: 4 * 1024 * 1024, timeout: 120000 },
  );
  return JSON.parse(stdout) as Probe;
}
function fps(s: string | undefined) {
  const [a, b] = String(s || "0/1")
    .split("/")
    .map(Number);
  return a / b;
}
export function validateMedia(p: Probe, duration: number) {
  const v = p.streams.find((s) => s.codec_type === "video"),
    a = p.streams.find((s) => s.codec_type === "audio");
  if (!v || !a)
    throw new AppError(
      "MISSING_AUDIO",
      "El archivo debe contener video y audio nativo.",
      422,
    );
  const rate = fps(v.r_frame_rate);
  assert(Number.isFinite(rate) && rate > 0, "Framerate inválido");
  assert(
    [
      Number(p.format.duration),
      Number(v.nb_read_frames),
      v.width,
      v.height,
      Number(a.duration),
      Number(a.start_time),
      Number(v.start_time),
    ].every((n) => typeof n === "number" && Number.isFinite(n)),
    "Metadatos audiovisuales incompletos",
  );
  const tolerance = 1 / rate + 0.025;
  if (
    Math.abs(Number(p.format.duration) - duration) > tolerance ||
    Math.abs(Number(v.nb_read_frames) / rate - duration) > tolerance
  )
    throw new AppError(
      "DURATION",
      `Duración incompatible con ${duration} segundos.`,
      422,
    );
  if (
    Math.abs(Number(a.duration) - duration) > tolerance ||
    Math.abs(Number(a.start_time) - Number(v.start_time)) > tolerance
  )
    throw new AppError(
      "AUDIO_TIMING",
      "La pista de audio está truncada o desincronizada.",
      422,
    );
  if (v.width! >= v.height! || Math.abs(v.width! / v.height! - 9 / 16) > 0.02)
    throw new AppError("FORMAT", "El video debe ser vertical 9:16.", 422);
  if (!p.format.format_name.includes("mp4"))
    throw new AppError("FORMAT", "Se requiere MP4.", 422);
  return {
    duration: Number(p.format.duration),
    frames: Number(v.nb_read_frames),
    fps: rate,
    width: v.width,
    height: v.height,
    audioDuration: Number(a.duration),
    audioStart: Number(a.start_time),
    videoStart: Number(v.start_time),
    audioCodec: a.codec_name,
    videoCodec: v.codec_name,
    toleranceSeconds: tolerance,
  };
}
function signature(p: Probe) {
  return JSON.stringify(
    p.streams.map((s) => ({
      type: s.codec_type,
      codec: s.codec_name,
      timebase: s.time_base,
      w: s.width,
      h: s.height,
      rate: s.r_frame_rate,
      sample: s.sample_rate,
      channels: s.channels,
      layout: s.channel_layout,
      pix: s.pix_fmt,
    })),
  );
}
export async function assemble(dir: string, files: string[]) {
  assert(files.length === 8, "Se requieren ocho archivos.");
  const reports = await Promise.all(files.map(probe));
  reports.forEach((r) => validateMedia(r, 8));
  let normalized = false;
  let inputs = files;
  if (!reports.every((r) => signature(r) === signature(reports[0]))) {
    normalized = true;
    inputs = [];
    for (let i = 0; i < files.length; i++) {
      const output = path.join(dir, `normalized-${i}.mp4`);
      await exec(
        "ffmpeg",
        [
          "-v",
          "error",
          "-y",
          "-i",
          files[i],
          "-map",
          "0:v:0",
          "-map",
          "0:a:0",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-vf",
          "scale=720:1280,fps=24",
          "-c:a",
          "aac",
          "-ar",
          "48000",
          "-ac",
          "2",
          output,
        ],
        { timeout: 300000 },
      );
      validateMedia(await probe(output), 8);
      inputs.push(output);
    }
  }
  const manifest = path.join(dir, "clips.ffconcat");
  await writeFile(
    manifest,
    "ffconcat version 1.0\n" +
      inputs
        .map((f) => {
          const n = path.basename(f);
          assert(/^[a-zA-Z0-9_.-]+$/.test(n), "Nombre de archivo inválido");
          return `file '${n}'`;
        })
        .join("\n"),
  );
  const output = path.join(dir, "final.mp4");
  await exec(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-f",
      "concat",
      "-safe",
      "1",
      "-i",
      manifest,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0",
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      output,
    ],
    { timeout: 300000 },
  );
  const report = validateMedia(await probe(output), 64);
  const timeline = await validateTimeline(output, report.toleranceSeconds);
  return {
    output,
    report: {
      ...report,
      normalized,
      timeline,
      clips: reports.map((r) => validateMedia(r, 8)),
    },
  };
}
export async function lastFrame(file: string, out: string) {
  const p = await probe(file);
  const frames = Number(
    p.streams.find((s) => s.codec_type === "video")?.nb_read_frames,
  );
  assert(
    Number.isInteger(frames) && frames > 0,
    "No se pudo identificar el último fotograma.",
  );
  await exec(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-i",
      file,
      "-vf",
      `select=eq(n\\,${frames - 1})`,
      "-frames:v",
      "1",
      out,
    ],
    { timeout: 30000 },
  );
}

export async function validateTimeline(file: string, tolerance: number) {
  const result: Record<string, { maxGap: number; maxOverlap: number }> = {};
  for (const stream of ["v:0", "a:0"]) {
    const { stdout } = await exec(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        stream,
        "-show_packets",
        "-show_entries",
        "packet=pts_time,duration_time",
        "-of",
        "json",
        file,
      ],
      { maxBuffer: 8 * 1024 * 1024, timeout: 120000 },
    );
    const packets = (
      JSON.parse(stdout).packets as {
        pts_time: string;
        duration_time: string;
      }[]
    )
      .map((p) => ({
        start: Number(p.pts_time),
        duration: Number(p.duration_time),
      }))
      .sort((a, b) => a.start - b.start);
    assert(
      packets.length &&
        packets.every(
          (p) =>
            Number.isFinite(p.start) &&
            Number.isFinite(p.duration) &&
            p.duration > 0,
        ),
      "No se pudo validar la continuidad temporal.",
    );
    let maxGap = 0,
      maxOverlap = 0;
    for (let i = 1; i < packets.length; i++) {
      const delta =
        packets[i].start - packets[i - 1].start - packets[i - 1].duration;
      maxGap = Math.max(maxGap, delta);
      maxOverlap = Math.max(maxOverlap, -delta);
    }
    assert(
      maxGap <= tolerance && maxOverlap <= tolerance,
      "La exportación contiene huecos o solapamientos audiovisuales.",
    );
    result[stream] = { maxGap, maxOverlap };
  }
  return result;
}
