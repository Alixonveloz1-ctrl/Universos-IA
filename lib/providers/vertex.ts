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
    parameters: { ...VIDEO, storageUri },
  };
}
export async function textGenerate(
  id: string,
  prompt: string,
  schema?: unknown,
) {
  model(id, "text");
  const r = await googlePost(
    endpoint(id, "generateContent"),
    {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        ...(schema ? { responseJsonSchema: schema } : {}),
        candidateCount: 1,
      },
    },
    true,
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
  const part = r.candidates?.[0]?.content?.parts?.find(
    (p: { inlineData?: unknown }) => p.inlineData,
  )?.inlineData;
  if (
    !part?.data ||
    !["image/png", "image/jpeg", "image/webp"].includes(part.mimeType)
  )
    throw new AppError(
      "PROVIDER_BLOCKED",
      "El modelo no devolvió una imagen compatible.",
      502,
    );
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
) {
  const r = await googlePost(
    endpoint(id, "predictLongRunning"),
    videoRequest(id, prompt, refs, "initial", storageUri),
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
  return googlePost(endpoint(id, "fetchPredictOperation"), {
    operationName: name,
  });
}
