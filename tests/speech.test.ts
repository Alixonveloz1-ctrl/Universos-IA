// SIMULATED source data and text provider. No paid model calls.
import { beforeEach, expect, it, vi } from "vitest";
import { snapshot } from "./fixtures";
import type { Job } from "../lib/types";
import { dialogueProblems, dialogueWarnings, speakerDescription, speechDirection, withoutDialogue } from "../lib/director/speech";
vi.mock("../lib/providers/vertex", () => ({ textGenerate: vi.fn() }));
import { textGenerate } from "../lib/providers/vertex";
import { compileVideoPrompt, directPrompt, narrativePrompt } from "../lib/director";

beforeEach(() => vi.mocked(textGenerate).mockReset());
function scene() {
  const s = structuredClone(snapshot());
  s.project.accent = "Venezolano";
  s.bible!.characters[0] = { ...s.bible!.characters[0], name: "Ana", hair: "Rubio", wardrobe: "Vestido azul", voice: { ...s.bible!.characters[0].voice, accent: "Español de España", timbre: "Femenino cálido" } };
  s.bible!.characters.push({ ...s.bible!.characters[0], id: "luis", name: "Luis", gender: "hombre", hair: "Negro", wardrobe: "Camisa blanca", voice: { ...s.bible!.characters[0].voice, timbre: "Masculino grave" } });
  const c = s.plan!.clips[0];
  c.characterIds = ["a", "luis"];
  c.shots[0].characterIds = [...c.characterIds];
  c.dialogue = [
    { characterId: "a", text: "¿Por qué me mentiste?", intention: "Pregunta dolida", start: 0.5, end: 3.3 },
    { characterId: "luis", text: "No quería perderte, Ana.", intention: "Arrepentido", start: 3.6, end: 7.3 },
  ];
  c.shots[0].dialogue = c.dialogue[0].text;
  c.shots[0].action = `Ana pregunta: ${c.dialogue[0].text} Luis reacciona.`;
  return { s, c, target: s.targets.find(t => t.role === "clip" && t.clipNumber === 1)! };
}
it("includes each spoken line once even in a turn spanning two visual intervals", () => {
  const { s, c } = scene();
  const prompt = compileVideoPrompt(s, c, c.dialogue[0].text);
  for (const d of c.dialogue) expect(prompt.split(d.text)).toHaveLength(2);
  for (const n of [0, 2, 4, 6]) expect(prompt).toContain(`${n}-${n + 2}s:`);
  expect(prompt).toContain("ONE CONTINUOUS TAKE");
});
it("binds each line to its own visible identity and vocal profile", () => {
  const { s, c } = scene();
  const prompt = speechDirection(s, c);
  expect(prompt).toContain("Ana [speaker_a] (mujer");
  expect(prompt).toContain("Luis [speaker_luis] (hombre");
  expect(prompt).toContain("Femenino cálido");
  expect(prompt).toContain("Masculino grave");
  expect(prompt).toContain("Luis [speaker_luis] listen silently");
  expect(prompt).toContain("Ana [speaker_a] listen silently");
  expect(prompt).toContain("ONLY mouth articulating speech");
});
it("requires native on-camera Spanish with natural prosody, pauses and no narrator", () => {
  const { s, c } = scene();
  const prompt = speechDirection(s, c);
  for (const text of ["diegetic speech", "Spanish phonemes", "No narrator", "idiomatic Spanish word stress", "natural question/exclamation", "3.3-3.6s: no speech", "7.3-8s: no speech", "do not restart it at visual timing boundaries"])
    expect(prompt).toContain(text);
});
it("honors the selected accent rather than an inconsistent old voice card", () => {
  const { s, c } = scene();
  const prompt = speechDirection(s, c);
  expect(prompt).toContain("Accent: Venezolano");
  expect(prompt).not.toContain("Español de España");
});
it("keeps stable speaker labels independent of cast order and never invents screen placement", () => {
  const { s, c } = scene();
  const identity = speakerDescription(s, "a");
  s.bible!.characters.reverse();
  expect(speakerDescription(s, "a")).toBe(identity);
  expect(compileVideoPrompt(s, c, "")).not.toContain("Establish Ana screen LEFT");
});
it("preserves source text and data, including accents and punctuation", () => {
  const { s, c } = scene();
  const original = JSON.stringify(s);
  compileVideoPrompt(s, c, "");
  expect(JSON.stringify(s)).toBe(original);
});
it("preserves visual constraints without repeating speech or dumping the whole story", () => {
  const { s, c } = scene();
  c.constraints = ["Mantener el anillo en la mano derecha"];
  s.project.story!.data = { premise: "OTHER STORY CONTENT" };
  const prompt = compileVideoPrompt(s, c, "");
  expect(prompt).toContain(c.constraints[0]);
  expect(prompt).not.toContain("OTHER STORY CONTENT");
});
it("keeps silent clips silent", () => {
  const { s, c } = scene();
  c.dialogue = [];
  const prompt = speechDirection(s, c);
  expect(prompt).toContain("0-8s: no speech");
  expect(prompt).not.toContain("says in");
});
it("flags overlapping speech and unknown speakers before a paid submission", () => {
  const { s, c } = scene();
  c.dialogue[1].start = 2;
  expect(dialogueProblems(s, c).join(" ")).toContain("superpuestos");
  c.dialogue[1].characterId = "unknown";
  expect(dialogueProblems(s, c).join(" ")).toContain("personaje presente");
});
it("reports dense dialogue as a writing estimate without changing words", () => {
  const { c } = scene();
  c.dialogue[0].end = 0.6;
  const text = c.dialogue[0].text;
  expect(dialogueWarnings(c).join(" ")).toContain("puede faltar tiempo");
  expect(c.dialogue[0].text).toBe(text);
});
it("removes duplicate literal speech safely with punctuation and variable whitespace", () => {
  const { c } = scene();
  c.dialogue[0].text = "¿Sí (de verdad)?";
  expect(withoutDialogue("Dice: ¿Sí (de  verdad)?", c)).toBe("Dice: [dialogue in the speech schedule]");
  c.dialogue[0].text = "No";
  expect(withoutDialogue("Nora dice No", c)).toBe("Nora dice [dialogue in the speech schedule]");
});
it("checkpoints the exact video prompt without calling Gemini and reuses it on resume", async () => {
  const { s, c, target } = scene();
  const j = { type: "video", snapshot: s, checkpoint: {}, instructions: "" } as Job;
  const before = vi.fn(), save = vi.fn(async (key: string, value: unknown) => { j.checkpoint = { ...j.checkpoint, [key]: value }; });
  const prompt = compileVideoPrompt(s, c, "");
  expect(await directPrompt(j, target, prompt, before, save)).toBe(prompt);
  expect(await directPrompt(j, target, "changed", before, save)).toBe(prompt);
  expect(save).toHaveBeenCalledTimes(1);
  expect(j.checkpoint[`prompt_${target.id}`]).toMatchObject({ prompt, compilerVersion: 1 });
  expect(before).not.toHaveBeenCalled();
  expect(textGenerate).not.toHaveBeenCalled();
});
it("replaces an old unsubmitted rewrite but never resubmits or edits accepted legacy work", async () => {
  const { s, c, target } = scene();
  const j = { type: "video", snapshot: s, checkpoint: { [`prompt_${target.id}`]: { prompt: "Legacy compiled direction for this clip." } }, instructions: "" } as Job;
  const before = vi.fn(), save = vi.fn();
  const prompt = compileVideoPrompt(s, c, "");
  expect(await directPrompt(j, target, prompt, before, save)).toBe(prompt);
  j.checkpoint.operation = "already-submitted";
  save.mockClear();
  const existing = await directPrompt(j, target, prompt, before, save);
  expect(existing).toContain("Legacy compiled direction for this clip.");
  expect(save).not.toHaveBeenCalled();
  expect(before).not.toHaveBeenCalled();
  expect(textGenerate).not.toHaveBeenCalled();
});
it("does not clear pending-call recovery checkpoints", async () => {
  const { s, c, target } = scene();
  const j = { type: "video", snapshot: s, checkpoint: {}, instructions: "" } as Job;
  j.checkpoint.pendingCall = "asset_clip_1";
  const before = vi.fn(), save = vi.fn();
  await directPrompt(j, target, compileVideoPrompt(s, c, ""), before, save);
  expect(j.checkpoint.pendingCall).toBe("asset_clip_1");
  expect(save).not.toHaveBeenCalled();
  expect(before).not.toHaveBeenCalled();
  expect(textGenerate).not.toHaveBeenCalled();
});
it("stops ambiguous turn-taking before any new paid call", async () => {
  const { s, c, target } = scene();
  c.dialogue[1].start = 2;
  const j = { type: "video", snapshot: s, checkpoint: {}, instructions: "" } as Job;
  const before = vi.fn(), save = vi.fn();
  await expect(directPrompt(j, target, compileVideoPrompt(s, c, ""), before, save)).rejects.toMatchObject({ code: "DIALOGUE_TIMING" });
  expect(before).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  expect(textGenerate).not.toHaveBeenCalled();
});
it("adds natural dialogue direction to new plans without mutating the job", () => {
  const { s } = scene();
  const j = { type: "plan", snapshot: s, instructions: "User instruction", checkpoint: {} } as Job;
  expect(narrativePrompt(j)).toContain("oraciones completas y idiomáticas");
  expect(narrativePrompt(j)).toContain("shots[].dialogue queda vacío");
  expect(j.instructions).toBe("User instruction");
});
