// SIMULATED text provider only. No calls consuming Google credits.
import { beforeEach, expect, it, vi } from "vitest";
import { snapshot } from "./fixtures";
import type { Job } from "../lib/types";
vi.mock("../lib/providers/vertex", () => ({ textGenerate: vi.fn() }));
import { textGenerate } from "../lib/providers/vertex";
import { runDirector, directPrompt } from "../lib/director";
import { assertNoPendingCall } from "../worker/recovery";
const generate = vi.mocked(textGenerate);
beforeEach(() => generate.mockReset());
function execution() {
  const j = {
    type: "story",
    snapshot: snapshot(),
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
  expect(await runDirector(j, before, checkpoint)).toEqual(j.snapshot.bible);
  expect(generate).toHaveBeenCalledTimes(3);
  expect(generate.mock.calls[0][2]).toBeDefined();
});
it("resuming a failed Bible retries only its invalid ficha and retains completed parts", async () => {
  const { j, before, checkpoint } = execution();
  j.type = "bible";
  generate.mockResolvedValueOnce(j.snapshot.bible).mockResolvedValueOnce({}).mockResolvedValueOnce({});
  await expect(runDirector(j, before, checkpoint)).rejects.toMatchObject({ code: "DIRECTOR_JSON" });
  j.checkpoint.narrativeRetry = 1;
  generate.mockResolvedValueOnce(j.snapshot.bible!.characters[0]).mockResolvedValueOnce(j.snapshot.bible!.locations[0]);
  expect(await runDirector(j, before, checkpoint)).toEqual(j.snapshot.bible);
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
  const original = JSON.stringify(j.snapshot);
  generate.mockResolvedValueOnce({
    prompt: "Preserve the approved identity and literal dialogue.",
  });
  const target = j.snapshot.targets[0];
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
  expect(generate).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(j.snapshot)).toBe(original);
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
  expect(await runDirector(j, before, checkpoint)).toEqual(expected);
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
