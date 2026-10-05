import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
export async function assemble(dir: string, files: string[]) {
  assert(files.length === 8, "Se requieren ocho archivos.");
  const reports: Probe[] = [];
  for (let i = 0; i < files.length; i++) {
    try {
      const report = await probe(files[i]);
      assert(report.streams.some(s => s.codec_type === "video"), `El clip ${i + 1} no contiene video.`);
      assert(report.streams.some(s => s.codec_type === "audio"), `El clip ${i + 1} no contiene audio. Revisa ese clip antes de unir el capítulo.`, "MISSING_AUDIO");
      reports.push(report);
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError("ASSEMBLY_INPUT", `No se pudo leer el clip aprobado ${i + 1}: ${String((e as Error)?.message || e).split("\n")[0].slice(0, 500)}`, 422);
    }
  }

  // One FFmpeg pass: decode all eight approved clips, normalize only transport
  // properties, concatenate in strict 1..8 order, and encode one final MP4.
  // This avoids fragile intermediate files and concat-demuxer codec/timestamp
  // assumptions while preserving every clip's original audible content.
  const filters: string[] = [];
  for (let i = 0; i < files.length; i++) {
    filters.push(
      `[${i}:v:0]scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,fps=24,setsar=1,setpts=PTS-STARTPTS[v${i}]`,
      `[${i}:a:0]aresample=48000:async=1:first_pts=0,aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`,
    );
  }
  const concatInputs = files.map((_, i) => `[v${i}][a${i}]`).join("");
  filters.push(`${concatInputs}concat=n=8:v=1:a=1[outv][outa]`);

  const output = path.join(dir, "final.mp4");
  const args = [
    "-v", "error", "-y",
    ...files.flatMap(file => ["-i", file]),
    "-filter_complex", filters.join(";"),
    "-map", "[outv]",
    "-map", "[outa]",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-ar", "48000",
    "-ac", "2",
    "-movflags", "+faststart",
    output,
  ];
  try {
    await exec("ffmpeg", args, { timeout: 600000, maxBuffer: 8 * 1024 * 1024 });
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    throw new AppError(
      "ASSEMBLY_FFMPEG",
      `FFmpeg no pudo unir los ocho clips aprobados: ${String(err.stderr || err.message || e).split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 700) || "error desconocido"}`,
      422,
    );
  }

  let finalProbe: Probe;
  try {
    finalProbe = await probe(output);
  } catch (e) {
    throw new AppError("ASSEMBLY_OUTPUT", `El MP4 final se creó pero no pudo verificarse: ${String((e as Error)?.message || e).split("\n")[0].slice(0, 500)}`, 422);
  }
  const video = finalProbe.streams.find(s => s.codec_type === "video");
  const audio = finalProbe.streams.find(s => s.codec_type === "audio");
  assert(video && audio, "La exportación final no contiene video y audio.");

  return {
    output,
    report: {
      duration: Number(finalProbe.format.duration),
      width: video.width,
      height: video.height,
      audioCodec: audio.codec_name,
      videoCodec: video.codec_name,
      normalized: true,
      assembly: "single-pass-concat-filter",
      order: [1, 2, 3, 4, 5, 6, 7, 8],
      clips: reports.map((r, i) => ({
        clip: i + 1,
        sourceDuration: Number(r.format.duration),
        videoCodec: r.streams.find(s => s.codec_type === "video")?.codec_name,
        audioCodec: r.streams.find(s => s.codec_type === "audio")?.codec_name || null,
      })),
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
