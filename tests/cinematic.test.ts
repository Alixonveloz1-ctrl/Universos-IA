import { describe, expect, it } from "vitest";
import {
  alignCinematicPlan,
  cinematicSegmentDurations,
  cinematicShotDurations,
  cinematicProjectInput,
  validateCinematicPlan,
  type CinematicPlan,
} from "../lib/cinematic/schema";
import { CINEMATIC_NEGATIVE_PROMPT, cinematicNegativePrompt, compileCinematicCharacterPrompt,
  compileCinematicOpeningImagePrompt, compileCinematicVideoPrompt } from "../lib/cinematic/director";
import { videoRequest } from "../lib/providers/vertex";
import { verifiedVideoObject } from "../lib/direct-video";
import { currentManifest } from "../worker/cinematic";
import type { CinematicAsset, CinematicFinalizeJob, CinematicProject } from "../lib/cinematic/types";
import { cinematicImageCharacterIds, cinematicMissingApprovedVideos, currentCinematicVideo } from "../lib/cinematic/types";

function plan30(): CinematicPlan {
  const durations = cinematicSegmentDurations(30);
  return {
    title: "La puerta",
    premise: "Una mujer descubre una verdad detrás de una puerta cerrada.",
    hook: "La protagonista ya está intentando abrir la puerta en el primer segundo.",
    ending: "El rostro que encuentra dentro cambia el significado de todo.",
    visualBible: "Premium realistic cinematic short drama, shallow depth of field, stable identities.",
    colorAndLighting: "Warm practical key light with cool window separation.",
    cameraLanguage: "35mm establishing, 50-70mm medium, 85-100mm reactions.",
    editingLanguage: "Information-driven hard cuts, inserts, POV and reaction close-ups.",
    soundBible: {
      identity: "Restrained suspense with one continuous dramatic identity.",
      musicPalette: "Dark intimate cinematic suspense.",
      instrumentation: "Low cello, muted pulse and sparse piano.",
      rhythmAndTempo: "Slow 72 BPM pulse, never restarting at visual cuts.",
      ambienceBed: "Quiet interior room tone with distant traffic.",
      dialogueMix: "Close intelligible production dialogue above music.",
      effectsLanguage: "Detailed motivated Foley with brief impact accents.",
      continuityRule: "Carry music and room tone across hard cuts and technical block boundaries.",
    },
    characters: [{
      id: "mara",
      name: "Mara",
      role: "Protagonista",
      age: "32",
      gender: "Mujer",
      visualIdentity: "Adult woman, oval face, dark wavy hair, brown eyes, stable facial geometry.",
      wardrobe: "Dark blue tailored coat and cream blouse.",
      lockedTraits: ["dark wavy hair", "brown eyes", "dark blue coat"],
      voice: {
        timbre: "warm mezzo",
        register: "mid-low",
        rhythm: "measured",
        energy: "contained",
        diction: "clear conversational",
        expression: "tense but controlled",
      },
    }],
    segments: durations.map((duration, index) => ({
      number: index + 1,
      durationSeconds: duration,
      goal: `Advance revelation ${index + 1}`,
      location: "Same apartment hallway.",
      characterIds: ["mara"],
      continuityIn: index === 0 ? "Mara stands at the closed door." : `state-${index}`,
      continuityOut: `state-${index + 1}`,
      audioContinuityIn: index === 0 ? "Low cello pulse and quiet room tone are already active." : `audio-${index}`,
      audioContinuityOut: `audio-${index + 1}`,
      openingFrameDirection: "Mara in controlled medium close-up facing the door.",
      shots: [
        {
          id: `s${index + 1}a`,
          start: 0,
          end: duration / 2,
          shotType: "medium" as const,
          lensMm: 55,
          camera: "locked with a shallow push-in",
          framing: "waist-up, eyes on the door",
          action: "Mara reaches toward the handle and listens.",
          characterIds: ["mara"],
          transition: "start" as const,
          nativeAudioBeat: "room tone and restrained score continue",
        },
        {
          id: `s${index + 1}b`,
          start: duration / 2,
          end: duration,
          shotType: "close-up" as const,
          lensMm: 90,
          camera: "locked close-up",
          framing: "face dominant",
          action: "Her eyes register a new piece of information.",
          characterIds: ["mara"],
          transition: "hard-cut" as const,
          nativeAudioBeat: "sound bridge continues over the hard cut",
        },
      ],
      dialogue: [],
      soundEffects: ["subtle clothing movement"],
      musicDirection: "Continue the same low cello pulse without a restart.",
    })),
  };
}

function shotPlan(total: 30 | 60 | 90): CinematicPlan {
  const plan = plan30();
  const source = plan.segments[0];
  plan.segments = cinematicShotDurations(total).map((duration, index) => ({
    ...structuredClone(source),
    number: index + 1,
    durationSeconds: duration,
    goal: `Beat ${index + 1}`,
    continuityIn: index === 0 ? "Mara stands at the closed door." : `state-${index}`,
    continuityOut: `state-${index + 1}`,
    audioContinuityIn: index === 0 ? "Quiet room tone and cello." : `audio-${index}`,
    audioContinuityOut: `audio-${index + 1}`,
    shots: [{ ...structuredClone(source.shots[0]), id: `take-${index + 1}`, start: 0, end: duration,
      openingSubjects: [{ characterId: "mara", screenSide: "center", depth: "foreground",
        faceVisible: true, visibleParts: "face and upper body" }],
      physicalContacts: [],
      action: `Mara performs one small action for beat ${index + 1}.` }],
  }));
  return plan;
}

describe("cinematic production contract", () => {
  it("accepts an empty concept, validates dependent subgenres and defaults older productions to realism", () => {
    const input = { durationSeconds: 30, language: "Español", accent: "Latinoamericano",
      models: { text: "gemini-3-flash-preview", image: "gemini-3.1-flash-image", video: "veo-3.1-lite-generate-001" } };
    expect(cinematicProjectInput.parse(input)).toMatchObject({ concept: "", visualStyle: "realistic", genre: "drama", subgenre: "family" });
    expect(cinematicProjectInput.parse({ ...input, genre: "fantasy", subgenre: "isekai" }).concept).toBe("");
    expect(() => cinematicProjectInput.parse({ ...input, genre: "fantasy", subgenre: "family" })).toThrow();
  });

  it("locks anime 2D across reference, opening frame and video without changing audio or shot structure", () => {
    const plan = plan30();
    const character = compileCinematicCharacterPrompt(plan, plan.characters[0], "anime2d");
    const opening = compileCinematicOpeningImagePrompt(plan, plan.segments[0], "anime2d");
    const video = compileCinematicVideoPrompt(plan, plan.segments[0], "Español", "Latinoamericano", "anime2d");
    for (const prompt of [character, opening, video]) {
      expect(prompt).toContain("PREMIUM HAND-DRAWN 2D CINEMATIC ANIME");
      expect(prompt).not.toContain("PREMIUM PHOTOREALISTIC");
    }
    expect(video).toContain("MULTI-SHOT CINEMATIC MICROSEQUENCE");
    expect(video).toContain("NATIVE AUDIO");
    expect(video).not.toContain("photorealistic CINEMATIC VIDEO");
    expect(cinematicNegativePrompt("anime2d")).toContain("photorealism");
    expect(cinematicNegativePrompt("anime2d")).not.toContain("cel shading");
    expect(cinematicNegativePrompt("realistic")).toContain("cel shading");
  });
  it("aligns the Director's shot boundaries and literal handoffs without changing the story", () => {
    const draft = plan30();
    draft.segments[1].durationSeconds = 6;
    draft.segments[1].continuityIn = "different wording";
    draft.segments[1].audioContinuityIn = "different audio wording";
    draft.segments[1].shots[0].end = 3.1;
    draft.segments[1].shots[1].start = 3.2;
    draft.segments[1].shots[1].end = 6;
    const aligned = alignCinematicPlan(draft, 30);
    const result = validateCinematicPlan(aligned, 30);
    expect(result.segments[1].durationSeconds).toBe(8);
    expect(result.segments[1].continuityIn).toBe(result.segments[0].continuityOut);
    expect(result.segments[1].audioContinuityIn).toBe(result.segments[0].audioContinuityOut);
    expect(result.segments[1].shots[0].end).toBe(result.segments[1].shots[1].start);
    expect(result.segments[1].shots[1].end).toBe(8);
    expect(result.segments[1].goal).toBe(draft.segments[1].goal);
  });

  it("builds exact Veo-compatible technical durations", () => {
    expect(cinematicSegmentDurations(30)).toEqual([8, 8, 8, 6]);
    expect(cinematicSegmentDurations(60)).toEqual([8, 8, 8, 8, 8, 8, 8, 4]);
    expect(cinematicSegmentDurations(90)).toEqual([8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 6, 4]);
    for (const total of [30, 60, 90] as const)
      expect(cinematicSegmentDurations(total).reduce((a, b) => a + b, 0)).toBe(total);
  });

  it("builds one native video and one opening image for each independently planned shot", () => {
    for (const total of [30, 60, 90] as const) {
      const durations = cinematicShotDurations(total);
      expect(durations.length).toBe(({ 30: 7, 60: 10, 90: 15 } as const)[total]);
      expect(durations.every(d => [4, 6, 8].includes(d))).toBe(true);
      expect(durations.reduce((sum, d) => sum + d, 0)).toBe(total);
      const plan = validateCinematicPlan(shotPlan(total), total, "shot");
      expect(plan.segments.every(s => s.shots.length === 1 && s.shots[0].end === s.durationSeconds)).toBe(true);
    }

    const plan = shotPlan(30);
    const opening = compileCinematicOpeningImagePrompt(plan, plan.segments[0]);
    const video = compileCinematicVideoPrompt(plan, plan.segments[0], "Español", "Latinoamericano");
    expect(opening).toContain("EXACT opening frame for one cinematic shot");
    expect(video).toContain("ONE CONTINUOUS SHOT FROM THE SUPPLIED OPENING IMAGE");
    expect(video).toContain("ONLY SHOT (seconds within this video)");
    expect(video).not.toContain("MULTI-SHOT CINEMATIC MICROSEQUENCE");
    expect(video).not.toContain("HARD-CUT transitions");
    expect(videoRequest("veo-3.1-lite-generate-001", video,
      [{ bytesBase64Encoded: "AA==", mimeType: "image/png" }], "initial",
      "gs://bucket/shot/", plan.segments[0].durationSeconds).parameters.durationSeconds).toBe(4);

    const extraShot = structuredClone(plan);
    extraShot.segments[0].shots.push({ ...extraShot.segments[0].shots[0], id: "unexpected-cut",
      start: 2, end: 4, transition: "hard-cut" });
    expect(() => validateCinematicPlan(extraShot, 30, "shot")).toThrow("exactamente un plano");
    expect(() => validateCinematicPlan(plan, 30)).toThrow("bloques técnicos");
  });

  it("uses only the current shot's visible cast as image references while preserving legacy approvals", () => {
    const plan = shotPlan(30);
    plan.characters.push({ ...plan.characters[0], id: "leo", name: "Leo" });
    plan.segments[0].characterIds.push("leo");
    expect(cinematicImageCharacterIds(plan.segments[0], "one-shot-per-video")).toEqual(["mara"]);
    expect(cinematicImageCharacterIds(plan.segments[0])).toEqual(["mara", "leo"]);
    plan.segments[0].shots[0].characterIds = [];
    plan.segments[0].shots[0].openingSubjects = [];
    expect(cinematicImageCharacterIds(plan.segments[0], "one-shot-per-video")).toEqual([]);
    expect(validateCinematicPlan(plan, 30, "shot").segments[0].shots).toHaveLength(1);
  });

  it("rejects a background holder of a foreground hand and locks a hidden face to its own later shot", () => {
    const plan = shotPlan(30);
    plan.characters.push({ ...plan.characters[0], id: "leo", name: "Leo" });
    const first = plan.segments[0];
    first.characterIds.push("leo");
    first.shots[0].characterIds.push("leo");
    first.shots[0].openingSubjects!.push({ characterId: "leo", screenSide: "right",
      depth: "background", faceVisible: false, visibleParts: "distant silhouette" });
    first.shots[0].physicalContacts = [{ actorId: "leo", targetId: "mara",
      atFrameZero: true, contact: "Leo holds Mara's wrist" }];
    expect(() => validateCinematicPlan(plan, 30, "shot")).toThrow("lejos");

    first.shots[0].openingSubjects![1] = { characterId: "leo", screenSide: "right",
      depth: "adjacent-offscreen", faceVisible: false, visibleParts: "connected arm and hand only" };
    expect(validateCinematicPlan(plan, 30, "shot").segments[0].shots[0].physicalContacts).toHaveLength(1);
    const image = compileCinematicOpeningImagePrompt(plan, first);
    const video = compileCinematicVideoPrompt(plan, first, "Español", "Latinoamericano");
    expect(image).toContain("background cannot also own a foreground hand");
    expect(image).toContain('"faceVisible":false');
    expect(video).toContain("people whose faces must stay hidden: Leo");
    expect(video).toContain("A later face shot must be a separate video starting from its own approved image");

    first.dialogue = [{ characterId: "leo", text: "Detente.", intention: "urgent", start: 1, end: 2 }];
    expect(validateCinematicPlan(plan, 30, "shot").segments[0].dialogue).toHaveLength(1);
    const offscreenVoice = compileCinematicVideoPrompt(plan, first, "Español", "Latinoamericano");
    expect(offscreenVoice).toContain("native voice from the established offscreen or partial-body position");
    expect(offscreenVoice).toContain("every visible listener's mouth still");
    first.dialogue = [];
    const second = plan.segments[1];
    second.characterIds = ["leo"];
    second.shots[0].characterIds = ["leo"];
    second.shots[0].openingSubjects = [{ characterId: "leo", screenSide: "center",
      depth: "foreground", faceVisible: true, visibleParts: "face and upper body" }];
    second.shots[0].action = "Leo's face reacts from the first frame.";
    expect(validateCinematicPlan(plan, 30, "shot").segments[1].shots[0].openingSubjects?.[0].faceVisible).toBe(true);
    expect(compileCinematicVideoPrompt(plan, second, "Español", "Latinoamericano"))
      .toContain("recognizable faces at frame zero: Leo");
  });

  it("keeps an offscreen speaker entirely out of the starting image", () => {
    const plan = shotPlan(30);
    plan.characters.push({ ...plan.characters[0], id: "leo", name: "Leo" });
    const first = plan.segments[0];
    first.characterIds.push("leo");
    first.shots[0].characterIds.push("leo");
    first.shots[0].openingSubjects!.push({ characterId: "leo", screenSide: "right",
      depth: "adjacent-offscreen", faceVisible: false, visibleParts: "none, voice only" });
    first.dialogue = [{ characterId: "leo", text: "Espera.", intention: "warning", start: 1, end: 2 }];
    expect(validateCinematicPlan(plan, 30, "shot").segments[0].dialogue).toHaveLength(1);
    const image = compileCinematicOpeningImagePrompt(plan, first);
    expect(image).toContain("A reference does not require its character to appear in this frame");
    expect(image).toContain("zero visible parts for offscreen speech");
    const video = compileCinematicVideoPrompt(plan, first, "Español", "Latinoamericano");
    expect(video).toContain("initial visible parts: none, voice only");
    expect(video).toContain("native voice from the established offscreen or partial-body position");
  });

  it("reduces motion on rejected takes and constrains a doorway to a visible open gap", () => {
    const plan = shotPlan(30);
    const first = plan.segments[0];
    first.location = "Hallway by a closed door";
    first.shots[0].action = "Mara walks toward the doorway.";
    const initial = compileCinematicVideoPrompt(plan, first, "Español", "Latinoamericano");
    expect(initial).toContain("pass through only a visibly open gap");
    expect(initial).not.toContain("RETAKE DIRECTION");
    expect(initial).not.toContain("damage");
    expect(compileCinematicOpeningImagePrompt(plan, first)).not.toContain("deep open pit");
    const retry = compileCinematicVideoPrompt(plan, first, "Español", "Latinoamericano", "realistic", 1);
    expect(retry).toContain("smaller, slower action with a stable camera");
    const adjusted = compileCinematicVideoPrompt(plan, first, "Español", "Latinoamericano", "realistic", 2,
      "Stop before the closed door");
    expect(adjusted).toContain("minimum physically feasible motion");
    expect(adjusted).toContain("DIRECTOR ADJUSTMENT FOR THIS TAKE: Stop before the closed door");
    expect(adjusted).toContain("only where physically compatible with the approved starting image");
  });

  it("validates literal audiovisual handoffs and compiles multi-shot native audio prompts", () => {
    const plan = validateCinematicPlan(plan30(), 30);
    const prompt = compileCinematicVideoPrompt(plan, plan.segments[0], "Español", "Latinoamericano");
    expect(prompt).toContain("MULTI-SHOT CINEMATIC MICROSEQUENCE");
    expect(prompt).toContain("HARD-CUT");
    expect(prompt).toContain("NATIVE AUDIO");
    expect(prompt).toContain(plan.soundBible.identity);
    expect(prompt).not.toContain("ONE CONTINUOUS TAKE");
  });

  it("passes the selected cinematic duration to Veo without changing the default contract", () => {
    const ref = { bytesBase64Encoded: "AA==", mimeType: "image/png" };
    const request = videoRequest(
      "veo-3.1-fast-generate-001",
      "cinematic test",
      [ref],
      "initial",
      "gs://bucket/prefix/",
      6,
    );
    expect(request.parameters.durationSeconds).toBe(6);
    expect(request.parameters.generateAudio).toBe(true);
    expect(request.parameters.aspectRatio).toBe("9:16");
    expect(request.parameters).not.toHaveProperty("negativePrompt");
    const cinematicRequest = videoRequest(
      "veo-3.1-fast-generate-001", "cinematic test", [ref], "initial",
      "gs://bucket/prefix/", 6, CINEMATIC_NEGATIVE_PROMPT,
    );
    expect(cinematicRequest.parameters.negativePrompt).toContain("duplicated hands");
  });

  it("rejects duplicate identities and overlapping or invisible speech", () => {
    const duplicates = plan30();
    duplicates.characters.push({ ...duplicates.characters[0] });
    expect(() => validateCinematicPlan(duplicates, 30)).toThrow("duplicados");
    const overlapping = plan30();
    overlapping.segments[0].dialogue = [
      { characterId: "mara", text: "Primera frase", intention: "urgent", start: 1, end: 3 },
      { characterId: "mara", text: "Segunda frase", intention: "urgent", start: 2, end: 4 },
    ];
    expect(() => validateCinematicPlan(overlapping, 30)).toThrow("solapa");
    overlapping.segments[0].dialogue[1].start = 3;
    overlapping.segments[0].shots[0].characterIds = [];
    expect(() => validateCinematicPlan(overlapping, 30)).toThrow("hablante");
  });

  it("keeps the speaker visible in one shot while their voice bridges a cutaway", () => {
    const draft = plan30();
    const block = draft.segments[1];
    block.dialogue = [{ characterId: "mara", text: "Estoy aquí.", intention: "urgent", start: 3, end: 5 }];
    block.shots[1].shotType = "insert";
    block.shots[1].characterIds = [];
    const plan = validateCinematicPlan(draft, 30);
    const prompt = compileCinematicVideoPrompt(plan, block, "Español", "Latinoamericano");
    expect(prompt).toContain("on-screen cast: Mara [speaker_mara]");
    expect(prompt).toContain("on-screen cast: none");
    expect(prompt).toContain("same voice over any insert or reaction cutaway");
  });

  it("repairs a missing on-screen dialogue anchor without exceeding the cast limit", () => {
    const draft = plan30();
    const block = draft.segments[1];
    draft.characters.push({ ...draft.characters[0], id: "leo", name: "Leo" });
    block.dialogue = [{ characterId: "leo", text: "Estoy aquí.", intention: "urgent", start: 3, end: 5 }];
    const aligned = validateCinematicPlan(alignCinematicPlan(draft, 30), 30);
    expect(aligned.segments[1].characterIds).toContain("leo");
    expect(aligned.segments[1].shots[0].characterIds).toContain("leo");
    expect(aligned.segments[1].shots[0].framing).toContain("Leo");
    expect(aligned.segments[1].shots[0].action).toContain("scheduled dialogue");
    expect(aligned.segments[1].openingFrameDirection).toContain("Leo");
    expect(draft.segments[1].characterIds).not.toContain("leo");
    expect(draft.segments[1].shots[0].characterIds).not.toContain("leo");

    const reaction = plan30();
    reaction.characters.push({ ...reaction.characters[0], id: "leo", name: "Leo" });
    reaction.segments[0].characterIds.push("leo");
    reaction.segments[0].shots[0].shotType = "reaction";
    reaction.segments[0].shots[0].framing = "Only Mara listening; Leo is offscreen";
    reaction.segments[0].shots[0].action = "Mara reacts silently to Leo's voice.";
    reaction.segments[0].dialogue = [{ characterId: "leo", text: "Alto.", intention: "urgent", start: 1, end: 2 }];
    const fixed = validateCinematicPlan(alignCinematicPlan(reaction, 30), 30);
    expect(fixed.segments[0].shots[0].shotType).toBe("medium");
    expect(fixed.segments[0].shots[0].framing).not.toContain("Leo is offscreen");
    expect(fixed.segments[0].shots[0].action).toContain("Leo deliver");

    const full = plan30();
    full.characters.push(...["b", "c", "d", "e"].map(id => ({ ...full.characters[0], id })));
    full.segments[0].characterIds = ["mara", "b", "c", "d"];
    full.segments[0].shots[0].characterIds = ["mara", "b", "c", "d"];
    full.segments[0].dialogue = [{ characterId: "e", text: "Alto.", intention: "urgent", start: 1, end: 2 }];
    expect(() => validateCinematicPlan(alignCinematicPlan(full, 30), 30)).toThrow("reparto");
  });

  it("lists only characters visible in the opening shot", () => {
    const plan = plan30();
    plan.characters.push({ ...plan.characters[0], id: "leo", name: "Leo" });
    plan.segments[0].characterIds.push("leo");
    const prompt = compileCinematicOpeningImagePrompt(plan, plan.segments[0]);
    expect(prompt).toContain('"name":"Mara"');
    expect(prompt).not.toContain('"name":"Leo"');
  });

  it("keeps a scheduled excavation concealed in the opening image and in the video action order", () => {
    const plan = plan30();
    const segment = plan.segments[0];
    segment.goal = "A man digs until he uncovers his father's coffin.";
    segment.openingFrameDirection = "He stands over intact earth; the coffin remains buried and invisible.";
    segment.shots[0].action = "He plants the shovel in soil and begins to dig.";
    segment.shots[1].action = "Only after the soil is removed, an edge of the coffin emerges.";
    const imagePrompt = compileCinematicOpeningImagePrompt(plan, segment);
    expect(imagePrompt).toContain(segment.goal);
    expect(imagePrompt).toContain(segment.shots[1].action);
    expect(imagePrompt).toContain("still covering it");
    expect(imagePrompt).toContain("do not show a deep open pit with the object already exposed");
    const videoPrompt = compileCinematicVideoPrompt(plan, segment, "Español", "Latinoamericano");
    expect(videoPrompt).toContain("keep a concealed object hidden until its scheduled discovery");
    expect(videoPrompt).not.toContain("continue to the next logical action instead of discovering it again");
  });

  it("accepts only an MP4 from the exact bucket and prefix", () => {
    const outputPrefix = "isolated/video-libre/id/provider/";
    const result = { response: { generatedVideos: [{ video: { uri: `gs://right/${outputPrefix}file.mp4` } }] } };
    expect(verifiedVideoObject(result, "right", outputPrefix)).toBe(outputPrefix + "file.mp4");
    expect(() => verifiedVideoObject(result, "wrong", outputPrefix)).toThrow("destino esperado");
    expect(() => verifiedVideoObject({ response: { videos: [{ gcsUri: "gs://right/isolated/video-libre/id/provider-evil/file.mp4" }] } }, "right", outputPrefix)).toThrow();
    expect(() => verifiedVideoObject({ response: {} }, "right", outputPrefix)).toThrow();
  });

  it("will not publish an export after any approved input changes", () => {
    const project = { id: "p", revision: 7, planRevision: 2, activeFinalizeJobId: "j",
      approvedVideos: { "1": "a" } } as unknown as CinematicProject;
    const job = { id: "j", revision: 7, planRevision: 2,
      segments: [{ number: 1, assetId: "a", storageObject: "x", durationSeconds: 8 }] } as CinematicFinalizeJob;
    expect(currentManifest(project, job)).toBe(true);
    expect(currentManifest({ ...project, revision: 8 }, job)).toBe(false);
    expect(currentManifest({ ...project, approvedVideos: { "1": "b" } }, job)).toBe(false);
    expect(currentManifest({ ...project, activeFinalizeJobId: "other" }, job)).toBe(false);
  });

  it("allows assembly only with the newest completed video approved for its current image", () => {
    const project = {
      plan: { segments: [shotPlan(30).segments[0]] }, planRevision: 2,
      approvedImages: { "1": "image-new" }, approvedVideos: { "1": "old-video" },
    } as unknown as CinematicProject;
    const old = { id: "old-video", role: "segment-video", segmentNumber: 1, planRevision: 2,
      inputRefs: ["image-new"], state: "completed", storageObject: "old.mp4", createdAt: 1 } as CinematicAsset;
    const rejected = { ...old, id: "new-video", storageObject: undefined,
      state: "failed", createdAt: 2 } as CinematicAsset;
    expect(currentCinematicVideo(project, [old, rejected], 1)?.id).toBe("new-video");
    expect(cinematicMissingApprovedVideos(project, [old, rejected])).toEqual([1]);
    const replacement = { ...rejected, state: "completed", storageObject: "new.mp4" } as CinematicAsset;
    expect(cinematicMissingApprovedVideos(project, [old, replacement])).toEqual([1]);
    expect(cinematicMissingApprovedVideos({ ...project, approvedVideos: { "1": replacement.id } },
      [old, replacement])).toEqual([]);
    expect(cinematicMissingApprovedVideos({ ...project, approvedVideos: { "1": replacement.id } },
      [{ ...replacement, inputRefs: ["image-old"] }])).toEqual([1]);
  });
});
