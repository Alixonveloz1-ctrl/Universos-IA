import { designContext, usesSpeciesHead } from "./character-design";
// Narrative/image generation is preserved in core.ts. The video entry points
// below compile one motion sequence and one unchanged canonical spoken script.
import {
  narrativePrompt as coreNarrativePrompt,
  runDirector as coreRunDirector,
  directPrompt as coreDirectPrompt,
} from "./core";
import { AppError } from "../errors";
import { renderHair } from "./hair";
import type { Clip } from "../schemas";
import type { Job, Snapshot, Target } from "../types";
import { dialogueProblems, dialogueWarnings, speechDirection, SPEECH_PLAN_DIRECTION, withoutDialogue } from "./speech";
import { runPlan } from "./plan-runner";
import { MOTION_PLAN_DIRECTION, motionStates, plannedMotion, prepareMotion, type Motion } from "./motion";
export { compileImagePrompt } from "./core";

const continuousCamera = "ONE CONTINUOUS TAKE for all 8 seconds. No cuts, shot/reverse-shot, montage, transitions, inserts or sudden viewpoint changes. Use a stable camera or slow shallow tracking while keeping EVERY participating character visible and recognizable throughout the directed action. Keep faces and clothing in view; preserve coherent screen relationships as people move along their directed trajectories. If a requested close-up or movement would hide a participant, retain the wider group framing or track gently instead. Preserve the initial image identities, hairstyles, clothes and materials without transformation. Older shot divisions are timing beats ONLY: replace their camera cuts with continuous movement. This camera rule overrides conflicting framing directions in older plans or saved prompts.";

function directedJob(j: Job): Job {
  if (j.type !== "plan") return j;
  return {
    ...j,
    instructions: [j.instructions, SPEECH_PLAN_DIRECTION, MOTION_PLAN_DIRECTION].filter(Boolean).join("\n\n"),
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

export function compileVideoPrompt(s: Snapshot, c: Clip, instructions: string, directedMotion?: Motion) {
  const motion = directedMotion || plannedMotion(c);
  const action = motion
    ? motion.beats.map((beat, i) => `${i * 2}-${(i + 1) * 2}s: ${safeVideoText(withoutDialogue(beat, c))}`)
    : c.shots.map((sh, i) => `Action ${i + 1}, ${sh.start}-${sh.end}s: ${safeVideoText(withoutDialogue(sh.action, c))}`);
  const cast = c.characterIds.map(id => s.bible!.characters.find(ch => ch.id === id)).filter(ch => !!ch);
  return [
    "Animate the supplied opening image as one 8-second vertical clip with native synchronized audio. One continuous physical interaction develops at a natural pace across the ENTIRE eight seconds; each timed action flows directly into the next.",
    `All ${c.characterIds.length} participating characters (${cast.map(ch => ch.name).join(", ")}) remain visible. The image defines their faces, body/head shapes, clothes, positions, lighting and ${s.project.universeSnapshot.visualStyle} rendering. Preserve it while animating; do not rebuild or redesign the scene.`,
    `Image identity cues: ${JSON.stringify(cast.map(ch => ({ name: ch.name, material: ch.material, wardrobe: ch.wardrobe, hair: renderHair(s.project.id, ch, designContext(s.project)) })))}. Keep the ${usesSpeciesHead(designContext(s.project)) ? "SPECIES/MATERIAL HEAD" : "100% HUMANOID HEAD"} architecture visible in the approved image.`,
    continuousCamera,
    "VISUAL PERFORMANCE MAP: These are successive phases of ONE interaction, not cuts or repeated performances. Carry each motion at normal speed through its assigned interval; do not perform the whole sequence early and then pose.\n" + action.join("\n"),
    "FINAL-FRAME HANDOFF: At 7–8s the final directed response is still developing. Reach its resulting state at the cut, with the cast visible and engaged. There is no gratuitous walk-off, empty location, reset, outro or freeze. A plot-required departure uses short continuous camera tracking to keep people visible until the cut. Do not invent turns around the character's own axis, pacing, repeated hand motions or a new event to fill time.",
    "Perform ONLY the directed interaction. Emotional tension, climax and figurative words are acting cues, not permission to add a physical event or effect. Preserve ordinary physics, props and lighting from the initial image. Speech is conversation, never narration of the plot. The listener looks toward the visible speaker and reacts within the shared frame.",
    "Physical continuity handoff, not a new scene or a spoken script. The image supplies the setting; reach the ending posture/emotion/held objects at the cut: " + String(safeVideoText(withoutDialogue(JSON.stringify(motionStates(s, c)), c))),
    vehicleDirection(s, c),
    speechDirection(s, c),
    "NATIVE AUDIO: " + String(safeVideoText(withoutDialogue([c.soundDirection.ambience, ...c.soundDirection.effects, c.soundDirection.music].filter(Boolean).join(". "), c))),
    /comedia|c[oó]mico/iu.test([s.project.genre, s.project.subgenre, s.project.tone].join(" "))
      ? "COMEDY AUDIO AND MOVEMENT: Natural dialogue and specific social reactions carry the humor. No canned laughter, applause, sitcom sting, punchline jingle or spontaneous dancing unless the user explicitly requested it. Use restrained continuous scene ambience; this overrides generic comic cues in older plans."
      : "",
    c.constraints.length ? "Continuity constraints: " + String(safeVideoText(withoutDialogue(c.constraints.join(". "), c))) : "",
    instructions.trim() ? "User direction: " + String(safeVideoText(withoutDialogue(instructions, c))) : "",
  ].filter(Boolean).join("\n\n");
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
  // An accepted operation always retains its exact submitted prompt. Polling
  // on an older Cloud Run worker must never prepare or pay for another request.
  if (j.checkpoint.operation || j.checkpoint.videoObject || j.checkpoint.pendingCall) {
    if (typeof saved?.prompt === "string") return saved.prompt;
    return context;
  }
  if (saved?.compilerVersion === 2 && typeof saved.prompt === "string") return saved.prompt;
  const c = j.snapshot.plan?.clips.find(clip => clip.number === target.clipNumber);
  if (!c) throw new AppError("VIDEO_PLAN", "No se encontró el guion de este clip.", 422);
  const problems = dialogueProblems(j.snapshot, c);
  if (problems.length) throw new AppError("DIALOGUE_TIMING", problems.join(" "), 422);
  const motion = await prepareMotion(j, target, c, beforeCall, checkpoint);
  const prompt = compileVideoPrompt(j.snapshot, c, j.instructions || target.instructions, motion);
  await checkpoint(key, { prompt, compilerVersion: 2, motionSource: plannedMotion(c) && !(j.instructions || target.instructions).trim() ? "plan" : "staged", timingWarnings: dialogueWarnings(c) });
  console.info("chapter_video_direction", { jobId: j.id, targetId: target.id, compilerVersion: 2, motionIntervals: 4, promptCharacters: prompt.length });
  return prompt;
}
