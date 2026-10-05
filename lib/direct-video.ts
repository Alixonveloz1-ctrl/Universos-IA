import { AppError } from "./errors";

export function verifiedVideoObject(result: { response?: {
  generatedVideos?: { video?: { uri?: string } }[];
  videos?: { gcsUri?: string }[];
} }, bucket: string, outputPrefix: string) {
  const uri = result.response?.generatedVideos?.[0]?.video?.uri || result.response?.videos?.[0]?.gcsUri;
  const expected = `gs://${bucket}/${outputPrefix}`;
  if (typeof uri !== "string" || !uri.startsWith(expected) || !uri.endsWith(".mp4"))
    throw new AppError("VIDEO_OUTPUT", "Google finalizó sin un MP4 válido en el destino esperado.", 502);
  return uri.slice(`gs://${bucket}/`.length);
}
