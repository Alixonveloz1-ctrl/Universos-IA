import { z } from "zod";

export const cinematicDuration = z.union([z.literal(30), z.literal(60), z.literal(90)]);
export const cinematicSegmentDuration = z.union([z.literal(4), z.literal(6), z.literal(8)]);
export const cinematicId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const short = z.string().trim().min(1).max(1400);
const long = z.string().trim().min(1).max(12000);

export const cinematicProjectInput = z.object({
  concept: z.string().trim().min(8).max(4000),
  durationSeconds: cinematicDuration,
  language: z.string().trim().min(1).max(100),
  accent: z.string().trim().min(1).max(100),
  models: z.object({
    text: z.string().trim().min(1).max(120),
    image: z.string().trim().min(1).max(120),
    video: z.string().trim().min(1).max(120),
  }).strict(),
}).strict();

export const cinematicVoice = z.object({
  timbre: short,
  register: short,
  rhythm: short,
  energy: short,
  diction: short,
  expression: short,
}).strict();

export const cinematicCharacter = z.object({
  id: cinematicId,
  name: short,
  role: short,
  age: short,
  gender: short,
  visualIdentity: long,
  wardrobe: long,
  lockedTraits: z.array(short).min(2).max(16),
  voice: cinematicVoice,
}).strict();

export const cinematicShot = z.object({
  id: cinematicId,
  start: z.number().min(0).max(8),
  end: z.number().min(0).max(8),
  shotType: z.enum([
    "wide",
    "medium",
    "close-up",
    "extreme-close-up",
    "insert",
    "pov",
    "over-shoulder",
    "reaction",
  ]),
  lensMm: z.number().int().min(18).max(135),
  camera: short,
  framing: short,
  action: long,
  characterIds: z.array(cinematicId).max(4),
  transition: z.enum(["start", "hard-cut", "match-cut"]),
  nativeAudioBeat: z.string().max(1800),
}).strict().refine(v => v.end > v.start, "La toma necesita una duración positiva.");

export const cinematicDialogue = z.object({
  characterId: cinematicId,
  text: z.string().trim().min(1).max(500),
  intention: short,
  start: z.number().min(0).max(8),
  end: z.number().min(0).max(8),
}).strict().refine(v => v.end > v.start, "El diálogo necesita una duración positiva.");

export const cinematicSegment = z.object({
  number: z.number().int().min(1).max(20),
  durationSeconds: cinematicSegmentDuration,
  goal: long,
  location: long,
  characterIds: z.array(cinematicId).min(1).max(4),
  continuityIn: long,
  continuityOut: long,
  audioContinuityIn: long,
  audioContinuityOut: long,
  openingFrameDirection: long,
  shots: z.array(cinematicShot).min(1).max(8),
  dialogue: z.array(cinematicDialogue).max(6),
  soundEffects: z.array(short).max(12),
  musicDirection: z.string().max(2500),
}).strict();

export const cinematicSoundBible = z.object({
  identity: long,
  musicPalette: long,
  instrumentation: long,
  rhythmAndTempo: long,
  ambienceBed: long,
  dialogueMix: long,
  effectsLanguage: long,
  continuityRule: long,
}).strict();

export const cinematicPlan = z.object({
  title: short,
  premise: long,
  hook: long,
  ending: long,
  visualBible: long,
  colorAndLighting: long,
  cameraLanguage: long,
  editingLanguage: long,
  soundBible: cinematicSoundBible,
  characters: z.array(cinematicCharacter).min(1).max(8),
  segments: z.array(cinematicSegment).min(4).max(12),
}).strict();

export type CinematicProjectInput = z.infer<typeof cinematicProjectInput>;
export type CinematicPlan = z.infer<typeof cinematicPlan>;
export type CinematicCharacter = z.infer<typeof cinematicCharacter>;
export type CinematicSegment = z.infer<typeof cinematicSegment>;

export function cinematicSegmentDurations(total: 30 | 60 | 90): (4 | 6 | 8)[] {
  if (total === 30) return [8, 8, 8, 6];
  if (total === 60) return [8, 8, 8, 8, 8, 8, 8, 4];
  return [8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 6, 4];
}

export function validateCinematicPlan(value: unknown, total: 30 | 60 | 90) {
  const plan = cinematicPlan.parse(value);
  const expected = cinematicSegmentDurations(total);
  if (plan.segments.length !== expected.length)
    throw new Error(`Se requieren ${expected.length} bloques técnicos para ${total} segundos.`);
  const characterIds = new Set(plan.characters.map(c => c.id));
  const shotIds = new Set<string>();
  for (let i = 0; i < plan.segments.length; i++) {
    const segment = plan.segments[i];
    if (segment.number !== i + 1 || segment.durationSeconds !== expected[i])
      throw new Error(`El bloque ${i + 1} debe durar ${expected[i]} segundos.`);
    if (segment.characterIds.some(id => !characterIds.has(id)))
      throw new Error(`El bloque ${segment.number} usa un personaje fuera de la biblia.`);
    if (segment.shots[0].start !== 0 || segment.shots.at(-1)!.end !== segment.durationSeconds)
      throw new Error(`Las tomas del bloque ${segment.number} deben cubrir toda su duración.`);
    for (let j = 0; j < segment.shots.length; j++) {
      const shot = segment.shots[j];
      if (shotIds.has(shot.id)) throw new Error("Hay IDs de toma duplicados.");
      shotIds.add(shot.id);
      if (shot.end > segment.durationSeconds)
        throw new Error(`Una toma excede el bloque ${segment.number}.`);
      if (j > 0 && shot.start !== segment.shots[j - 1].end)
        throw new Error(`Las tomas del bloque ${segment.number} tienen huecos o solapamientos.`);
      if (shot.characterIds.some(id => !segment.characterIds.includes(id)))
        throw new Error(`Una toma del bloque ${segment.number} usa un personaje no presente.`);
      if (j === 0 && shot.transition !== "start")
        throw new Error(`La primera toma del bloque ${segment.number} debe comenzar con start.`);
      if (j > 0 && shot.transition === "start")
        throw new Error(`Las tomas posteriores del bloque ${segment.number} necesitan un corte.`);
    }
    for (const turn of segment.dialogue) {
      if (!segment.characterIds.includes(turn.characterId) || turn.end > segment.durationSeconds)
        throw new Error(`El diálogo del bloque ${segment.number} no coincide con su reparto o duración.`);
    }
    if (i > 0) {
      const prev = plan.segments[i - 1];
      if (segment.continuityIn.trim() !== prev.continuityOut.trim())
        throw new Error(`La continuidad visual entre bloques ${i} y ${i + 1} no es literal.`);
      if (segment.audioContinuityIn.trim() !== prev.audioContinuityOut.trim())
        throw new Error(`La continuidad sonora entre bloques ${i} y ${i + 1} no es literal.`);
    }
  }
  return plan;
}
