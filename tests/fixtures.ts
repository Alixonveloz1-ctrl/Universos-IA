// SIMULATED test data only. No fixtures are imported by the application.
import { bible, plan } from "../lib/schemas";
import type { Project, Snapshot, Asset, Target } from "../lib/types";
export const b = bible.parse({
  characters: [
    {
      id: "a",
      name: "Alba",
      role: "Protagonista",
      material: "Cristal",
      face: "Oval",
      silhouette: "Alta",
      color: "Azul",
      texture: "Facetas",
      hair: "No tiene",
      eyes: "Grandes",
      wardrobe: "Capa",
      accessories: "Anillo",
      gestures: "Serena",
      personality: "Decidida",
      desire: "Conocer la verdad",
      fear: "Traición",
      secret: "",
      relationships: "Hermana de Darío",
      visualPrompt: "Cristal azul con capa",
      lockedTraits: ["Ojos azules"],
      allowedVariations: ["Luz"],
      voice: {
        language: "Español",
        accent: "Latino",
        timbre: "Grave",
        register: "Medio",
        rhythm: "Calmo",
        energy: "Media",
        diction: "Clara",
        expression: "Directa",
      },
    },
  ],
  locations: [
    {
      id: "hall",
      name: "Salón",
      layout: "Puerta al fondo",
      scale: "Amplio",
      entrances: "Una puerta",
      lighting: "Suave",
      time: "Tarde",
      weather: "Seco",
      persistentObjects: ["Mesa"],
      visualPrompt: "Salón con una mesa",
    },
  ],
  props: ["Anillo"],
  relationships: "Conflicto familiar",
  lockedTraits: ["Materiales"],
});
export const observed = {
  location: "hall",
  characters: [
    {
      characterId: "a",
      posture: "De pie",
      emotion: "Atenta",
      knowledge: "Existe una carta",
      heldObjects: ["Anillo"],
      wardrobe: "Capa",
      damage: "Ninguno",
      lastAction: "Entró",
      nextAction: "Preguntar",
    },
  ],
};
export const q = plan.parse({
  clips: Array.from({ length: 8 }, (_, i) => ({
    number: i + 1,
    durationSeconds: 8,
    goal: "Avanzar el conflicto",
    continuityIn: observed,
    plannedEndState: observed,
    characterIds: ["a"],
    locationId: "hall",
    shots: [
      {
        id: "s" + i,
        start: 0,
        end: 8,
        framing: "Plano medio",
        action: "Levanta el anillo",
        characterIds: ["a"],
        locationId: "hall",
        dialogue: "¿Es tuyo?",
      },
    ],
    dialogue: [
      {
        characterId: "a",
        text: "¿Es tuyo?",
        intention: "Preguntar",
        start: 1,
        end: 3,
      },
    ],
    soundDirection: { ambience: "Viento suave", effects: [], music: "" },
    startMode: "storyboard",
    constraints: [],
  })),
});
export const project: Project = {
  id: "test",
  owner: "personal",
  universeId: "universe",
  universeSnapshot: {
    revision: 1,
    name: "Cristal",
    beings: "Cristal",
    visualStyle: "3D",
    environment: "Palacio",
    worldRules: "La identidad permanece",
    characterCanon: "",
  },
  title: "Prueba simulada",
  revision: 1,
  stage: "production",
  genre: "Drama",
  subgenre: "Familiar",
  plotType: "Traición",
  tone: "Emocional",
  ending: "Giro final",
  language: "Español",
  accent: "Latino",
  models: {
    text: "gemini-3-flash-preview",
    image: "gemini-2.5-flash-image",
    video: "veo-3.1-lite-generate-001",
  },
  ideas: [
    { id: "idea1", title: "Uno", synopsis: "Uno" },
    { id: "idea2", title: "Dos", synopsis: "Dos" },
    { id: "idea3", title: "Tres", synopsis: "Tres" },
  ],
  selectedIdeaId: "idea1",
  story: {
    id: "story1",
    kind: "story",
    data: {
      premise: "Una carta",
      conflict: "Traición",
      arc: "Busca respuestas",
      ending: "Descubre la verdad",
    },
    approvedAt: 1,
    sourceRevision: 0,
    createdAt: 1,
  },
  bible: {
    id: "bible1",
    kind: "bible",
    data: b,
    approvedAt: 1,
    sourceRevision: 0,
    createdAt: 1,
  },
  plan: {
    id: "plan1",
    kind: "plan",
    data: q,
    approvedAt: 1,
    sourceRevision: 0,
    createdAt: 1,
  },
  createdAt: 1,
  updatedAt: 1,
};
export function snapshot(): Snapshot {
  const targets: Target[] = q.clips.flatMap((c) => [
    {
      id: "clip_" + c.number,
      kind: "video",
      role: "clip",
      entityId: String(c.number),
      clipNumber: c.number,
      approvedVersionId: "v" + c.number,
      needsReview: false,
      instructions: "",
    },
    {
      id: "shot_s" + (c.number - 1),
      kind: "image",
      role: "shot",
      entityId: "s" + (c.number - 1),
      clipNumber: c.number,
      approvedVersionId: "i" + c.number,
      needsReview: false,
      instructions: "",
    },
  ]);
  targets.push(
    ...b.characters.map(
      (c): Target => ({
        id: "character_" + c.id,
        role: "character",
        entityId: c.id,
        kind: "image",
        approvedVersionId: "canonical_" + c.id,
        needsReview: false,
        instructions: "",
      }),
    ),
    ...b.locations.map(
      (l): Target => ({
        id: "location_" + l.id,
        role: "location",
        entityId: l.id,
        kind: "image",
        approvedVersionId: "canonical_" + l.id,
        needsReview: false,
        instructions: "",
      }),
    ),
  );
  const assets: Asset[] = targets.map((t) => ({
    id: t.approvedVersionId!,
    targetId: t.id,
    kind: t.kind,
    status: "candidate",
    model: t.kind === "image" ? project.models.image : project.models.video,
    prompt: "test",
    inputRefs: t.kind === "video" ? ["i" + t.clipNumber] : [],
    settings: {},
    storageObject: "universos-ia/test/" + t.approvedVersionId,
    mime: t.kind === "video" ? "video/mp4" : "image/png",
    checksum: "test",
    sourceRevisions: {
      project: 1,
      bible: "bible1",
      plan: "plan1",
      previousClip:
        t.kind === "video" && t.clipNumber! > 1
          ? "v" + (t.clipNumber! - 1)
          : null,
    },
    createdAt: 1,
    technicalReport: {},
  }));
  return {
    project: structuredClone(project),
    targets,
    assets,
    bible: b,
    plan: q,
    observed: Object.fromEntries(
      q.clips.map((c) => [
        "clip_" + c.number,
        { ...observed, versionId: "v" + c.number },
      ]),
    ),
  };
}
