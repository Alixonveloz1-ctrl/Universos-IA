import { expect, it } from "vitest";
import { hairDirection, renderHair } from "../lib/director/hair";
import { compileImagePrompt, compileVideoPrompt } from "../lib/director";
import { snapshot } from "./fixtures";
import { speciesCrownDirection } from "../lib/director/character-design";

it("gives an old bald gemstone card stable hair in portraits and video", () => {
  const s = snapshot();
  const character = s.bible!.characters[0];
  character.hair = "No tiene";
  const expectedHair = hairDirection(s.project.id, character.id);
  const portrait = compileImagePrompt(s, s.targets.find(t => t.role === "character")!, "");
  const video = compileVideoPrompt(s, s.plan!.clips[0], "");
  expect(portrait).toContain(`"hair":"${expectedHair}"`);
  expect(video).toContain(`"hair":"${expectedHair}"`);
  expect(portrait).not.toContain('"hair":"No tiene"');
  expect(video).not.toContain('"hair":"No tiene"');
  expect(character.hair).toBe("No tiene");
});

it("preserves a defined hairstyle and varies defaults between characters", () => {
  expect(renderHair("project", { id: "camila", hair: "rizos color lavanda" })).toBe("rizos color lavanda");
  const first = hairDirection("project", "camila");
  expect(hairDirection("project", "valeria", [first])).not.toBe(first);
});

it("keeps natural species crowns in head-mode portraits and video without inventing human hair", () => {
  const s = structuredClone(snapshot());
  s.project.universeSnapshot.beings = "Frutas";
  s.project.characterDesign = "Cabeza de especie/material";
  const character = s.bible!.characters[0];
  character.material = "Fresa";
  character.hair = "No aplica";
  const before = JSON.stringify(s);
  for (const prompt of [
    compileImagePrompt(s, s.targets.find(t => t.role === "character")!, ""),
    compileVideoPrompt(s, s.plan!.clips[0], ""),
  ]) {
    expect(prompt).toContain(JSON.stringify(speciesCrownDirection));
    expect(prompt).not.toContain(hairDirection(s.project.id, character.id));
    expect(prompt).not.toContain("attached editorial portrait");
    expect(prompt).toContain("SPECIES/MATERIAL HEAD");
  }
  expect(JSON.stringify(s)).toBe(before);
});
