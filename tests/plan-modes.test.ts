// All providers are mocked. These tests never request paid generations.
import { beforeEach, expect, it, vi } from "vitest";
import { snapshot, observed, b } from "./fixtures";
import type { Job } from "../lib/types";
import { genres, styles } from "../lib/director/catalog";
vi.mock("../lib/providers/vertex", () => ({ textGenerate: vi.fn() }));
import { textGenerate } from "../lib/providers/vertex";
import { runDirector } from "../lib/director";
import { prepareGeneratedPlan, validateGeneratedPlan } from "../lib/director/plan-runner";
const generate = vi.mocked(textGenerate);
beforeEach(() => { generate.mockReset(); vi.restoreAllMocks(); });
function execution(style = "Anime", genre = "Drama") {
  const s = structuredClone(snapshot());
  s.project.universeSnapshot.visualStyle = style;
  s.project.genre = genre;
  s.project.subgenre = genres[genre][0];
  const j: Job = { id: "a".repeat(64), projectId: s.project.id, type: "plan", instructions: "", requestId: "simulated", snapshot: s, createdAt: 1, heartbeat: 1, state: "queued", leaseOwner: null, leaseUntil: 0, attempts: 0, stopRequested: false, checkpoint: {} };
  const before = vi.fn(async (key: string) => { if (j.checkpoint.pendingCall) throw new Error("pending call"); j.checkpoint.pendingCall = key; });
  const save = vi.fn(async (key: string, value: unknown) => { j.checkpoint = { ...j.checkpoint, [key]: structuredClone(value), pendingCall: null }; });
  return { j, s, before, save };
}
for (const style of styles) for (const genre of Object.keys(genres)) {
  it(`fresh plan uses the shared pipeline: ${style} / ${genre}`, async () => {
    const { j, s, before, save } = execution(style, genre);
    const source = structuredClone(s.plan!);
    source.clips[0].plannedEndState.characters[0].emotion = "Nueva reacción";
    const original = JSON.stringify(source);
    generate.mockResolvedValueOnce(source);
    const result = await runDirector(j, before, save) as typeof source;
    expect(result.clips).toHaveLength(8);
    expect(result.clips[1].continuityIn).toEqual(result.clips[0].plannedEndState);
    expect(result.clips[1].continuityIn.characters[0].emotion).toBe("Nueva reacción");
    expect(JSON.stringify(source)).toBe(original);
    expect(j.checkpoint.director_0).toEqual(source);
    expect(generate).toHaveBeenCalledOnce();
    expect(generate.mock.calls[0][0]).toBe(j.snapshot.project.models.text);
    expect(generate.mock.calls[0][1]).toContain(style);
    expect(generate.mock.calls[0][1]).toContain(genre);
  });
}
for (const style of styles) {
  it(`saved draft is normalized without a new call: ${style}`, async () => {
    const { j, s, before, save } = execution(style);
    const source = structuredClone(s.plan!);
    source.clips[0].plannedEndState.characters[0].knowledge = "Nueva información";
    j.checkpoint.director_3 = source;
    j.checkpoint.narrativeRetry = 2;
    const result = await runDirector(j, before, save) as typeof source;
    expect(result.clips[1].continuityIn).toEqual(source.clips[0].plannedEndState);
    expect(generate).not.toHaveBeenCalled();
    expect(before).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(j.snapshot.project.universeSnapshot.visualStyle).toBe(style);
  });
  it(`invalid timing reports its field rather than blaming the style: ${style}`, async () => {
    const { j, s, before, save } = execution(style);
    const source = structuredClone(s.plan!);
    source.clips[2].shots[0].end = 9;
    generate.mockResolvedValue(source);
    await expect(runDirector(j, before, save)).rejects.toMatchObject({ code: "DIRECTOR_JSON", message: expect.stringContaining("clips[2].shots[0].end") });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(j.checkpoint.director_validation_1).toMatchObject({ issues: expect.arrayContaining([expect.objectContaining({ path: "clips[2].shots[0].end" })]) });
  });
}
it("recovers a saved chapter-two draft with a mismatched written handoff without paying again", async () => {
  const { j, s, before, save } = execution();
  s.project.chapterNumber = 2;
  s.project.previousChapter = { projectId: "previous", exportId: "final", finalState: observed,
    bible: b, lastClip: { ...s.assets.find(a => a.id === "v8")!, lastFrameObject: "previous/last.png" } };
  j.snapshot = s;
  const draft = structuredClone(s.plan!);
  draft.clips[0].continuityIn = { ...observed, note: "Una descripción distinta" };
  j.checkpoint.director_1 = draft;
  const result = await runDirector(j, before, save) as typeof draft;
  expect(result.clips[0].continuityIn).toEqual(observed);
  expect(j.checkpoint.director_1).toEqual(draft);
  expect(generate).not.toHaveBeenCalled();
  expect(before).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});
it("normalizes only unambiguous serialization and handoff fields", () => {
  const { s } = execution();
  const source = JSON.parse(JSON.stringify(s.plan!));
  source.clips[0].shots[0].start = "0";
  source.clips[0].shots[0].end = "8";
  delete source.clips[0].shots[0].dialogue;
  delete source.clips[1].continuityIn;
  const original = JSON.stringify(source);
  const result = validateGeneratedPlan({ invalidJsonText: "```json\n" + original + "\n```" }, s);
  expect(result.clips[0].shots[0].start).toBe(0);
  expect(result.clips[0].shots[0].dialogue).toBe("");
  expect(result.clips[1].continuityIn).toEqual(result.clips[0].plannedEndState);
  expect(result.clips[0].dialogue).toEqual(s.plan!.clips[0].dialogue);
  expect(JSON.stringify(source)).toBe(original);
});
it("does not invent missing actions or silently accept unknown characters", () => {
  const { s } = execution();
  const missing = JSON.parse(JSON.stringify(s.plan!));
  delete missing.clips[0].shots[0].action;
  expect(() => validateGeneratedPlan(missing, s)).toThrow();
  const unknown = structuredClone(s.plan!);
  unknown.clips[2].shots[0].characterIds = ["unknown"];
  expect(() => validateGeneratedPlan(unknown, s)).toThrow();
});
it("does not swallow network ambiguity or increase the generation budget", async () => {
  const { j, before, save } = execution();
  const failure = new Error("Provider transport ambiguous");
  generate.mockRejectedValue(failure);
  await expect(runDirector(j, before, save)).rejects.toBe(failure);
  expect(generate).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
  expect(j.checkpoint.pendingCall).toBe("director_0");
});
it("repairs only after explaining the exact invalid field and retains the raw drafts", async () => {
  const { j, s, before, save } = execution();
  const invalid = structuredClone(s.plan!);
  invalid.clips[3].shots[0].end = 10;
  generate.mockResolvedValueOnce(invalid).mockResolvedValueOnce(s.plan!);
  const result = await runDirector(j, before, save);
  expect(result).toEqual(s.plan!);
  expect(generate.mock.calls[1][1]).toContain("clips[3].shots[0].end");
  expect(j.checkpoint.director_0).toEqual(invalid);
  expect(generate).toHaveBeenCalledTimes(2);
});
it("rejects truncated JSON and does not change arbitrary narrative strings", () => {
  expect(() => prepareGeneratedPlan({ invalidJsonText: '{"clips":[' })).toThrow();
  const { s } = execution();
  const source = structuredClone(s.plan!);
  source.clips[0].goal = "8";
  const result = validateGeneratedPlan(source, s);
  expect(result.clips[0].goal).toBe("8");
});
