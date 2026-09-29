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

it("exposes only the four intentional visual families", () => {
  const s = structuredClone(snapshot());
  expect(styles).toEqual(["3D Viral Estilizado", "Cinemático Épico", "Anime 2D", "Realista"]);
  for (const style of styles) {
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
    expect(direction).toContain("DISEÑO HUMANOIDE DEL REPARTO");
    expect(direction).toContain("DISEÑO DE MUJERES ADULTAS");
    expect(direction).toContain("si se eligen Humanos, todos son humanos");
    expect(direction).toContain("Los hombres adultos también tienen rostros armoniosos");
    expect(direction).toContain("no como una fruta entera con bracitos pegados");
    for (const role of ["character", "location", "shot"]) {
      const prompt = compileImagePrompt(s, s.targets.find(t => t.role === role)!, "");
      if (role === "character") {
        expect(prompt).toContain(style);
        expect(prompt).toContain("editorial portrait");
        expect(prompt).toContain("Render the exact wardrobe from the character specification");
      } else expect(prompt).toContain(direction);
    }
    expect(compileVideoPrompt(s, s.plan!.clips[0], "")).toContain(direction);
    expect(narrativePrompt({ type: "bible", snapshot: s, instructions: "" } as Job)).toContain(direction);
    const storyPrompt = narrativePrompt({ type: "story", snapshot: s, instructions: "" } as Job);
    expect(storyPrompt).toContain(`género ${s.project.genre}; subgénero ${s.project.subgenre}; trama ${s.project.plotType}`);
    expect(storyPrompt).toContain("nunca sustituye el género o la trama");
  }
});

it("describes humanoid telenovela characters rather than whole fruit mascots", () => {
  const direction = visualTreatment(TELENOVELA_STYLE);
  expect(direction).toContain("protagonistas humanoides hermosos");
  expect(direction).toContain("DISEÑO DE MUJERES ADULTAS");
  expect(direction).toContain("curvas naturales y proporcionadas");
  expect(direction).not.toContain("reloj de arena");
  expect(direction).toContain("sin piezas separadas, ranuras circulares");
  expect(direction).toContain("torso y extremidades proporcionados");
  expect(direction).not.toContain("no las conviertas en humanos disfrazados");
  expect(direction).not.toContain("conserva la silueta, piel, hojas");
});

it("isolates canonical character content from storyboards and other characters", () => {
  const s = structuredClone(snapshot());
  s.project.universeSnapshot.visualStyle = "Cinemático Épico";
  s.bible!.characters[0].visualPrompt = "BAD_LEGACY_STORYBOARD four panels with everyone";
  s.bible!.relationships = "UNRELATED_STORY_ACTION";
  s.bible!.characters.push({ ...s.bible!.characters[0], id: "other", name: "OTHER_CHARACTER" });
  const prompt = compileImagePrompt(s, s.targets.find(t => t.role === "character")!, "");
  expect(prompt).toContain("exactly ONE full-body woman");
  expect(prompt).toContain("softly blurred contemporary everyday interior");
  expect(prompt).toContain("DIRECCIÓN VISUAL COMPARTIDA: CINEMÁTICO ÉPICO");
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

it("applies conflict-first short-form narration to every visual mode and narrative stage", () => {
  const s = structuredClone(snapshot());
  for (const style of styles) {
    s.project.universeSnapshot.visualStyle = style;
    for (const type of ["ideas", "story", "bible", "plan"]) {
      const prompt = narrativePrompt({ type, snapshot: s, instructions: "" } as Job);
      expect(prompt).toContain("Abre dentro de un conflicto concreto");
      expect(prompt).toContain("diálogo corto de acción y respuesta");
      expect(prompt).toContain("64 segundos");
      expect(prompt).toContain("ocho clips de ocho segundos");
      expect(prompt).toContain(`ESTILO ÚNICO DEL UNIVERSO: ${style}`);
      expect(prompt).toContain("no impongas romance, violencia ni humor si no corresponden");
    }
  }
});

it("preserves a woman's explicit identity in every character render, regardless of clothing", () => {
  const s = structuredClone(snapshot());
  const woman = s.bible!.characters[0];
  woman.name = "Frambuesa";
  woman.gender = "mujer";
  woman.age = "adulta";
  woman.role = "Esposa y empresaria";
  woman.wardrobe = "Traje negro y corbata";
  for (const style of styles) {
    s.project.universeSnapshot.visualStyle = style;
    const prompt = compileImagePrompt(s, s.targets.find(t => t.role === "character")!, "");
    expect(prompt).toContain('"gender":"mujer"');
    expect(prompt).toContain('"age":"adulta"');
    expect(prompt).toContain('"role":"Esposa y empresaria"');
    expect(prompt).toContain("No deduzcas género de la fruta");
    expect(prompt).toContain("Traje negro y corbata");
    expect(prompt).toContain("fully humanoid head and face");
  }
});

it("retains legacy identity clues without copying an old storyboard or another character's story", () => {
  const s = structuredClone(snapshot());
  const person = s.bible!.characters[0];
  delete person.gender; delete person.age;
  person.name = "Frambuesa";
  person.role = "Esposa";
  person.relationships = "Hermana de Cereza";
  s.project.story!.data = { premise: "Frambuesa es una mujer adulta que dirige la tienda. Otro personaje huye por el techo.", conflict: "Conflicto", arc: "Arco", ending: "Final" };
  person.visualPrompt = "LEGACY_COLLAGE four story panels";
  const prompt = compileImagePrompt(s, s.targets.find(t => t.role === "character")!, "");
  expect(prompt).toContain("Frambuesa es una mujer adulta");
  expect(prompt).toContain("Hermana de Cereza");
  expect(prompt).not.toContain("Otro personaje huye");
  expect(prompt).not.toContain("LEGACY_COLLAGE");
});
