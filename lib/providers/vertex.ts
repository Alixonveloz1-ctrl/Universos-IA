import { model, imageLimits, VIDEO } from "../models";
import { config } from "../config";
import { googlePost } from "../persistence/google";
import { AppError, assert } from "../errors";
export function endpoint(id: string, method: string) {
  const m = model(id),
    host =
      m.location === "global"
        ? "aiplatform.googleapis.com"
        : `${m.location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${config().project}/locations/${m.location}/publishers/google/models/${id}:${method}`;
}
export type ImageRef = { bytesBase64Encoded: string; mimeType: string };
export function imageRequest(prompt: string, refs: ImageRef[]) {
  return {
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          ...refs.map((r) => ({
            inlineData: { data: r.bytesBase64Encoded, mimeType: r.mimeType },
          })),
        ],
      },
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      candidateCount: 1,
      imageConfig: { aspectRatio: "9:16" },
    },
  };
}
export function videoRequest(
  id: string,
  prompt: string,
  refs: ImageRef[],
  mode: "initial" | "references",
  storageUri: string,
  durationSeconds: 4 | 6 | 8 = VIDEO.durationSeconds,
) {
  const m = model(id, "video");
  assert(
    (m.modes as readonly string[]).includes(mode),
    "Este modelo no admite el modo elegido.",
  );
  assert(
    mode === "initial"
      ? refs.length === 1
      : refs.length >= 1 && refs.length <= 3,
    "Cantidad incompatible de referencias.",
  );
  assert([4, 6, 8].includes(durationSeconds), "Duración de video no permitida.");
  return {
    instances: [
      {
        prompt,
        ...(mode === "initial"
          ? { image: refs[0] }
          : {
              referenceImages: refs.map((image) => ({
                image,
                referenceType: "asset",
              })),
            }),
      },
    ],
    parameters: { ...VIDEO, durationSeconds, personGeneration: "allow_adult", storageUri },
  };
}
export async function textGenerate(
  id: string,
  prompt: string,
  schema?: unknown,
  maxOutputTokens = 8192,
) {
  model(id, "text");
  const r = await googlePost(
    endpoint(id, "generateContent"),
    {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        thinkingConfig: { thinkingLevel: "LOW" },
        maxOutputTokens,
        ...(schema ? { responseJsonSchema: schema } : {}),
        candidateCount: 1,
      },
    },
    true,
    210000,
  );
  const parts = r.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts))
    throw new AppError(
      "PROVIDER_BLOCKED",
      "El Director no devolvió contenido utilizable.",
      502,
    );
  const text = parts
    .filter((p: { text?: string; thought?: boolean }) => p.text && !p.thought)
    .map((p: { text: string }) => p.text)
    .join("");
  try {
    return JSON.parse(text);
  } catch {
    // Persist the received response before the Director performs its one
    // schema repair. This is a received invalid result, not a lost response.
    return { invalidJsonText: text.slice(0, 100000) };
  }
}
export async function imageGenerate(
  id: string,
  prompt: string,
  refs: ImageRef[],
) {
  const limits = imageLimits(id);
  assert(
    refs.length <= limits.maxReferenceImages &&
      refs.every(
        (r) =>
          Buffer.byteLength(r.bytesBase64Encoded, "base64") <=
          limits.maxInlineBytes,
      ),
    "Referencias incompatibles con el modelo de imagen.",
  );
  const r = await googlePost(
    endpoint(id, "generateContent"),
    imageRequest(prompt, refs),
    true,
  );
  const candidate = r.candidates?.[0];
  const part = candidate?.content?.parts?.find(
    (p: { inlineData?: unknown }) => p.inlineData,
  )?.inlineData;
  if (!part?.data || !["image/png", "image/jpeg", "image/webp"].includes(part.mimeType)) {
    const finishReason = String(candidate?.finishReason || "");
    const promptBlock = String(r.promptFeedback?.blockReason || "");
    const finishMessage = String(candidate?.finishMessage || r.promptFeedback?.blockReasonMessage || "");
    const safetyRatings = Array.isArray(candidate?.safetyRatings) ? candidate.safetyRatings : [];
    const blockedRatings = safetyRatings.filter((rating: { blocked?: boolean }) => rating?.blocked);
    console.warn("[image-no-output]", JSON.stringify({
      model: id,
      finishReason: finishReason || null,
      promptBlock: promptBlock || null,
      finishMessage: finishMessage || null,
      blockedRatings,
      hasCandidate: !!candidate,
      partTypes: Array.isArray(candidate?.content?.parts)
        ? candidate.content.parts.map((p: { inlineData?: { mimeType?: string }; text?: string }) => ({
            mime: p.inlineData?.mimeType || null,
            hasText: !!p.text,
          }))
        : [],
    }));
    const safety = ["SAFETY","IMAGE_SAFETY","PROHIBITED_CONTENT","IMAGE_PROHIBITED_CONTENT","BLOCKLIST","MODEL_ARMOR"].some(reason =>
      finishReason.includes(reason) || promptBlock.includes(reason)
    ) || blockedRatings.length > 0;
    const noImage = finishReason.includes("NO_IMAGE") || finishReason.includes("IMAGE_OTHER");
    if (safety)
      throw new AppError(
        "PROVIDER_SAFETY",
        `Google bloqueó esta generación por sus filtros de contenido${finishReason ? ` (${finishReason})` : ""}. Revisa las instrucciones de esta imagen o intenta regenerarla.`,
        422,
      );
    if (noImage)
      throw new AppError(
        "PROVIDER_NO_IMAGE",
        `Google procesó la solicitud pero no produjo una imagen${finishReason ? ` (${finishReason})` : ""}. Puedes reintentar sin regenerar el guion.`,
        502,
      );
    throw new AppError(
      "PROVIDER_NO_IMAGE",
      "Google respondió correctamente, pero no incluyó una imagen ni informó un bloqueo de seguridad identificable. Puedes reintentar sin regenerar el guion.",
      502,
    );
  }
  return {
    bytes: Buffer.from(part.data, "base64"),
    mime: part.mimeType as string,
  };
}
export async function startVideo(
  id: string,
  prompt: string,
  refs: ImageRef[],
  storageUri: string,
  durationSeconds: 4 | 6 | 8 = VIDEO.durationSeconds,
) {
  const r = await googlePost(
    endpoint(id, "predictLongRunning"),
    videoRequest(id, prompt, refs, "initial", storageUri, durationSeconds),
    true,
  );
  if (!r.name)
    throw new AppError(
      "AMBIGUOUS",
      "Veo no devolvió el identificador de operación.",
      502,
    );
  return r.name as string;
}
export async function pollVideo(id: string, name: string) {
  const base = `projects/${config().project}/locations/${model(id).location}/publishers/google/models/${id}/operations/`;
  assert(
    name.startsWith(base) && !name.includes(".."),
    "Operación ajena al modelo o proyecto.",
  );
  const raw = await googlePost(endpoint(id, "fetchPredictOperation"), {
    operationName: name,
  });
  // REST fetchPredictOperation returns legacy GenerateVideoResponse
  // (response.videos[].gcsUri). The Gen AI SDK exposes the same result as
  // generatedVideos[].video.uri. Normalize both here so every caller sees one
  // stable shape and no worker has to guess the transport representation.
  const response = raw?.response;
  const uri =
    response?.generatedVideos?.[0]?.video?.uri ||
    response?.generatedVideos?.[0]?.video?.gcsUri ||
    response?.videos?.[0]?.gcsUri ||
    response?.videos?.[0]?.uri;
  return {
    ...raw,
    ...(response && uri
      ? {
          response: {
            ...response,
            generatedVideos: [{ video: { uri, mimeType: "video/mp4" } }],
          },
        }
      : {}),
  };
}
