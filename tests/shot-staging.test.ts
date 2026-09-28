import { expect, it } from "vitest";
import { snapshot } from "./fixtures";
import { imageReferenceIds, prerequisites } from "../lib/continuity/rules";
import { compileImagePrompt, compileVideoPrompt, narrativePrompt } from "../lib/director";
import type { Job, Target } from "../lib/types";

it("anchors an accusation and reaction to two characters in one room", () => {
  const s = structuredClone(snapshot());
  s.bible!.characters[0].name = "Acusador";
  s.bible!.characters.push({ ...s.bible!.characters[0], id: "mateo", name: "Mateo" });
  const clip = s.plan!.clips[0];
  clip.characterIds = ["a", "mateo"];
  clip.shots[0].action = "Acusador señala a Mateo y lo acusa";
  clip.shots[0].characterIds = ["a"];
  clip.shots.push({ ...clip.shots[0], id: "s0reaction", action: "Mateo reacciona", characterIds: ["mateo"] });
  const target = s.targets.find(t => t.role === "shot" && t.clipNumber === 1)!;
  s.targets.push({ ...s.targets.find(t => t.role === "character")!, id: "character_mateo", entityId: "mateo", approvedVersionId: "canonical_mateo" });
  const refs = imageReferenceIds(s, target);
  expect(refs).toContain("canonical_a");
  expect(refs).toContain("canonical_mateo");
  expect(refs).toContain("canonical_hall");
  const opening = compileImagePrompt(s, target, "");
  expect(opening).toContain("show ALL 2 named characters (Acusador, Mateo)");
  expect(opening).toContain("character: Mateo");
  const reactionTarget: Target = { ...target, id: "shot_s0reaction", entityId: "s0reaction" };
  const reaction = compileImagePrompt(s, reactionTarget, "");
  expect(reaction).toContain("Mateo looks toward the relevant interlocutor");
  expect(reaction).toContain("no direct eye contact with the viewer");
  expect(compileVideoPrompt(s, clip, "")).toContain("listener looks toward the speaker off-camera");
  expect(narrativePrompt({type:"plan",snapshot:s,instructions:""} as Job)).toContain("destinatario debe ser visible");
});

it("anchors all three clip characters in the one initial image even if the opening shot lists only two", () => {
  const s = structuredClone(snapshot());
  const clip = s.plan!.clips[0];
  clip.characterIds = ["a", "b", "c"];
  clip.shots[0].characterIds = ["a", "b"];
  for (const id of ["b", "c"]) {
    s.bible!.characters.push({ ...s.bible!.characters[0], id, name: id.toUpperCase() });
    s.targets.push({ ...s.targets.find(t => t.role === "character")!, id: "character_" + id, entityId: id, approvedVersionId: "canonical_" + id });
    s.assets.push({ ...s.assets.find(a => a.id === "canonical_a")!, id: "canonical_" + id, targetId: "character_" + id });
  }
  const target = s.targets.find(t => t.role === "shot" && t.clipNumber === 1)!;
  const refs = imageReferenceIds(s, target);
  expect(refs).toEqual(["canonical_a", "canonical_b", "canonical_c"]);
  const prompt = compileImagePrompt(s, target, "");
  expect(prompt).toContain("show ALL 3 named characters (Alba, B, C)");
  expect(prompt).toContain("image 3 = character: C");
  expect(prompt).toContain("location specification supplies the room");
  expect(compileVideoPrompt(s, clip, "")).toContain("All 3 participating characters (Alba, B, C)");
  expect(narrativePrompt({ type: "plan", snapshot: s, instructions: "" } as Job)).toContain("TODOS los personajes");
  const initial = s.assets.find(a => a.id === target.approvedVersionId)!;
  initial.inputRefs = ["canonical_a", "canonical_b"];
  const video = { type: "video" as const, expectedRevision: s.project.revision, targetId: "clip_1", requestId: "cast-check", instructions: "" };
  expect(() => prerequisites(s, video)).toThrow("Regenera y aprueba esa imagen");
  initial.inputRefs.push("canonical_c");
  expect(() => prerequisites(s, video)).not.toThrow();
});
