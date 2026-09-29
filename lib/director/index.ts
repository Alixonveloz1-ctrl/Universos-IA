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
  const prev = s.targets.find(
    (t) => t.role === "clip" && t.clipNumber === c.number - 1,
  );
  return [
    "Generate one complete 8-second vertical audiovisual clip, with native audio. One uninterrupted camera take follows the local timing below.",
    `The ONE approved image for this clip is its initial frame. All ${c.characterIds.length} participating characters (${c.characterIds.map(id => s.bible!.characters.find(x => x.id === id)?.name || id).join(", ")}) must already be visible and recognizable in that opening image. Preserve their exact appearance, wardrobe and positions throughout the continuous camera movement; do not invent, replace or duplicate a character. Generate all later smooth camera moves and reactions inside this video from the timing below; they do not have separate images.`,
    visualTreatment(s.project.universeSnapshot.visualStyle),
    "Preserve exact recurring identities and voice descriptions. Speak the approved dialogue literally; do not translate. No unrequested voices. Music, if requested, must not mask dialogue. Do not add an intro or outro to every clip.",
    speechDirection(s, c),
    "EIGHT-SECOND PERFORMANCE MAP (local time, continuous and non-repeating):\n" + performanceTimeline(s, c),
    "Direct every second through concrete causal movement, the approved dialogue and motivated reactions. If the main action is brief (for example opening a door), use the surrounding seconds for its natural preparation, the action itself and its immediate consequence. Do not invent turns around the character's own axis, pacing, repeated hand motions, camera orbit, a second opening of the same door, unrelated gestures, empty filler or an abrupt freeze. Keep the same continuous viewpoint and preserve every participant in frame. Keep a continuous spatial and emotional state across all four intervals. The four intervals above are performance instructions, not four new still images or extra video clips.",
    c.characterIds.length === 2
      ? `Film both people in ONE shared physical scene. ${vehicleDirection(s, c) ? "Preserve their approved physical seats." : `Establish ${s.bible!.characters.find(x => x.id === c.characterIds[0])?.name || "the first character"} screen LEFT and ${s.bible!.characters.find(x => x.id === c.characterIds[1])?.name || "the second character"} screen RIGHT.`} Any pointing or accusation reaches the other visible person in the opening exchange. Show reactions within the shared group framing; the listener looks toward the visible speaker, never directly into the lens. Preserve furniture and lighting throughout the take.`
      : "",
    vehicleDirection(s, c),
    "Locked universe, premise and arc: " +
      JSON.stringify({
        universe: s.project.universeSnapshot,
        story: s.project.story?.data,
      }),
    "Bible version and present characters: " +
      JSON.stringify({
        version: s.project.bible?.id,
        characters: s.bible!.characters.filter((x) =>
          c.characterIds.includes(x.id),
        ).map(x => ({ ...x, hair: renderHair(s.project.id, x) })),
        locations: s.bible!.locations.filter((x) => x.id === c.locationId),
      }),
    "Approved observed incoming state: " +
      JSON.stringify(prev ? s.observed[prev.id] || c.continuityIn : s.project.previousChapter?.finalState || c.continuityIn),
    "Local shots, literal dialogue, performance, audio and expected final state: " +
      JSON.stringify({ ...c, shots: c.shots.map(sh => ({ ...sh, framing: "Continuous group view; smooth movement only; all clip characters remain visible", characterIds: c.characterIds })) }),
    instructions,
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
