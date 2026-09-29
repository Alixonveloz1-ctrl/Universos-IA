// Narrative/image generation is preserved in core.ts. The video entry points
// below compile one deterministic script instead of rewriting and duplicating it.
import {
  narrativePrompt as coreNarrativePrompt,
  runDirector as coreRunDirector,
  directPrompt as coreDirectPrompt,
  compileVideoPrompt as legacyVideoPrompt,
} from "./core";
import { AppError } from "../errors";
import type { Clip } from "../schemas";
import type { Job, Snapshot, Target } from "../types";
import { dialogueProblems, dialogueWarnings, speechDirection, SPEECH_PLAN_DIRECTION, withoutDialogue } from "./speech";
import { visualTreatment } from "./styles";
import { renderHair } from "./hair";
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
  return coreRunDirector(directedJob(j), beforeCall, checkpoint);
}

export function compileVideoPrompt(s: Snapshot, c: Clip, instructions: string) {
  const clean = (value: unknown) => withoutDialogue(typeof value === "string" ? value : JSON.stringify(value), c);
  const prev = s.targets.find(t => t.role === "clip" && t.clipNumber === c.number - 1);
  const names = c.characterIds.map(id => s.bible!.characters.find(x => x.id === id)?.name || id).join(", ");
  const location = s.bible?.locations.find(l => l.id === c.locationId);
  const vehicle = /\b(?:carro|auto|autom[oó]vil|coche|veh[ií]culo|camioneta|volante|conduc|asiento|parabrisas|gasolinera|car|vehicle|steering|driver|passenger)\b/i
    .test([c.goal, ...c.shots.map(sh => sh.action), location?.name, location?.layout].join(" "));
  const actions = c.shots.map((sh, i) => `Action ${i + 1}, ${sh.start}-${sh.end}s: ${clean(sh.action)}`).join("\n");
  const timeline = [0, 2, 4, 6].map(start => {
    const actionsHere = c.shots.flatMap((sh, i) => sh.start < start + 2 && sh.end > start ? [i + 1] : []);
    return `${start}-${start + 2}s: advance visual action(s) ${actionsHere.join(", ") || "already established"}; continue preparation, action or its consequence without restarting. Speech follows its own complete turns below, never these visual boundaries.`;
  }).join("\n");
  return [
    "Generate one complete 8-second vertical audiovisual clip with native audio, using the approved image as its initial frame.",
    visualTreatment(s.project.universeSnapshot.visualStyle),
    "CANONICAL PARTICIPANT IDENTITIES:\n" + c.characterIds.map(id => { const character = s.bible!.characters.find(x => x.id === id)!; return JSON.stringify({ ...character, hair: renderHair(s.project.id, character) }); }).join("\n"),
    speechDirection(s, c),
    `All ${c.characterIds.length} participating characters (${names}) remain visible and recognizable. Match their exact appearance, clothing, placement, lighting and ${s.project.universeSnapshot.visualStyle} treatment to the initial image. Do not redesign the still image. Keep speaking faces readable in the shared framing; the listener looks toward the visible speaker, never directly into the lens.`,
    vehicle ? "VEHICLE GEOGRAPHY: preserve the approved physical seats and camera viewpoint; never mirror the image. For a camera in the back seat looking forward in a left-hand-drive car, the steering wheel and DRIVER are on the IMAGE LEFT and the front PASSENGER is on the IMAGE RIGHT. Seat roles override generic cast-order screen-left instructions. The initial image, not cast order, identifies each seat." : "Preserve the actual left/right positions from the initial image; a cast-list order is not a command to swap places.",
    "Visual goal: " + clean(c.goal),
    "Approved scene constraints (the speech schedule controls all spoken words): " + clean(c.constraints || []),
    "VISUAL DIRECTION ONLY — action descriptions never authorize extra dialogue. Each action is listed once:\n" + actions,
    "VISUAL PERFORMANCE MAP:\n" + timeline,
    "Perform the approved action once, with motivated preparation and reaction throughout the eight seconds. Do not invent turns around the character's own axis, pacing, repeated gestures or filler. Keep the mouths unobstructed while speaking. The speech schedule takes precedence over incidental speech descriptions in old action notes.",
    "Approved incoming state: " + clean(prev ? s.observed[prev.id] || c.continuityIn : s.project.previousChapter?.finalState || c.continuityIn),
    "Expected resulting state: " + clean(c.plannedEndState),
    "Ambient sound: " + clean(c.soundDirection.ambience) + ". Sound effects: " + clean(c.soundDirection.effects) + ". Music direction: " + clean(c.soundDirection.music || "none") + ". All sound is native to Veo. Keep ambience and any instrumental music below the dialogue; no sung words or competing voices.",
    instructions.trim() ? "Additional scene direction (does not reassign speakers or add words to the speech schedule): " + clean(instructions) : "",
    continuousCamera,
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
