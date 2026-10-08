// SIMULATED text provider only. No calls consuming Google credits.
import { beforeEach, expect, it, vi } from "vitest";
import { snapshot } from "./fixtures";
import type { Job } from "../lib/types";
vi.mock("../lib/providers/vertex", () => ({ textGenerate: vi.fn() }));
import { textGenerate } from "../lib/providers/vertex";
import { runDirector, directPrompt, compileVideoPrompt } from "../lib/director";
import { renderHair } from "../lib/director/hair";
import { speciesCrownDirection } from "../lib/director/character-design";
import { assertNoPendingCall } from "../worker/recovery";
const generate = vi.mocked(textGenerate);
beforeEach(() => generate.mockReset());
function execution() {
  const j = {
    type: "story",
    snapshot: structuredClone(snapshot()),
    instructions: "",
    checkpoint: {},
  } as Job;
  const before = async (key: string) => {
    assertNoPendingCall(j.checkpoint.pendingCall);
    j.checkpoint.pendingCall = key;
  };
  const checkpoint = async (key: string, value: unknown) => {
    j.checkpoint[key] = value;
    j.checkpoint.pendingCall = null;
  };
  return { j, before, checkpoint };
}
function normalizedBible(j: Job) {
  return { ...j.snapshot.bible!, characters: j.snapshot.bible!.characters.map(c => ({ ...c, hair: renderHair(j.projectId, c) })) };
}
it("repairs invalid story JSON once and presents the valid draft without a subjective veto", async () => {
  const { j, before, checkpoint } = execution();
  generate
    .mockResolvedValueOnce({ invalidJsonText: "{" })
    .mockResolvedValueOnce(j.snapshot.project.story!.data);
  expect(await runDirector(j, before, checkpoint)).toEqual(j.snapshot.project.story!.data);
  expect(generate).toHaveBeenCalledTimes(2);
  expect(j.checkpoint.director_1).toBeDefined();
});
it("presents a valid bible to the owner without a second paid model review", async () => {
  const { j, before, checkpoint } = execution();
  j.type = "bible";
  generate.mockResolvedValueOnce(j.snapshot.bible)
    .mockResolvedValueOnce(j.snapshot.bible!.characters[0])
    .mockResolvedValueOnce(j.snapshot.bible!.locations[0]);
  expect(await runDirector(j, before, checkpoint)).toEqual(normalizedBible(j));
  expect(generate).toHaveBeenCalledTimes(3);
  expect(generate.mock.calls[0][2]).toBeDefined();
});

it("builds species-head cards without a compulsory human hairstyle or another model review", async () => {
  const { j, before, checkpoint } = execution();
  j.type = "bible";
  j.snapshot.project.universeSnapshot.beings = "Frutas";
  j.snapshot.project.characterDesign = "Cabeza de especie/material";
  generate.mockResolvedValueOnce(j.snapshot.bible)
    .mockResolvedValueOnce({ ...j.snapshot.bible!.characters[0], material: "Fresa", hair: "No aplica" })
    .mockResolvedValueOnce(j.snapshot.bible!.locations[0]);
  const result = await runDirector(j, before, checkpoint);
  expect(result).toMatchObject({ characters: [{ hair: speciesCrownDirection }] });
  expect(generate).toHaveBeenCalledTimes(3);
  for (const [, prompt] of generate.mock.calls) {
    expect(prompt).toContain("cabeza ENTERA");
    expect(prompt).not.toContain("CABELLO: diseña cabello humanoide");
    expect(prompt).not.toContain("nunca en hair de un humanoide");
  }
});
it("resuming a failed Bible retries only its invalid ficha and retains completed parts", async () => {
  const { j, before, checkpoint } = execution();
  j.type = "bible";
  generate.mockResolvedValueOnce(j.snapshot.bible).mockResolvedValueOnce({}).mockResolvedValueOnce({});
  await expect(runDirector(j, before, checkpoint)).rejects.toMatchObject({ code: "DIRECTOR_JSON" });
  j.checkpoint.narrativeRetry = 1;
  generate.mockResolvedValueOnce(j.snapshot.bible!.characters[0]).mockResolvedValueOnce(j.snapshot.bible!.locations[0]);
  expect(await runDirector(j, before, checkpoint)).toEqual(normalizedBible(j));
  expect(generate).toHaveBeenCalledTimes(5);
  expect(generate.mock.calls[3][1]).toContain("Corrige ESTE resultado");
});
it("replays persisted narrative and review after restart without calling the model", async () => {
  const { j, before, checkpoint } = execution();
  j.checkpoint.director_0 = j.snapshot.project.story!.data;
  j.checkpoint.review_0 = { errors: [], suggestions: [] };
  expect(await runDirector(j, before, checkpoint)).toEqual(
    j.snapshot.project.story!.data,
  );
  expect(generate).not.toHaveBeenCalled();
});
it("uses a valid saved story draft after an earlier subjective rejection without another paid call", async () => {
  const { j, before, checkpoint } = execution();
  j.checkpoint.director_1 = j.snapshot.project.story!.data;
  j.checkpoint.review_1 = { errors: ["Objeción subjetiva"], suggestions: [] };
  expect(await runDirector(j, before, checkpoint)).toEqual(j.snapshot.project.story!.data);
  expect(generate).not.toHaveBeenCalled();
});
it("prompt compilation is checkpointed and does not modify approved source material", async () => {
  const { j, before, checkpoint } = execution();
  j.type = "video";
  const c = j.snapshot.plan!.clips[0], opening = c.shots[0];
  c.shots = ["Alba levanta el anillo.", "Alba gira la muñeca hacia la luz.", "Alba inclina el anillo hacia su interlocutor.", "Alba comienza a extender la mano abierta."].map((action, i) => ({ ...opening, id: i ? `${opening.id}_${i}` : opening.id, start: i * 2, end: (i + 1) * 2, action, dialogue: "" }));
  const original = JSON.stringify(j.snapshot);
  const target = j.snapshot.targets.find(t => t.role === "clip")!;
  const first = await directPrompt(
    j,
    target,
    "approved context",
    before,
    checkpoint,
  );
  expect(
    await directPrompt(j, target, "approved context", before, checkpoint),
  ).toBe(first);
  expect(generate).not.toHaveBeenCalled();
  expect(first).toBe(compileVideoPrompt(j.snapshot, c, ""));
  expect(JSON.stringify(j.snapshot)).toBe(original);
});

it("asks for a timed video performance before a Veo clip is submitted", async () => {
  const { j, before, checkpoint } = execution();
  j.type = "video";
  const target = j.snapshot.targets.find(t => t.role === "clip")!;
  const original = JSON.stringify(j.snapshot);
  generate.mockResolvedValueOnce({ beats: ["Alba comienza a levantar el anillo.", "Alba gira la muñeca hacia la luz.", "Alba acerca el anillo a sus ojos.", "Alba afloja los dedos y ofrece el anillo hacia su interlocutor."] });
  const { compileVideoPrompt } = await import("../lib/director");
  const prompt = await directPrompt(j, target, compileVideoPrompt(j.snapshot, j.snapshot.plan!.clips[0], ""), before, checkpoint);
  expect(generate).toHaveBeenCalledOnce();
  expect(prompt).toContain("6-8s:");
  expect(prompt).toContain("6-8s: Alba afloja los dedos");
  expect(JSON.stringify(j.snapshot)).toBe(original);
  expect(prompt).toContain("no speech");
  expect(prompt).toContain("ONLY audible speaker");
});

it("recovers a malformed motion result by repairing its format once and preserves that repair on resume", async () => {
  const { j, before, checkpoint } = execution();
  j.type = "video";
  const target = j.snapshot.targets.find(t => t.role === "clip")!;
  generate.mockResolvedValueOnce({ beats: ["Alba levanta el anillo."] }).mockResolvedValueOnce({ beats: ["Alba levanta el anillo.", "Alba gira la muñeca hacia la luz.", "Alba inclina el anillo hacia su interlocutor.", "Alba comienza a extender la mano abierta."] });
  const prompt = await directPrompt(j, target, "legacy context", before, checkpoint);
  expect(prompt).toContain("6-8s: Alba comienza a extender la mano abierta.");
  expect(generate).toHaveBeenCalledTimes(2);
  expect(await directPrompt(j, target, "changed context", before, checkpoint)).toBe(prompt);
  expect(generate).toHaveBeenCalledTimes(2);
  expect(j.checkpoint.pendingCall).toBeNull();
});

it("generates three universe drafts from dropdown preferences in the ideas call", async () => {
  const { j, before, checkpoint } = execution();
  j.type = "ideas";
  j.snapshot.project.automaticUniverse = true;
  const { revision: _revision, ...universe } = j.snapshot.project.universeSnapshot;
  void _revision;
  const result = { ideas: [1, 2, 3].map(n => ({ id: `i${n}`, title: `Historia ${n}`, synopsis: `Propuesta ${n}`, universe })) };
  generate.mockResolvedValueOnce(result);
  expect(await runDirector(j, before, checkpoint)).toEqual(result);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(generate.mock.calls[0][1]).toContain("solo se guardará como universo");
  expect(JSON.stringify(generate.mock.calls[0][2])).toContain('"universe"');
});
it("passes the optional concept to all three proposals and the chosen story", async () => {
  const { j } = execution();
  j.type = "ideas";
  j.snapshot.project.concept = "Una lavandería de barrio";
  const { narrativePrompt } = await import("../lib/director");
  expect(narrativePrompt(j)).toContain("las TRES propuestas deben basarse");
  expect(narrativePrompt(j)).toContain("Una lavandería de barrio");
  j.type = "story";
  expect(narrativePrompt(j)).toContain("Conserva el concepto al desarrollar la historia elegida");
  j.snapshot.project.concept = "";
  expect(narrativePrompt(j)).not.toContain("CONCEPTO ELEGIDO POR EL USUARIO");
});
it("recovers all three ideas from a failed subjective review without paying for another generation", async () => {
  const { j, before, checkpoint } = execution();
  j.type = "ideas";
  j.snapshot.project.automaticUniverse = true;
  const { revision: _revision, ...universe } = j.snapshot.project.universeSnapshot;
  void _revision;
  const older = { ideas: [1, 2, 3].map(n => ({ id: `i${n}`, title: `Idea ${n}`, synopsis: `Sinopsis ${n}`, universe })) };
  const repaired = { ideas: older.ideas.map(i => ({ ...i, synopsis: `Reparada: ${i.synopsis}` })) };
  j.checkpoint.director_0 = older;
  j.checkpoint.director_1 = repaired;
  j.checkpoint.review_1 = { errors: ["No describe la voz de un personaje"], suggestions: [] };
  expect(await runDirector(j, before, checkpoint)).toEqual(repaired);
  expect(generate).not.toHaveBeenCalled();
});

it("locks character gender and age to the Bible roster and repairs a mismatched card", async () => {
  const { j, before, checkpoint } = execution(); j.type = "bible";
  const expected = j.snapshot.bible!;
  generate.mockResolvedValueOnce(expected)
    .mockResolvedValueOnce({ ...expected.characters[0], gender: "hombre" })
    .mockResolvedValueOnce(expected.characters[0])
    .mockResolvedValueOnce(expected.locations[0]);
  expect(await runDirector(j, before, checkpoint)).toEqual(normalizedBible(j));
  expect(generate).toHaveBeenCalledTimes(4);
  expect(generate.mock.calls[1][2]).toMatchObject({ properties: { gender: { const: "mujer" }, age: { const: "adulta" } } });
});

it("recovers the newest valid plan despite saved review rejections without a paid call", async () => {
  const { j, before, checkpoint } = execution();
  j.type = "plan";
  const draft = structuredClone(j.snapshot.plan!);
  draft.clips[0].goal = "Newest saved draft";
  j.checkpoint.director_0 = j.snapshot.plan;
  j.checkpoint.director_1 = draft;
  j.checkpoint.review_plan_v2_1 = { errors: ["Old rejection"], suggestions: [] };
  expect(await runDirector(j, before, checkpoint)).toEqual(draft);
  expect(generate).not.toHaveBeenCalled();
});
it("generates a valid plan in one call with continuity and native audio instructions", async () => {
  const { j, before, checkpoint } = execution();
  j.type = "plan";
  generate.mockResolvedValueOnce(j.snapshot.plan);
  expect(await runDirector(j, before, checkpoint)).toEqual(j.snapshot.plan);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(generate.mock.calls[0][1]).toContain("CONTINUIDAD DEL GUION");
  expect(generate.mock.calls[0][1]).toContain("audio nativo de Veo");
});
it("still rejects malformed plans without running a model review", async () => {
  const { j, before, checkpoint } = execution();
  j.type = "plan";
  generate.mockResolvedValue({ clips: [] });
  await expect(runDirector(j, before, checkpoint)).rejects.toMatchObject({ code: "DIRECTOR_JSON" });
  expect(generate).toHaveBeenCalledTimes(2);
  expect(Object.keys(j.checkpoint).some(key => key.startsWith("review_"))).toBe(false);
});
