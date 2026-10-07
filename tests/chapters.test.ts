import { expect, it } from "vitest";
import { snapshot, observed, b, q } from "./fixtures";
import { validateChapterBible, validateChapterPlan } from "../lib/continuity/chapters";
import { validatePlan } from "../lib/schemas";
import { narrativePrompt, compileVideoPrompt } from "../lib/director";
import { validateGeneratedPlan } from "../lib/director/plan-runner";
import type { Job } from "../lib/types";
function continuation() {
  const s = snapshot();
  s.project.chapterNumber = 2;
  s.project.previousChapter = { projectId: "previous", exportId: "final", finalState: observed, bible: b, lastClip: { ...s.assets.find(a => a.id === "v8")!, lastFrameObject: "universos-ia/previous/last.png" } };
  s.project.history = [{ projectId: "previous", chapterNumber: 1, title: "La carta", story: s.project.story!.data, finalState: observed, exportId: "final" }];
  return s;
}
it("accepts a first clip using the previous chapter frame only with a previous chapter", () => {
  const next = structuredClone(q); next.clips[0].startMode = "previousFrame";
  expect(() => validatePlan(next, b)).toThrow("fotograma previo");
  expect(validatePlan(next, b, true).clips).toHaveLength(8);
  expect(() => validateChapterPlan(continuation().project, next)).not.toThrow();
  next.clips[0].continuityIn = { ...observed, location: "otro-lugar" };
  expect(() => validateChapterPlan(continuation().project, next)).toThrow("estado final");
  next.clips[0].continuityIn = observed;
  next.clips[0].locationId = "another-location";
  expect(() => validateChapterPlan(continuation().project, next)).toThrow("lugar del fotograma final");
});
it("grounds the first chapter clip in the approved observed state without changing its story", () => {
  const s = continuation();
  const draft = structuredClone(q);
  draft.clips[0].continuityIn = { ...observed, location: "otro-lugar" };
  draft.clips[0].goal = "Revelar un nuevo secreto";
  draft.clips[0].shots[0].action = "Alba muestra la carta";
  const result = validateGeneratedPlan(draft, s);
  expect(result.clips[0].continuityIn).toEqual(observed);
  expect(result.clips[0].goal).toBe("Revelar un nuevo secreto");
  expect(result.clips[0].shots[0].action).toBe("Alba muestra la carta");
  expect(result.clips[1].continuityIn).toEqual(result.clips[0].plannedEndState);
  expect(draft.clips[0].continuityIn.location).toBe("otro-lugar");
});
it("compares the actual state, independent of object key order", () => {
  const next = structuredClone(q);
  next.clips[0].continuityIn = {
    characters: observed.characters.map(({ nextAction, ...rest }) => ({ nextAction, ...rest })),
    location: observed.location,
  };
  expect(() => validateChapterPlan(continuation().project, next)).not.toThrow();
});
it("protects canonical identities and voices across chapters", () => {
  const p = continuation().project;
  expect(() => validateChapterBible(p, b)).not.toThrow();
  const changed = structuredClone(b); changed.characters[0].voice.timbre = "Otra voz";
  expect(() => validateChapterBible(p, changed)).toThrow("ficha canónica");
});
it("includes previous events and observed incoming state in Director and video prompts", () => {
  const s = continuation();
  const prompt = narrativePrompt({ type: "ideas", snapshot: s, instructions: "" } as Job);
  expect(prompt).toContain("CONTINUACIÓN DE UNA HISTORIA ÚNICA");
  expect(prompt).toContain("La carta");
  const incoming = compileVideoPrompt(s, q.clips[0], "");
  expect(incoming).toContain(JSON.stringify(observed));
});
