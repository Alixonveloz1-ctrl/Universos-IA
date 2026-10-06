import { z } from "zod";
import { CINEMATIC_GENRES, DEFAULT_CINEMATIC_GENRE, DEFAULT_CINEMATIC_SUBGENRE,
  type CinematicGenre } from "./options";

export const cinematicDuration = z.union([z.literal(30), z.literal(60), z.literal(90)]);
export const cinematicSegmentDuration = z.union([z.literal(4), z.literal(6), z.literal(8)]);
export const cinematicId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const short = z.string().trim().min(1).max(1400);
const long = z.string().trim().min(1).max(12000);

export const cinematicProjectInput = z.object({
  concept: z.string().trim().max(4000).default(""),
  visualStyle: z.enum(["realistic", "anime2d"]).default("realistic"),
  genre: z.enum(CINEMATIC_GENRES.map(genre => genre.id) as [CinematicGenre, ...CinematicGenre[]])
    .default(DEFAULT_CINEMATIC_GENRE),
  subgenre: z.string().trim().min(1).max(80).default(DEFAULT_CINEMATIC_SUBGENRE),
  durationSeconds: cinematicDuration,
  language: z.string().trim().min(1).max(100),
  accent: z.string().trim().min(1).max(100),
  models: z.object({
    text: z.string().trim().min(1).max(120),
    image: z.string().trim().min(1).max(120),
    video: z.string().trim().min(1).max(120),
  }).strict(),
}).strict().refine(input => CINEMATIC_GENRES.some(genre =>
  genre.id === input.genre && genre.subgenres.some(subgenre => subgenre.id === input.subgenre)), {
  path: ["subgenre"], message: "El subgénero no corresponde al género elegido.",
});

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

// The Director chooses the story and shots; the editor owns the exact technical
// boundaries. Rounding or a slightly different block length must not force a
// second paid generation of the same story.
export function alignCinematicPlan(value: unknown, total: 30 | 60 | 90): unknown {
  if (!value || typeof value !== "object" || !Array.isArray((value as { segments?: unknown }).segments)) return value;
  const expected = cinematicSegmentDurations(total);
  const source = (value as { segments: unknown[] }).segments;
  if (source.length !== expected.length) return value;
  const plan = structuredClone(value) as { characters?: { id?: unknown; name?: unknown }[]; segments: Record<string, unknown>[] };
  const knownCharacters = new Set(Array.isArray(plan.characters) ? plan.characters.map(c => c?.id) : []);
  for (let i = 0; i < plan.segments.length; i++) {
    const segment = plan.segments[i];
    if (!segment || typeof segment !== "object") continue;
    const originalDuration = Number(segment.durationSeconds);
    segment.number = i + 1;
    segment.durationSeconds = expected[i];
    if (i > 0) {
      const previous = plan.segments[i - 1];
      if (typeof previous?.continuityOut === "string" && previous.continuityOut.trim())
        segment.continuityIn = previous.continuityOut;
      if (typeof previous?.audioContinuityOut === "string" && previous.audioContinuityOut.trim())
        segment.audioContinuityIn = previous.audioContinuityOut;
    }
    if (!Array.isArray(segment.shots) || !segment.shots.length || segment.shots.length > 8) continue;
    const shots = segment.shots as Record<string, unknown>[];
    const weights = shots.map(shot => {
      const span = Number(shot?.end) - Number(shot?.start);
      return Number.isFinite(span) && span > 0 ? span : 1;
    });
    const sum = weights.reduce((a, b) => a + b, 0);
    const timeline = Number.isFinite(originalDuration) && originalDuration > 0 ? originalDuration :
      Math.max(...shots.map(shot => Number(shot?.end) || 0), expected[i]);
    if (Array.isArray(segment.dialogue)) for (const turn of segment.dialogue as Record<string, unknown>[]) {
      if (!turn || typeof turn !== "object" || !Number.isFinite(turn.start) || !Number.isFinite(turn.end)) continue;
      turn.start = Math.round(Number(turn.start) / timeline * expected[i] * 1000) / 1000;
      turn.end = Math.round(Number(turn.end) / timeline * expected[i] * 1000) / 1000;
    }
    let cursor = 0;
    shots.forEach((shot, index) => {
      if (!shot || typeof shot !== "object") return;
      shot.id = `cinematic_${i + 1}_${index + 1}`;
      shot.start = cursor;
      cursor = index === shots.length - 1 ? expected[i]
        : Math.round(weights.slice(0, index + 1).reduce((a, b) => a + b, 0) / sum * expected[i] * 1000) / 1000;
      shot.end = cursor;
      shot.transition = index === 0 ? "start"
        : shot.transition === "match-cut" ? "match-cut" : "hard-cut";
    });
    // A spoken line needs an on-screen anchor, while its audio may bridge
    // cutaways. If the draft has no anchor, restage one shot along with its
    // cast; changing cast metadata alone would contradict framing/action.
    if (Array.isArray(segment.dialogue) && Array.isArray(segment.characterIds)) {
      const restaged = new Set<Record<string, unknown>>();
      for (const turn of segment.dialogue as Record<string, unknown>[]) {
        const id = turn?.characterId;
        if (typeof id !== "string" || !knownCharacters.has(id) ||
            !Number.isFinite(turn.start) || !Number.isFinite(turn.end)) continue;
        const cast = segment.characterIds as unknown[];
        if (!cast.includes(id)) {
          if (cast.length >= 4) continue;
          cast.push(id);
        }
        const overlapping = shots.filter(shot => Number(turn.start) < Number(shot.end) - 0.001 &&
          Number(turn.end) > Number(shot.start) + 0.001);
        if (overlapping.some(shot => Array.isArray(shot.characterIds) && shot.characterIds.includes(id))) continue;
        const candidates = overlapping.filter(shot => Array.isArray(shot.characterIds) && shot.characterIds.length < 4);
        const dramatic = candidates.filter(shot => !["insert", "pov", "reaction"].includes(String(shot.shotType)));
        const anchor = (dramatic.length ? dramatic : candidates).sort((a, b) =>
          Math.min(Number(b.end), Number(turn.end)) - Math.max(Number(b.start), Number(turn.start)) -
          (Math.min(Number(a.end), Number(turn.end)) - Math.max(Number(a.start), Number(turn.start))))[0];
        if (anchor) {
          (anchor.characterIds as unknown[]).push(id);
          restaged.add(anchor);
        }
      }
      for (const shot of restaged) {
        const castIds = shot.characterIds as string[];
        const names = castIds.map(id => {
          const character = plan.characters?.find(c => c.id === id);
          return typeof character?.name === "string" ? character.name : id;
        });
        const speakers = castIds.filter(id => (segment.dialogue as Record<string, unknown>[]).some(turn =>
          turn?.characterId === id && Number(turn.start) < Number(shot.end) - 0.001 &&
          Number(turn.end) > Number(shot.start) + 0.001)).map(id => {
          const character = plan.characters?.find(c => c.id === id);
          return typeof character?.name === "string" ? character.name : id;
        });
        shot.shotType = castIds.length > 2 ? "wide" : "medium";
        shot.lensMm = castIds.length > 2 ? 35 : 55;
        shot.camera = "Locked on the visible speakers; no POV or listener-only reaction.";
        shot.framing = `Visible on-screen cast: ${names.join(", ")}. Keep ${speakers.join(" and ")}'s face and mouth readable during their scheduled lines.`;
        shot.action = `${speakers.join(" and ")} deliver only their scheduled dialogue during their assigned time windows; all other visible characters listen silently and react. Preserve the story location and continuity.`;
        if (shot === shots[0]) segment.openingFrameDirection =
          `Frame zero of the revised ${shot.shotType}: ${names.join(", ")} visible in the location; the scheduled speakers' faces are readable.`;
      }
    }
  }
  return plan;
}

export function validateCinematicPlan(value: unknown, total: 30 | 60 | 90) {
  const plan = cinematicPlan.parse(value);
  const expected = cinematicSegmentDurations(total);
  if (plan.segments.length !== expected.length)
    throw new Error(`Se requieren ${expected.length} bloques técnicos para ${total} segundos.`);
  const characterIds = new Set(plan.characters.map(c => c.id));
  if (characterIds.size !== plan.characters.length)
    throw new Error("Hay IDs de personaje duplicados.");
  const close = (a: number, b: number) => Math.abs(a - b) < 0.001;
  const shotIds = new Set<string>();
  for (let i = 0; i < plan.segments.length; i++) {
    const segment = plan.segments[i];
    if (segment.number !== i + 1 || segment.durationSeconds !== expected[i])
      throw new Error(`El bloque ${i + 1} debe durar ${expected[i]} segundos.`);
    if (segment.characterIds.some(id => !characterIds.has(id)))
      throw new Error(`El bloque ${segment.number} usa un personaje fuera de la biblia.`);
    if (!close(segment.shots[0].start, 0) || !close(segment.shots.at(-1)!.end, segment.durationSeconds))
      throw new Error(`Las tomas del bloque ${segment.number} deben cubrir toda su duración.`);
    for (let j = 0; j < segment.shots.length; j++) {
      const shot = segment.shots[j];
      if (shotIds.has(shot.id)) throw new Error("Hay IDs de toma duplicados.");
      shotIds.add(shot.id);
      if (shot.end > segment.durationSeconds)
        throw new Error(`Una toma excede el bloque ${segment.number}.`);
      if (j > 0 && !close(shot.start, segment.shots[j - 1].end))
        throw new Error(`Las tomas del bloque ${segment.number} tienen huecos o solapamientos.`);
      if (shot.characterIds.some(id => !segment.characterIds.includes(id)))
        throw new Error(`Una toma del bloque ${segment.number} usa un personaje no presente.`);
      if (j === 0 && shot.transition !== "start")
        throw new Error(`La primera toma del bloque ${segment.number} debe comenzar con start.`);
      if (j > 0 && shot.transition === "start")
        throw new Error(`Las tomas posteriores del bloque ${segment.number} necesitan un corte.`);
    }
    const dialogue = [...segment.dialogue].sort((a, b) => a.start - b.start);
    for (let j = 0; j < dialogue.length; j++) {
      const turn = dialogue[j];
      if (!segment.characterIds.includes(turn.characterId) || turn.end > segment.durationSeconds)
        throw new Error(`El diálogo del bloque ${segment.number} no coincide con su reparto o duración.`);
      if (j && turn.start < dialogue[j - 1].end - 0.001)
        throw new Error(`El diálogo del bloque ${segment.number} se solapa.`);
      if (!segment.shots.some(shot => turn.start < shot.end - 0.001 && turn.end > shot.start + 0.001 &&
        shot.characterIds.includes(turn.characterId)))
        throw new Error(`El hablante del bloque ${segment.number} no aparece en su toma.`);
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
