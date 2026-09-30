// Narrative/image generation is preserved in core.ts. The video entry points
// below compile one deterministic script instead of rewriting and duplicating it.
import {
  narrativePrompt as coreNarrativePrompt,
  runDirector as coreRunDirector,
  directPrompt as coreDirectPrompt,
  compileVideoPrompt as legacyVideoPrompt,
} from "./core";
import { AppError } from "../errors";
import { renderHair } from "./hair";
import { visualTreatment } from "./styles";
import type { Clip } from "../schemas";
import type { Job, Snapshot, Target } from "../types";
import { dialogueProblems, dialogueWarnings, speechDirection, SPEECH_PLAN_DIRECTION, withoutDialogue } from "./speech";
import { runPlan } from "./plan-runner";
export { compileImagePrompt } from "./core";

const continuousCamera = "ONE CONTINUOUS TAKE for all 8 seconds. No cuts, shot/reverse-shot, montage, transitions, inserts or sudden viewpoint changes. Use only a slow shallow push-in, pull-back or small lateral camera move while keeping EVERY participating character visible and recognizable throughout. Keep faces and clothing in view; nobody exits the frame, crosses behind another person, disappears behind a door or furniture, or becomes fully occluded. If a requested close-up or movement would hide a participant, retain the wider group framing instead. Preserve the initial image identities, hairstyles, clothes, materials and screen positions without transformation. Older shot divisions are timing beats ONLY: replace their camera cuts with continuous movement. This camera rule overrides conflicting framing directions in older plans or saved prompts.";

function directedJob(j: Job): Job {
  if (j.type !== "plan") return j;
  return {
    ...j,
    instructions: [j.instructions, SPEECH_PLAN_DIRECTION].filter(Boolean).join("\n\n"),
    // The worker replaces this object after every durable checkpoint. Read the
    // live one rather than a stale shallow copy when resuming multipart work.
    get checkpoint() { return j.checkpoint; },
  };
}
export function narrativePrompt(j: Job, repair?: string) {
  return coreNarrativePrompt(directedJob(j), repair);
}
export function runDirector(j: Job, beforeCall: (key: string) => Promise<void>, checkpoint: (key: string, value: unknown) => Promise<void>) {
  const directed = directedJob(j);
  return j.type === "plan"
    ? runPlan(directed, repair => coreNarrativePrompt(directed, repair), beforeCall, checkpoint)
    : coreRunDirector(directed, beforeCall, checkpoint);
}

function vehicleDirection(s: Snapshot, c?: Clip | null) {
  if (!c) return "";
  const location = s.bible?.locations.find(l => l.id === c.locationId);
  const context = [c.goal, ...c.shots.map(sh => sh.action), location?.name, location?.visualPrompt, location?.layout].join(" ");
  if (!/\b(?:carro|auto|autom[oó]vil|coche|veh[ií]culo|camioneta|volante|conduc|asiento|parabrisas|estaci[oó]n de servicio|gasolinera|car|vehicle|steering|driver|passenger)\b/i.test(context)) return "";
  return "VEHICLE GEOGRAPHY: If the scene is inside a vehicle, use a left-hand-drive car as in the Americas unless the approved story explicitly sets a right-hand-drive country. For a camera positioned in the back seat looking FORWARD through the windshield, the steering wheel and DRIVER are on the IMAGE LEFT; the front PASSENGER is on the IMAGE RIGHT. The driver alone holds the wheel; the passenger must not appear behind it. A camera looking back from the dashboard reverses their image positions but never moves the physical steering wheel to the passenger side. Identify the driver from the approved action and preserve each named character in that seat across the clip. The steering wheel, dashboard, windows and exterior view must share one coherent direction. Seat roles override generic cast-order screen-left instructions. Never mirror the scene.";
}

function performanceTimeline(s: Snapshot, c: Clip) {
  const phase = [
    "Start from the approved image. Establish the eyelines and initiate the scheduled action; if its climax is scheduled here, perform it here.",
    "Continue the scheduled action or its consequence with a distinct physical step, appropriate gaze and any scheduled words.",
    "Carry out the action scheduled in this interval, or show the direct result of an action completed earlier. Never repeat an earlier climax.",
    "Complete the scheduled action if it belongs here; otherwise show its immediate reaction and resulting state naturally until the clip ends. Do not reset it.",
  ];
  return [0, 2, 4, 6].map((start, i) => {
    const end = start + 2;
    const active = c.shots.filter(shot => shot.start < end && shot.end > start);
    const words = c.dialogue.filter(d => d.start >= start && d.start < end)
      .map(d => `${s.bible!.characters.find(x => x.id === d.characterId)?.name || d.characterId} has a speech turn scheduled separately at ${d.start}-${d.end}s; follow the canonical speech schedule without repeating its words here`);
    return `${start}-${end}s: ${phase[i]} Approved overlapping shot direction (if the same shot spans intervals, advance it without restarting it): ${active.map(sh => `[${sh.start}-${sh.end}s; continuous group framing; ${sh.characterIds.map(id => s.bible!.characters.find(x => x.id === id)?.name || id).join(", ")}]: ${safeVideoText(withoutDialogue(sh.action, c))}`).join(" THEN ") || "continue the previous planned framing"}. ${words.length ? `Scheduled speech: ${words.join("; ")}.` : "No scheduled speech: let the action, expression, ambient sound or a motivated still reaction breathe; do not add dialogue."}`;
  }).join("\n");
}

function safeVideoText(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/\b(sangre|sangriento|sangrienta|ensangrentad[oa]s?)\b/gi, "evidencia visible no gráfica")
      .replace(/\b(linchamiento|linchar|linchado|linchada)\b/gi, "confrontación pública amenazante")
      .replace(/\b(herida abierta|heridas abiertas|herida|herido|herida grave)\b/gi, "consecuencia física no gráfica")
      .replace(/\b(matar|asesinar|asesinato|muerte violenta)\b/gi, "amenaza grave");
  }
  if (Array.isArray(value)) return value.map(safeVideoText);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, safeVideoText(v)]));
  return value;
}

export function compileVideoPrompt(s: Snapshot, c: Clip, instructions: string) {
  const prev = s.targets.find(
    (t) => t.role === "clip" && t.clipNumber === c.number - 1,
  );
  return [
    "Generate one complete 8-second vertical audiovisual clip, with native audio. One uninterrupted camera take follows the local timing below.",
    `The ONE approved image for this clip is its initial frame. All ${c.characterIds.length} participating characters (${c.characterIds.map(id => s.bible!.characters.find(x => x.id === id)?.name || id).join(", ")}) must already be visible and recognizable in that opening image. Preserve their exact appearance, wardrobe and positions throughout the continuous camera movement; do not invent, replace or duplicate a character. Generate all later smooth camera moves and reactions inside this video from the timing below; they do not have separate images.`,
    visualTreatment(s.project.universeSnapshot.visualStyle),
    ["Frutas", "Verduras", "Diamantes y minerales", "Objetos", "Insectos"].includes(s.project.universeSnapshot.beings)
      ? `CHARACTER DESIGN LOCK FOR VIDEO: ${s.project.characterDesign || "Humanoide"}. Preserve exactly the head architecture visible in the approved initial image and canonical character identity. Humanoide means fully humanoid head/face/hair. Cabeza de especie/material means a normal-scale complete recognizable species/material head on the attractive proportionate humanoid body, with expressive integrated face and the approved full hairstyle. Never switch between these modes during animation and never enlarge the head into a mascot/chibi proportion.`
      : "",
    "Preserve exact recurring identities and voice descriptions. Speak the approved dialogue literally; do not translate. No unrequested voices. Music, if requested, must not mask dialogue. Do not add an intro or outro to every clip.",
    speechDirection(s, c),
    "STRICT SCRIPT FIDELITY: Veo renders ONLY the events literally scheduled in this clip. It must not invent a climax, complication, surprise, spectacle, hazard, damage, transformation, weather event or environmental change to make the eight seconds more interesting. If the scheduled action is ordinary (for example driving and talking), keep it ordinary for the entire clip. Never add lightning, electricity, magic, energy beams, explosions, fire, smoke, sparks, supernatural light, earthquakes, cracked pavement, crashes, vehicle deformation/disassembly, flying debris, broken objects or sudden destruction unless that exact event is explicitly written in this clip's approved action/effects. Empty time is filled only by continuing the existing ordinary motion, natural breathing, eyelines and subtle reactions.",
    "PHYSICAL CONTINUITY: preserve the initial frame's vehicle, road, cabin, props, lighting, weather and environment intact unless the approved clip explicitly changes one of them. Do not escalate the scene. Do not infer visual effects from emotional words such as tension, climax, conflict, consequence or revelation.",
    `GENRE REALITY LOCK: selected genre="${s.project.genre}", subgenre="${s.project.subgenre}", world="${s.project.worldSetting || "Mundo real actual"}". Visual style (including Cinemático Épico) controls cinematography/render quality ONLY; it NEVER adds fantasy physics or spectacle. Unless the selected genre/world or this exact approved clip explicitly requires supernatural phenomena, keep reality grounded: NO lightning bolts, electrical arcs, magical rays, energy streaks, supernatural flashes, glowing cracks, aura, sparks, shockwaves or fantasy weather. Mafia, romance, drama, comedy, crime and contemporary stories remain physically ordinary.`,
    "LIGHTING IS NOT AN EVENT: lamps, neon, headlights, sunlight, reflections, rim light, practical lights and cinematic highlights remain stable illumination attached to their real sources. NEVER animate a light source into a lightning bolt, beam, ray, electrical discharge, magical streak or falling flash. A bright line in the initial image stays a normal light/reflection; it does not travel, strike, pulse, explode or interact with characters. Preserve the opening image's lighting character through all 8 seconds.",
    "VISUAL PERFORMANCE MAP: EIGHT SECONDS (local time, continuous and non-repeating):\n" +
      c.shots.map((sh, i) => `Action ${i + 1}, ${sh.start}-${sh.end}s: ${safeVideoText(withoutDialogue(sh.action, c))}`).join("\n") +
      "\n" + performanceTimeline(s, c),
    "Perform only the approved physical action and literal dialogue. If the action finishes early, simply continue the established ordinary motion and natural reaction; never invent a new event to fill time. Do not invent turns around the character's own axis, pacing, repeated hand motions, camera orbit, repeated actions, unrelated gestures or spectacle. Keep the same continuous viewpoint, physical environment and participants. The four intervals above are timing guidance, not permission to add events.",
    "FIGURATIVE LANGUAGE IS NOT PHYSICAL ACTION: spoken dialogue may contain metaphor, sarcasm, irony, idioms, teasing, exaggeration, threats, comparisons or figures of speech. Interpret those lines for emotional performance and subtext ONLY; never materialize their literal words as an unscripted visual event. Example: «eres alérgico a la justicia» means the person avoids/resists justice; it does NOT mean allergy symptoms, sneezing, coughing, rash, medicine or illness. Likewise figurative fire, ice, electricity, explosions, death, hunger, animals, storms, etc. do not become physical effects unless the approved ACTION/EFFECTS explicitly schedules them. Dialogue text alone never authorizes a new prop, symptom, transformation, weather event or visual effect.",
    c.characterIds.length === 2
      ? `Film both people in ONE shared physical scene. ${vehicleDirection(s, c) ? "Preserve their approved physical seats." : "Preserve the spatial relationship already established by the approved initial image; do not invent new screen-left/screen-right assignments."} Any pointing or accusation reaches the other visible person in the opening exchange. Show reactions within the shared group framing; the listener looks toward the visible speaker, never directly into the lens. Preserve furniture and lighting throughout the take.`
      : "",
    vehicleDirection(s, c),
    "Locked visual/world context: " + JSON.stringify({
      visualStyle: s.project.universeSnapshot.visualStyle,
      beings: s.project.universeSnapshot.beings,
      worldSetting: s.project.worldSetting || "Mundo real actual",
      characterDesign: s.project.characterDesign || "Humanoide",
    }),
    "Present-character VISUAL identity only; canonical voices are supplied separately above for actual speakers: " +
      JSON.stringify({
        version: s.project.bible?.id,
        characters: s.bible!.characters.filter((x) => c.characterIds.includes(x.id)).map(x => ({
          id: x.id, name: x.name, gender: x.gender, age: x.age, material: x.material,
          face: x.face, silhouette: x.silhouette, color: x.color, texture: x.texture,
          hair: renderHair(s.project.id, x), eyes: x.eyes, wardrobe: x.wardrobe,
          accessories: x.accessories, gestures: x.gestures, lockedTraits: x.lockedTraits,
        })),
        locations: safeVideoText(s.bible!.locations.filter((x) => x.id === c.locationId)),
      }),
    "CONTINUITY HANDOFF — this clip begins from the previous clip, not from a fresh scene. Preserve the incoming physical/emotional state and carry any pending nextAction, question, decision or interaction forward before starting unrelated business: " +
      withoutDialogue(JSON.stringify(safeVideoText(prev ? s.observed[prev.id] || c.continuityIn : s.project.previousChapter?.finalState || c.continuityIn)), c),
    "Local physical plan, constraints, audio and expected final state. Spoken words are defined ONLY in the canonical speech schedule above and are omitted here to prevent duplication: " +
      withoutDialogue(JSON.stringify(safeVideoText({ ...c, dialogue: [], shots: c.shots.map(sh => ({ ...sh, dialogue: "", action: withoutDialogue(sh.action, c), framing: "Continuous group view; smooth movement only; all clip characters remain visible", characterIds: c.characterIds })) })), c),
    withoutDialogue(String(safeVideoText(instructions)), c),
    continuousCamera,
  ].join("\n\n");
}
export function reviewClipTiming(s: Snapshot, c: Clip) {
  return {
    warnings: dialogueWarnings(c),
    previousApprovedVersion: s.targets.find(t => t.role === "clip" && t.clipNumber === c.number - 1)?.approvedVersionId || null,
    speechVerification: "Prompt/timing checks only; speaker identity, pronunciation and lip sync require listening to the generated clip.",
  };
}

export async function directPrompt(j: Job, target: Target, context: string,
  beforeCall: (key: string) => Promise<void>, checkpoint: (key: string, value: unknown) => Promise<void>) {
  if (target.kind !== "video") return coreDirectPrompt(j, target, context, beforeCall, checkpoint);
  const key = `prompt_${target.id}`;
  const saved = j.checkpoint[key] as { prompt?: unknown; compilerVersion?: number } | undefined;
  if (saved?.compilerVersion === 1 && typeof saved.prompt === "string") return saved.prompt;
  const c = j.snapshot.plan?.clips.find(clip => clip.number === target.clipNumber);
  if (!c) throw new AppError("VIDEO_PLAN", "No se encontró el guion de este clip.", 422);
  // Never change or resubmit an operation already accepted by Veo. Preserve
  // legacy prompt provenance and the pending-call recovery protection.
  if (j.checkpoint.operation || j.checkpoint.videoObject || j.checkpoint.pendingCall) {
    const previous = j.checkpoint[`prompt_${target.id}`] as { prompt?: unknown } | undefined;
    const legacyContext = legacyVideoPrompt(j.snapshot, c, j.instructions || target.instructions);
    if (typeof previous?.prompt === "string")
      return coreDirectPrompt(j, target, legacyContext, beforeCall, checkpoint);
    return legacyContext;
  }
  const problems = dialogueProblems(j.snapshot, c);
  if (problems.length) throw new AppError("DIALOGUE_TIMING", problems.join(" "), 422);
  // No extra text-model call, no paraphrased duplicate, no old cached rewrite.
  // The existing prompt key also prevents older Cloud Run workers from making
  // another paid text call while polling an operation submitted by the new web.
  await checkpoint(key, { prompt: context, compilerVersion: 1, timingWarnings: dialogueWarnings(c) });
  return context;
}
