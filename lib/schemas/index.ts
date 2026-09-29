import { z } from "zod";
export const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const text = z.string().trim().min(1).max(12000);
const short = z.string().trim().min(1).max(1000);
export const state = z
  .object({
    location: short,
    note: z.string().max(5000).optional(),
    characters: z
      .array(
        z
          .object({
            characterId: id,
            posture: short,
            emotion: short,
            knowledge: short,
            heldObjects: z.array(short),
            wardrobe: short,
            damage: z.string().max(1000),
            lastAction: short,
            nextAction: short,
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export const universe = z
  .object({
    name: short,
    beings: short,
    visualStyle: short,
    environment: text,
    worldRules: text,
    characterCanon: z.string().max(20000),
  })
  .strict();
export const idea = z.object({ id, title: short, synopsis: text }).strict();
export const ideas = z
  .object({ ideas: z.array(idea).length(3) })
  .strict()
  .refine(
    (v) => new Set(v.ideas.map((i) => i.id)).size === 3,
    "IDs de propuestas duplicados",
  );
export const story = z
  .object({ premise: text, conflict: text, arc: text, ending: text })
  .strict();
export const character = z
  .object({
    id,
    name: short,
    role: short,
    // Optional only for compatibility with existing approved Bibles.
    gender: short.optional(),
    age: short.optional(),
    material: short,
    face: short,
    silhouette: short,
    color: short,
    texture: short,
    hair: short,
    eyes: short,
    wardrobe: short,
    accessories: short,
    gestures: short,
    personality: short,
    desire: short,
    fear: short,
    secret: z.string().max(1000),
    relationships: short,
    visualPrompt: text,
    lockedTraits: z.array(short),
    allowedVariations: z.array(short),
    voice: z
      .object({
        language: short,
        accent: short,
        timbre: short,
        register: short,
        rhythm: short,
        energy: short,
        diction: short,
        expression: short,
      })
      .strict(),
  })
  .strict();
export const location = z
  .object({
    id,
    name: short,
    layout: short,
    scale: short,
    entrances: short,
    lighting: short,
    time: short,
    weather: short,
    persistentObjects: z.array(short),
    visualPrompt: text,
  })
  .strict();
export const bible = z
  .object({
    characters: z.array(character).min(1).max(12),
    locations: z.array(location).min(1).max(12),
    props: z.array(short),
    relationships: text,
    lockedTraits: z.array(short),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.characters.map((c) => c.id)).size === v.characters.length &&
      new Set(v.locations.map((l) => l.id)).size === v.locations.length,
    "IDs canónicos duplicados",
  );
const time = z.number().min(0).max(8);
export const shot = z
  .object({
    id,
    start: time,
    end: time,
    framing: short,
    action: text,
    characterIds: z.array(id),
    locationId: id,
    dialogue: z.string().max(2000),
  })
  .strict()
  .refine((v) => v.end > v.start, "La toma debe tener una ventana positiva");
export const clip = z
  .object({
    number: z.number().int().min(1).max(8),
    durationSeconds: z.literal(8),
    goal: short,
    continuityIn: state,
    plannedEndState: state,
    characterIds: z.array(id),
    locationId: id,
    shots: z.array(shot).min(1).max(8),
    dialogue: z.array(
      z
        .object({
          characterId: id,
          text: short,
          intention: short,
          start: time,
          end: time,
        })
        .strict(),
    ),
    soundDirection: z
      .object({
        ambience: short,
        effects: z.array(short),
        music: z.string().max(2000),
      })
      .strict(),
    startMode: z.enum(["storyboard", "previousFrame"]),
    constraints: z.array(short),
  })
  .strict();
export const plan = z
  .object({ clips: z.array(clip).length(8) })
  .strict()
  .superRefine((v, ctx) => {
    if (v.clips.some((c, i) => c.number !== i + 1))
      ctx.addIssue({ code: "custom", message: "Clips ordenados del 1 al 8" });
    const ids = v.clips.flatMap((c) => c.shots.map((s) => s.id));
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: "IDs de tomas duplicados" });
    for (let clipIndex = 0; clipIndex < v.clips.length; clipIndex++) {
      const c = v.clips[clipIndex];
      if (
        c.shots[0].start !== 0 ||
        c.shots.at(-1)!.end !== 8 ||
        c.shots.some((s, i) => i > 0 && s.start !== c.shots[i - 1].end)
      )
        ctx.addIssue({
          code: "custom",
          message: "Las tomas deben cubrir 0–8 sin huecos ni solapamientos",
        });
      if (
        c.dialogue.some(
          (d) => d.end <= d.start || !c.characterIds.includes(d.characterId),
        )
      )
        ctx.addIssue({
          code: "custom",
          message: "Diálogo o hablante inválido",
        });
    }

  });
export function validatePlan(value: unknown, b: z.infer<typeof bible>, hasPreviousChapter = false) {
  const p = plan.parse(value);
  if (p.clips[0].startMode === "previousFrame" && !hasPreviousChapter)
    throw new Error("El primer clip no tiene fotograma previo");
  const chars = new Set(b.characters.map((c) => c.id)),
    locs = new Set(b.locations.map((l) => l.id));
  for (const c of p.clips) {
    if (
      !locs.has(c.locationId) ||
      c.characterIds.some((x) => !chars.has(x)) ||
      c.shots.some(
        (s) =>
          !locs.has(s.locationId) ||
          s.characterIds.some(
            (x) => !chars.has(x) || !c.characterIds.includes(x),
          ),
      ) ||
      [c.continuityIn, c.plannedEndState].some((s) =>
        s.characters.some((x) => !chars.has(x.characterId)),
      )
    )
      throw new Error("Guion contiene IDs ajenos a la biblia");
  }
  return p;
}
export const projectInput = z
  .object({
    universeId: id.optional(),
    beings: short.default("Frutas"),
    visualStyle: short.default("Cinemático 3D"),
    concept: z.string().trim().max(1000).optional(),
    genre: short,
    subgenre: short,
    plotType: short,
    tone: short,
    ending: short,
    language: short,
    accent: short,
    models: z.object({ text: short, image: short, video: short }).strict(),
  })
  .strict();
export const action = z
  .object({
    type: z.enum([
      "ideas",
      "story",
      "bible",
      "plan",
      "image",
      "images",
      "video",
      "finalize",
    ]),
    expectedRevision: z.number().int().nonnegative(),
    targetId: id.optional(),
    optionId: id.optional(),
    instructions: z.string().max(6000).default(""),
    requestId: z.string().uuid(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const targeted = ["image", "video"].includes(v.type);
    if (targeted !== !!v.targetId)
      ctx.addIssue({
        code: "custom",
        message:
          "El objetivo es obligatorio solo para imagen o video individual",
      });
    if (v.optionId && v.type !== "ideas")
      ctx.addIssue({
        code: "custom",
        message: "Solo las propuestas admiten optionId",
      });
  });
export type Bible = z.infer<typeof bible>;
export type Plan = z.infer<typeof plan>;
export type Clip = z.infer<typeof clip>;
export type Universe = z.infer<typeof universe>;
export type Action = z.infer<typeof action>;
