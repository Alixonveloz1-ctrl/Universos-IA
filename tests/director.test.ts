// SIMULATED text provider only. No calls consuming Google credits.
import { beforeEach, expect, it, vi } from "vitest";
import { snapshot } from "./fixtures";
import type { Job } from "../lib/types";
import { AppError } from "../lib/errors";
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
it("uses one combined repair budget for schema and semantic defects", async () => {
  const { j, before, checkpoint } = execution();
  generate
    .mockResolvedValueOnce({ invalidJsonText: "{" })
    .mockResolvedValueOnce(j.snapshot.project.story!.data)
    .mockResolvedValueOnce({
      errors: ["Cambio de nombre"],
      suggestions: ["Conservar Alba"],
    });
  await expect(runDirector(j, before, checkpoint)).rejects.toThrow(
    "contradicciones",
  );
  expect(generate).toHaveBeenCalledTimes(3);
  expect(j.checkpoint.director_1).toBeDefined();
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
it("a lost review response cannot be mistaken for permission to repair and charge again", async () => {
  const { j, before, checkpoint } = execution();
  generate
    .mockResolvedValueOnce(j.snapshot.project.story!.data)
    .mockRejectedValueOnce(new AppError("AMBIGUOUS", "Response lost"));
  await expect(runDirector(j, before, checkpoint)).rejects.toThrow(
    "Response lost",
  );
  await expect(runDirector(j, before, checkpoint)).rejects.toThrow("créditos");
  expect(generate).toHaveBeenCalledTimes(2);
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
