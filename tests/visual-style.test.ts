import { expect, it } from "vitest";
import { snapshot } from "./fixtures";
import type { Job } from "../lib/types";
import { compileImagePrompt, compileVideoPrompt, narrativePrompt } from "../lib/director";
import { styles } from "../lib/director/catalog";
import { TELENOVELA_STYLE } from "../lib/director/styles";
import { visualTreatment } from "../lib/director/styles";
import { characterStyleReference, imageReferenceIds } from "../lib/continuity/rules";

it("carries the chosen treatment through all narrative stages and both media prompts", () => {
  const s = structuredClone(snapshot());
  s.project.universeSnapshot.visualStyle = TELENOVELA_STYLE;
  const before = JSON.stringify(s);
  for (const type of ["ideas", "story", "bible", "plan"]) {
    const prompt = narrativePrompt({ type, snapshot: s, instructions: "" } as Job);
    expect(prompt).toContain("TRATAMIENTO VISUAL: TELENOVELA 3D EXPRESIVA");
    expect(prompt).toContain("64 segundos");
    expect(prompt).toContain("cierre seleccionados");
  }
  for (const prompt of [compileImagePrompt(s, s.targets.find(t => t.role === "character")!, ""), compileVideoPrompt(s, s.plan!.clips[0], "")]) {
    expect(prompt).toContain("TRATAMIENTO VISUAL: TELENOVELA 3D EXPRESIVA");
    expect(prompt).toContain("no les añadas piel de fruta");
    expect(prompt).toContain("fichas aprobadas");
  }
  expect(JSON.stringify(s)).toBe(before);
});

it("keeps existing styles and does not apply the new treatment to them", () => {
  const s = structuredClone(snapshot());
  expect(styles).toContain(TELENOVELA_STYLE);
  for (const style of ["Cinemático 3D", "Anime", "Realista", "Ilustración animada"]) {
    expect(styles).toContain(style);
    s.project.universeSnapshot.visualStyle = style;
    for (const prompt of [
      narrativePrompt({ type: "ideas", snapshot: s, instructions: "" } as Job),
      compileImagePrompt(s, s.targets.find(t => t.role === "character")!, ""),
      compileVideoPrompt(s, s.plan!.clips[0], ""),
    ]) {
      expect(prompt).not.toContain("TRATAMIENTO VISUAL: TELENOVELA 3D EXPRESIVA");
      expect(prompt).toContain(style);
    }
  }
});

it("every selectable style has explicit shared direction in characters, locations, shots and video", () => {
  const s = structuredClone(snapshot());
  for (const style of styles) {
    s.project.universeSnapshot.visualStyle = style;
    const direction = visualTreatment(style);
    expect(direction.split("\n").slice(2).join("\n").length).toBeGreaterThan(100);
    for (const role of ["character", "location", "shot"]) {
      expect(compileImagePrompt(s, s.targets.find(t => t.role === role)!, "")).toContain(direction);
    }
    expect(compileVideoPrompt(s, s.plan!.clips[0], "")).toContain(direction);
    expect(narrativePrompt({ type: "bible", snapshot: s, instructions: "" } as Job)).toContain(direction);
  }
});

it("isolates canonical character content from storyboards and other characters", () => {
  const s = structuredClone(snapshot());
  s.project.universeSnapshot.visualStyle = "Cinemático 3D";
  s.bible!.characters[0].visualPrompt = "BAD_LEGACY_STORYBOARD four panels with everyone";
  s.bible!.relationships = "UNRELATED_STORY_ACTION";
  s.bible!.characters.push({ ...s.bible!.characters[0], id: "other", name: "OTHER_CHARACTER" });
  const prompt = compileImagePrompt(s, s.targets.find(t => t.role === "character")!, "");
  expect(prompt).toContain("exactly ONE character, ONE full-body view");
  expect(prompt).toContain("plain neutral studio background");
  expect(prompt).toContain("DIRECCIÓN VISUAL COMPARTIDA: CINEMÁTICO 3D");
  expect(prompt).not.toContain("BAD_LEGACY_STORYBOARD");
  expect(prompt).not.toContain("UNRELATED_STORY_ACTION");
  expect(prompt).not.toContain("OTHER_CHARACTER");
  expect(prompt).toContain('"name":"Alba"');
});

it("attaches an approved style anchor but never a pending or stale character", () => {
  const s = structuredClone(snapshot());
  const anchor = s.targets.find(t => t.role === "character")!;
  const asset = s.assets.find(a => a.id === anchor.approvedVersionId)!;
  const target = { ...anchor, id: "new-character", entityId: "new", approvedVersionId: undefined };
  expect(characterStyleReference(s, target)?.id).toBe(asset.id);
  expect(imageReferenceIds(s, target)).toEqual([asset.id]);
  anchor.approvedVersionId = undefined;
  expect(imageReferenceIds(s, target)).toEqual([]);
  anchor.approvedVersionId = asset.id;
  anchor.needsReview = true;
  expect(imageReferenceIds(s, target)).toEqual([]);
});
