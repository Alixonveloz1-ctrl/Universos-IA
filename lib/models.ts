export const MODELS = {
  "gemini-3-flash-preview": {
    name: "Gemini 3 Flash Preview",
    kind: "text",
    location: "global",
    modes: ["text"],
  },
  "gemini-2.5-flash-image": {
    name: "Nano Banana",
    kind: "image",
    location: "us-central1",
    modes: ["references"],
    maxReferenceImages: 3,
    maxInlineBytes: 7 * 1024 * 1024,
  },
  "gemini-3.1-flash-image": {
    name: "Nano Banana 2",
    kind: "image",
    location: "global",
    modes: ["references"],
    maxReferenceImages: 14,
    maxInlineBytes: 7 * 1024 * 1024,
  },
  "gemini-3-pro-image": {
    name: "Nano Banana Pro",
    kind: "image",
    location: "global",
    modes: ["references"],
    maxReferenceImages: 14,
    maxInlineBytes: 7 * 1024 * 1024,
  },
  "veo-3.1-lite-generate-001": {
    name: "Veo 3.1 Lite",
    kind: "video",
    location: "us-central1",
    modes: ["initial"],
  },
  "veo-3.1-fast-generate-001": {
    name: "Veo 3.1 Fast",
    kind: "video",
    location: "us-central1",
    modes: ["initial", "references"],
  },
  "veo-3.1-generate-001": {
    name: "Veo 3.1",
    kind: "video",
    location: "us-central1",
    modes: ["initial", "references"],
  },
} as const;
export type ModelId = keyof typeof MODELS;
export const VIDEO = {
  durationSeconds: 8,
  generateAudio: true,
  aspectRatio: "9:16",
  sampleCount: 1,
  resolution: "720p",
} as const;
export function model(id: string, kind?: string) {
  const m = MODELS[id as ModelId];
  if (!m || (kind && m.kind !== kind)) throw new Error("Modelo no permitido");
  return m;
}
export const DEFAULT_MODELS = {
  text: "gemini-3-flash-preview",
  image: "gemini-2.5-flash-image",
  video: "veo-3.1-lite-generate-001",
};
export function defaults() {
  return {
    text: process.env.DIRECTOR_MODEL || DEFAULT_MODELS.text,
    image: process.env.IMAGE_MODEL || DEFAULT_MODELS.image,
    video: process.env.VIDEO_MODEL || DEFAULT_MODELS.video,
  };
}

export function imageLimits(id: string) {
  const m = model(id, "image");
  if (!("maxReferenceImages" in m))
    throw new Error("Modelo de imagen inválido");
  return m;
}
