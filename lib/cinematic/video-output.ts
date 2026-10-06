import { bucket, privateObject } from "../persistence/google";
import { config } from "../config";

type VideoResult = {
  response?: {
    generatedVideos?: { video?: { uri?: string; gcsUri?: string } }[];
    videos?: { gcsUri?: string; uri?: string }[];
    raiMediaFilteredCount?: number;
  };
};

// The operation is the authority for a returned URI. The bucket prefix is a
// second source of truth when Veo wrote an MP4 but omitted its URI. An MP4 is
// always a candidate for manual review, regardless of its creative quality.
export async function findCinematicVideoObject(result: VideoResult, outputPrefix: string, assetId: string) {
  privateObject(outputPrefix);
  const storage = bucket();
  const bucketName = config().bucket;
  const base = `gs://${bucketName}/`;
  const reported = [
    ...(result.response?.generatedVideos || []).flatMap(item => [item.video?.uri, item.video?.gcsUri]),
    ...(result.response?.videos || []).flatMap(item => [item.gcsUri, item.uri]),
  ].filter((uri): uri is string => typeof uri === "string" && uri.startsWith(base))
    .map(uri => uri.slice(base.length));
  let files: { name: string }[] = [];
  let listingError: unknown;
  try { [files] = await storage.getFiles({ prefix: outputPrefix, maxResults: 20 }); }
  catch (error) { listingError = error; }
  const keys = [...new Set([...reported, ...files.map(file => file.name)])];
  for (const key of keys) {
    if (!key || key.includes("..") || key.includes("\\")) continue;
    const source = storage.file(key);
    let metadata: { contentType?: string; size?: string | number };
    try { [metadata] = await source.getMetadata(); }
    catch (error) {
      if ((error as { code?: number }).code === 404) continue;
      throw error;
    }
    if (Number(metadata.size) <= 0 ||
      !(key.toLowerCase().endsWith(".mp4") || metadata.contentType === "video/mp4")) continue;
    if (key.startsWith(outputPrefix) && key.toLowerCase().endsWith(".mp4")) {
      console.info("cinematic_video_found", { source: reported.includes(key) ? "operation" : "bucket", filteredCount: result.response?.raiMediaFilteredCount || 0 });
      return key;
    }
    // A URI returned by this exact Veo operation may use another directory
    // in the configured bucket. Copy it into this attempt's private prefix so
    // the media route never serves arbitrary bucket paths.
    if (reported.includes(key)) {
      const destination = `${outputPrefix}recovered-${assetId}.mp4`;
      privateObject(destination);
      await source.copy(storage.file(destination));
      console.info("cinematic_video_found", { source: "copied-operation", filteredCount: result.response?.raiMediaFilteredCount || 0 });
      return destination;
    }
  }
  // When listing fails, a missing URI is not proof that Veo produced nothing.
  // Keep the operation recoverable instead of marking it definitively failed.
  if (listingError) throw listingError;
  console.warn("cinematic_video_absent", { reported: reported.length, files: files.length,
    filteredCount: result.response?.raiMediaFilteredCount || 0 });
  return null;
}
