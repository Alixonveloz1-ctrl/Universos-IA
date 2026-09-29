import { beforeEach, it, expect, vi } from "vitest";
import { snapshot, observed } from "./fixtures";
const memory = vi.hoisted(() => ({
  rows: new Map<string, unknown>(),
  tail: Promise.resolve(),
  deletedPrefixes: [] as string[],
}));
vi.mock("../lib/persistence/google", () => {
  function doc(path: string) {
    return { path, collection: (c: string) => collection(path + "/" + c), get: async () => ({ exists: memory.rows.has(path), data: () => memory.rows.get(path) }), delete: async () => { memory.rows.delete(path); } };
  }
  function collection(path: string) {
    const get = async (filter?: unknown) => ({ docs: [...memory.rows].filter(([p, v]) => p.startsWith(path + "/") && p.split("/").length === path.split("/").length + 1 && (filter === undefined || (v as { owner?: string }).owner === filter)).map(([p, v]) => ({ id: p.split("/").at(-1)!, data: () => structuredClone(v) })) });
    return { path, query: true, get: () => get(), where: (_field: string, _op: string, value: unknown) => ({ path, query: true, filter: value, get: () => get(value) }), doc: (id: string) => doc(path + "/" + id) };
  }
  return {
    bucket: () => ({ deleteFiles: async ({ prefix }: { prefix: string }) => { memory.deletedPrefixes.push(prefix); } }),
    db: () => ({
      doc,
      collection,
      recursiveDelete: async (ref: { path: string }) => { for (const key of memory.rows.keys()) if (key === ref.path || key.startsWith(ref.path + "/")) memory.rows.delete(key); },
      runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        let release!: () => void;
        const before = memory.tail;
        memory.tail = new Promise<void>((r) => (release = r));
        await before;
        const changes: (() => void)[] = [];
        const tx = {
          get: async (ref: { path: string; query?: boolean; filter?: unknown }) => {
            if (changes.length)
              throw Error("Firestore forbids reads after writes");
            if (ref.query) {
              const docs = [...memory.rows]
                .filter(
                  ([p, v]) =>
                    p.startsWith(ref.path + "/") &&
                    p.split("/").length === ref.path.split("/").length + 1 &&
                    (ref.filter === undefined || (v as Job).projectId === ref.filter),
                )
                .map(([p, v]) => ({
                  id: p.split("/").at(-1),
                  data: () => structuredClone(v),
                }));
              return { docs };
            }
            const v = memory.rows.get(ref.path);
            return {
              exists: v !== undefined,
              data: () => (v === undefined ? undefined : structuredClone(v)),
            };
          },
          set: (r: { path: string }, v: unknown) =>
            changes.push(() => memory.rows.set(r.path, structuredClone(v))),
          create: (r: { path: string }, v: unknown) => {
            if (memory.rows.has(r.path)) throw Error("Already exists");
            changes.push(() => memory.rows.set(r.path, structuredClone(v)));
          },
          update: (r: { path: string }, v: object) =>
            changes.push(() => {
              if (!memory.rows.has(r.path))
                throw Error("Missing document " + r.path);
              memory.rows.set(r.path, {
                ...(memory.rows.get(r.path) as object),
                ...structuredClone(v),
              });
            }),
          delete: (r: { path: string }) =>
            changes.push(() => memory.rows.delete(r.path)),
        };
        try {
          const v = await fn(tx);
          changes.forEach((c) => c());
          return v;
        } finally {
          release();
        }
      },
    }),
  };
});
import {
  enqueue,
  approveAsset,
  editProject,
  createNextChapter,
  jobControl,
  closeAmbiguousJob,
  deleteUniverse,
  recoverReviewedIdeas,
  recoverReviewedStory,
  readSnapshot,
} from "../lib/persistence/projects";
import type { Asset, Job, Project, Target } from "../lib/types";
import type { Plan } from "../lib/schemas";
beforeEach(() => {
  process.env.GCP_PROJECT_ID = "alixon-jhan";
  process.env.GCS_OUTPUT_BUCKET = "universos_ia";
  memory.rows.clear();
  memory.deletedPrefixes.length = 0;
  memory.tail = Promise.resolve();
  const s = snapshot();
  memory.rows.set("projects/test", s.project);
  s.targets.forEach((t) => memory.rows.set("projects/test/targets/" + t.id, t));
  s.assets.forEach((a) => memory.rows.set("projects/test/assets/" + a.id, a));
  Object.entries(s.observed).forEach(([id, v]) =>
    memory.rows.set("projects/test/observed/" + id, v),
  );
});
const a = {
  type: "video" as const,
  expectedRevision: 1,
  targetId: "clip_2",
  requestId: "dddddddd-dddd-4ddd-addd-dddddddddddd",
  instructions: "",
};
it("deletes an entire universe with all chapters, media, jobs and checkpoints", async () => {
  for (const key of [...memory.rows.keys()]) if (key.startsWith("projects/test/")) memory.rows.delete(key);
  const p = memory.rows.get("projects/test") as Project;
  memory.rows.set("projects/test", { ...p, automaticUniverse: true, stage: "story", chapterNumber: 1,
    universeId: "story-test", selectedIdeaId: "idea-1", story: undefined, bible: undefined, plan: undefined,
    previousChapter: undefined, nextChapterId: undefined });
  memory.rows.set("universes/story-test", { projectId: "test" });
  memory.rows.set("jobs/old", { id: "old", projectId: "test", type: "ideas", state: "failed", leaseUntil: 0, checkpoint: {} });
  memory.rows.set("jobs/old/checkpoints/director_1", { value: "old draft" });
  memory.rows.set("projects/second", { ...p, id: "second", universeId: "story-test", chapterNumber: 2, story: { id: "approved" } });
  memory.rows.set("projects/second/assets/video", { storageObject: "universos-ia/second/video.mp4" });
  memory.rows.set("jobs/render", { id: "render", projectId: "second", type: "video", state: "completed", leaseUntil: 0 });
  await deleteUniverse("test");
  expect([...memory.rows.keys()].filter(k => k.startsWith("projects/") || k === "universes/story-test" || k.startsWith("jobs/"))).toEqual([]);
  expect(memory.deletedPrefixes).toEqual(["universos-ia/test/", "universos-ia/second/"]);
});
it("restores three valid saved ideas after an overstrict review without invoking a generator", async () => {
  for (const key of [...memory.rows.keys()]) if (key.startsWith("projects/test/")) memory.rows.delete(key);
  const p = memory.rows.get("projects/test") as Project;
  memory.rows.set("projects/test", { ...p, revision: 1, stage: "ideas", activeJobId: "old", ideas: [] });
  const { revision: _revision, ...universe } = p.universeSnapshot;
  void _revision;
  const ideas = [1, 2, 3].map(n => ({ id: `i${n}`, title: `Historia ${n}`, synopsis: `Propuesta ${n}`, universe }));
  memory.rows.set("jobs/old", { id: "old", projectId: "test", type: "ideas", state: "failed", error: { code: "CONTINUITY", message: "Objeción menor" }, leaseUntil: 0, checkpoint: {}, snapshot: { project: { revision: 1 } } });
  memory.rows.set("jobs/old/checkpoints/director_1", { value: { ideas } });
  await recoverReviewedIdeas("old");
  expect((memory.rows.get("projects/test") as Project).ideas).toEqual(ideas);
  expect((memory.rows.get("jobs/old") as Job).state).toBe("completed");
});
it("restores a valid saved story after a semantic veto as a candidate for owner approval", async () => {
  const p = memory.rows.get("projects/test") as Project;
  const draft = p.story!.data;
  memory.rows.set("projects/test", { ...p, activeJobId: "old-story", selectedIdeaId: "idea-1" });
  memory.rows.set("jobs/old-story", { id: "old-story", projectId: "test", type: "story", state: "failed",
    error: { code: "CONTINUITY", message: "Objection" }, leaseUntil: 0, checkpoint: {},
    snapshot: { project: { revision: p.revision, selectedIdeaId: "idea-1" } } });
  memory.rows.set("jobs/old-story/checkpoints/director_1", { value: draft });
  await recoverReviewedStory("old-story");
  expect(memory.rows.get("projects/test/narratives/old-story")).toMatchObject({ kind: "story", data: draft });
  expect((memory.rows.get("jobs/old-story") as Job).state).toBe("completed");
  expect((memory.rows.get("projects/test") as Project).story).toBe(p.story);
});
it("refuses to delete a draft while an execution might still run", async () => {
  for (const key of [...memory.rows.keys()]) if (key.startsWith("projects/test/")) memory.rows.delete(key);
  const p = memory.rows.get("projects/test") as Project;
  memory.rows.set("projects/test", { ...p, automaticUniverse: true, universeId: "", story: undefined, bible: undefined, plan: undefined, nextChapterId: undefined, previousChapter: undefined });
  memory.rows.set("jobs/active", { id: "active", projectId: "test", type: "ideas", state: "queued", leaseUntil: 0, checkpoint: {} });
  await expect(deleteUniverse("test")).rejects.toThrow("en curso");
  expect(memory.rows.has("projects/test")).toBe(true);
});
it("deletes a universe even when it has generated assets and an approved story", async () => {
  const p = memory.rows.get("projects/test") as Project;
  memory.rows.set("projects/test", { ...p, automaticUniverse: true, universeId: "story-test", story: { id: "approved" } });
  await deleteUniverse("test");
  expect(memory.rows.has("projects/test")).toBe(false);
});
it("SIMULATED transactions: concurrent duplicate submissions produce one job", async () => {
  const [x, y] = await Promise.all([enqueue("test", a), enqueue("test", a)]);
  expect(x.id).toBe(y.id);
  expect(
    [...memory.rows.keys()].filter((k) => k.startsWith("jobs/")),
  ).toHaveLength(1);
});
it("SIMULATED transactions: a second different paid action is blocked", async () => {
  await enqueue("test", a);
  await expect(
    enqueue("test", {
      ...a,
      targetId: "clip_3",
      requestId: "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb",
    }),
  ).rejects.toThrow("activo");
});
it("SIMULATED export race: frozen manifest survives approval changes", async () => {
  const j = await enqueue("test", { ...a, type: "finalize" });
  const old = memory.rows.get("projects/test/assets/v1") as object;
  memory.rows.set("projects/test/assets/new", { ...old, id: "new" });
  await approveAsset("test", "clip_1", "new", 1, observed);
  expect(j.snapshot.manifest?.[0]).toBe("v1");
  expect(
    (
      memory.rows.get("projects/test/targets/clip_2") as {
        needsReview: boolean;
      }
    ).needsReview,
  ).toBe(true);
  expect(memory.rows.has("projects/test/assets/v1")).toBe(true);
});
it("REGRESSION choosing a story discards the other ideas and invalidates downstream approvals", async () => {
  const original = memory.rows.get("projects/test") as Project;
  memory.rows.set("projects/test", { ...original, selectedIdeaId: undefined });
  await editProject("test", 1, { selectedIdeaId: "idea2" });
  const p = memory.rows.get("projects/test") as Project;
  expect(p.ideas.map(i => i.id)).toEqual(["idea2"]);
  expect(p.story?.approvedAt).toBe(0);
  expect(p.plan?.approvedAt).toBe(0);
  await expect(editProject("test", p.revision, { selectedIdeaId: "idea-1" })).rejects.toThrow("descartaron");
});
it("approving the same story twice does not create a fourth copy or invalidate the bible", async () => {
  const original = memory.rows.get("projects/test") as Project;
  const result = await editProject("test", original.revision, {
    kind: "story", data: original.story!.data, approve: true,
  });
  expect(result.revision).toBe(original.revision);
  expect((memory.rows.get("projects/test") as Project).bible?.approvedAt).toBe(original.bible?.approvedAt);
  expect([...memory.rows.keys()].filter(k => k.startsWith("projects/test/narratives/"))).toHaveLength(0);
});
it("REGRESSION removed shots do not receive updates after deletion", async () => {
  const s = snapshot(),
    p = structuredClone(s.plan!);
  p.clips[0].shots[0].id = "changed";
  await editProject("test", 1, { kind: "plan", data: p, approve: true });
  expect(memory.rows.has("projects/test/targets/shot_s0")).toBe(false);
  expect(memory.rows.has("projects/test/targets/shot_changed")).toBe(true);
});
it("shows only eight initial images for an older plan with extra camera cuts", async () => {
  const p = structuredClone(memory.rows.get("projects/test") as Project);
  const plan = structuredClone(p.plan!.data as Plan);
  plan.clips[0].shots.push({ ...plan.clips[0].shots[0], id: "extra", start: 4, end: 8 });
  plan.clips[0].shots[0].end = 4;
  p.plan = { ...p.plan!, data: plan };
  memory.rows.set("projects/test", p);
  memory.rows.set("projects/test/targets/shot_extra", {
    ...memory.rows.get("projects/test/targets/shot_s0") as Target,
    id: "shot_extra", entityId: "extra", approvedVersionId: undefined,
  });
  const current = await readSnapshot("test");
  expect(current.targets.filter(t => t.role === "shot")).toHaveLength(8);
  expect(current.targets.some(t => t.id === "shot_extra")).toBe(false);
  const { prerequisites } = await import("../lib/continuity/rules");
  expect(() => prerequisites(current, { type: "video", expectedRevision: 1, targetId: "clip_1", requestId: "test", instructions: "" })).not.toThrow();
});

it("creates only eight initial image targets when approving a multi-cut plan", async () => {
  const p = structuredClone((memory.rows.get("projects/test") as Project).plan!.data as Plan);
  p.clips[0].shots[0].end = 4;
  p.clips[0].shots.push({ ...p.clips[0].shots[0], id: "extra", start: 4, end: 8 });
  await editProject("test", 1, { kind: "plan", data: p, approve: true });
  expect(memory.rows.has("projects/test/targets/shot_extra")).toBe(false);
  expect((await readSnapshot("test")).targets.filter(t => t.role === "shot")).toHaveLength(8);
});
it("SIMULATED recovery: manual inspection retains the ambiguous checkpoint", async () => {
  const j = await enqueue("test", a);
  memory.rows.set("jobs/" + j.id, {
    ...j,
    state: "needsReview",
    checkpoint: { submitted: true },
    leaseUntil: 0,
  });
  await jobControl(j.id, "resume");
  expect((memory.rows.get("jobs/" + j.id) as Job).checkpoint.submitted).toBe(
    true,
  );
});
it("retries an explicitly rejected 400 without a stuck pending response", async () => {
  const original = memory.rows.get("projects/test") as Project;
  expect(original.ideas.length).toBe(3);
  expect((await readSnapshot("test")).project.ideas.map(i => i.id)).toEqual([original.selectedIdeaId]);
  const j = await enqueue("test", { ...a, type: "bible" });
  memory.rows.set("jobs/" + j.id, {
    ...j, state: "needsReview", leaseUntil: 0,
    snapshot: { ...j.snapshot, project: { ...j.snapshot.project, ideas: original.ideas } },
    error: { code: "PROVIDER_REJECTED", message: "Google respondió 400" },
    checkpoint: { submitted: true, pendingCall: "director_0", reconciledAt: Date.now() },
  });
  await jobControl(j.id, "resume");
  const next = memory.rows.get("jobs/" + j.id) as Job;
  expect(next.state).toBe("queued");
  expect(next.checkpoint.pendingCall).toBeNull();
  expect(next.checkpoint.submitted).toBe(false);
  expect(next.snapshot.project.ideas.map(i => i.id)).toEqual([original.selectedIdeaId]);
});

it("REGRESSION two independent request IDs for same active intent return one job", async () => {
  const x = await enqueue("test", a);
  const y = await enqueue("test", {
    ...a,
    requestId: "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb",
  });
  expect(x.id).toBe(y.id);
});
it("REGRESSION dialogue edit leaves unrelated clip approvals valid", async () => {
  const s = snapshot(),
    p = structuredClone(s.plan!);
  p.clips[2].dialogue[0].text = "Es mío.";
  await editProject("test", 1, { kind: "plan", data: p, approve: true });
  expect(
    (
      memory.rows.get("projects/test/targets/clip_3") as {
        needsReview: boolean;
      }
    ).needsReview,
  ).toBe(true);
  expect(
    (
      memory.rows.get("projects/test/targets/clip_8") as {
        needsReview: boolean;
      }
    ).needsReview,
  ).toBe(false);
});

it("REGRESSION manual closure preserves paid checkpoint and rejects later resume", async () => {
  const j = await enqueue("test", a);
  memory.rows.set("jobs/" + j.id, {
    ...j,
    state: "needsReview",
    checkpoint: {
      submitted: true,
      pendingCall: "asset_clip_2",
      reconciledAt: Date.now(),
    },
  });
  await expect(closeAmbiguousJob(j.id, "", false)).rejects.toThrow();
  await closeAmbiguousJob(
    j.id,
    "No hay resultado recuperable tras revisar el intento.",
    true,
  );
  const closed = memory.rows.get("jobs/" + j.id) as Job;
  expect(closed.checkpoint.submitted).toBe(true);
  expect(closed.checkpoint.closedAt).toBeGreaterThan(0);
  await expect(jobControl(j.id, "resume")).rejects.toThrow("cerrado");
  const next = await enqueue("test", {
    ...a,
    requestId: "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb",
  });
  expect(next.id).not.toBe(j.id);
  await expect(jobControl(j.id, "resume")).rejects.toThrow("activo");
});
it("REGRESSION an operation with a known provider ID cannot be closed as untraceable", async () => {
  const j = await enqueue("test", a);
  memory.rows.set("jobs/" + j.id, {
    ...j,
    state: "needsReview",
    checkpoint: { operation: "known" },
  });
  await expect(closeAmbiguousJob(j.id, "reviewed", true)).rejects.toThrow();
});

it.each(["failed", "stopped"] as const)("REGRESSION %s cannot replace a video whose provider operation remains unresolved", async (state) => {
  const j = await enqueue("test", a);
  memory.rows.set("jobs/" + j.id, { ...j, state, checkpoint: { operation: "known" } });
  await expect(enqueue("test", { ...a, requestId: "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb" })).rejects.toThrow("activo");
  await jobControl(j.id, "resume");
  expect((memory.rows.get("jobs/" + j.id) as Job).checkpoint.operation).toBe("known");
});

it("REGRESSION a recorded terminal provider rejection allows an explicit new request", async () => {
  const j = await enqueue("test", a);
  memory.rows.set("jobs/" + j.id, { ...j, state: "failed", checkpoint: { operation: "known", operationFailed: true } });
  const next = await enqueue("test", { ...a, requestId: "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb" });
  expect(next.id).not.toBe(j.id);
});

it("REGRESSION a local failure with a live lease cannot start another job", async () => {
  const j = await enqueue("test", a);
  memory.rows.set("jobs/" + j.id, { ...j, state: "failed", leaseUntil: Date.now() + 60000 });
  await expect(enqueue("test", { ...a, requestId: "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb" })).rejects.toThrow("activo");
});

it("latest canonical reference does not require approving downstream media", async () => {
  const image = memory.rows.get("projects/test/assets/i1") as Asset;
  memory.rows.set("projects/test/assets/i1", { ...image, inputRefs: ["canonical_a"] });
  const canonical = memory.rows.get("projects/test/assets/canonical_a") as Asset;
  memory.rows.set("projects/test/assets/new-canonical", { ...canonical, id: "new-canonical" });
  await approveAsset("test", "character_a", "new-canonical", 1);
  expect((await readSnapshot("test")).targets.find(t => t.id === "shot_s0")?.needsReview).toBe(false);
  expect((await readSnapshot("test")).targets.find(t => t.id === "clip_1")?.needsReview).toBe(false);
  expect((memory.rows.get("projects/test/targets/clip_8") as Target).needsReview).toBe(false);
  expect(memory.rows.has("projects/test/assets/canonical_a")).toBe(true);
});

it("REGRESSION reapproving an unchanged video and observed state does not invalidate its successor", async () => {
  await approveAsset("test", "clip_1", "v1", 1, observed);
  expect((memory.rows.get("projects/test/targets/clip_2") as Target).needsReview).toBe(false);
});

it("REGRESSION selecting an idea and restoring a narrative reads before writing", async () => {
  const narrative = (memory.rows.get("projects/test") as Project).story!;
  memory.rows.set("projects/test/narratives/old-story", narrative);
  memory.rows.set("projects/test", { ...(memory.rows.get("projects/test") as Project), selectedIdeaId: undefined });
  await editProject("test", 1, { selectedIdeaId: "idea2", versionId: "old-story" });
  expect((memory.rows.get("projects/test") as Project).selectedIdeaId).toBe("idea2");
});

it("creates only the selected proposal's universe without manual input", async () => {
  const s = snapshot();
  const generated = { ...s.project.universeSnapshot, name: "El mundo de la segunda historia" };
  const { revision: _revision, ...universe } = generated;
  void _revision;
  memory.rows.set("projects/test", {
    ...s.project, automaticUniverse: true, universeId: "", selectedIdeaId: undefined,
    ideas: [{ id: "idea1", title: "Primera", synopsis: "Uno", universe },
      { id: "idea2", title: "Segunda", synopsis: "Dos", universe }],
  });
  await editProject("test", 1, { selectedIdeaId: "idea2" });
  const saved = memory.rows.get("projects/test") as typeof s.project;
  expect(saved.universeId).toBe("story-test");
  expect(saved.universeSnapshot.name).toBe(universe.name);
  expect(memory.rows.has("universes/story-test-idea1")).toBe(false);
  expect(memory.rows.has("universes/story-test")).toBe(true);
});
it("refuses to select an automatic proposal without its generated universe", async () => {
  const s = snapshot();
  memory.rows.set("projects/test", { ...s.project, automaticUniverse: true, universeId: "" });
  await expect(editProject("test", 1, { selectedIdeaId: "idea2" })).rejects.toThrow();
  expect([...memory.rows.keys()].filter(k => k.startsWith("universes/"))).toEqual([]);
});

function finishedChapter() {
  const s = snapshot();
  const last = s.assets.find(a => a.id === "v8")!;
  memory.rows.set("projects/test/assets/v8", { ...last, lastFrameObject: "universos-ia/test/v8/last.png" });
  memory.rows.set("projects/test/exports/final", { id: "final", state: "completed", createdAt: 1, approvedClipVersionIds: Array.from({ length: 8 }, (_, i) => `v${i + 1}`) });
}
it("creates one continuation even with concurrent requests, preserving universe, canon and chapter history", async () => {
  finishedChapter();
  const [first, second] = await Promise.all([createNextChapter("test", 1), createNextChapter("test", 1)]);
  expect(second.id).toBe(first.id);
  expect(first.chapterNumber).toBe(2);
  expect(first.universeId).toBe("universe");
  expect(first.previousChapter?.lastClip.lastFrameObject).toContain("v8/last.png");
  expect(first.history).toHaveLength(1);
  expect(first.history![0].story).toEqual(snapshot().project.story!.data);
  expect(first.ideas).toEqual([]);
  expect(first.automaticUniverse).toBe(false);
  expect(memory.rows.get(`projects/${first.id}/assets/canonical_a`)).toEqual(snapshot().assets.find(a => a.id === "canonical_a"));
  expect(memory.rows.has(`projects/${first.id}/assets/v8`)).toBe(false);
  expect([...memory.rows.keys()].filter(k => k.startsWith("universes/"))).toEqual([]);
  await expect(editProject("test", 1, { selectedIdeaId: "idea2" })).rejects.toThrow("continuación");
  await expect(enqueue("test", a)).rejects.toThrow("continuación");
});
it("requires a current completed export before continuing", async () => {
  await expect(createNextChapter("test", 1)).rejects.toThrow("Une primero");
  finishedChapter();
  memory.rows.set("projects/test/exports/final", { id: "final", state: "completed", approvedClipVersionIds: ["old"] });
  await expect(createNextChapter("test", 1)).rejects.toThrow("Une primero");
  expect((memory.rows.get("projects/test") as Project).nextChapterId).toBeUndefined();
});
it("continues a completed chapter without manual continuity approval", async () => {
  finishedChapter();
  const clip = memory.rows.get("projects/test/targets/clip_8") as Target;
  memory.rows.set("projects/test/targets/clip_8", { ...clip, needsReview: true });
  await expect(createNextChapter("test", 1)).resolves.toHaveProperty("chapterNumber", 2);
});
it("keeps the same universe when a continuation chooses its proposal", async () => {
  finishedChapter();
  const next = await createNextChapter("test", 1);
  memory.rows.set(`projects/${next.id}`, { ...next, ideas: [{ id: "continue", title: "La carta se abre", synopsis: "Continúa" }] });
  const selected = await editProject(next.id, 0, { selectedIdeaId: "continue" });
  expect(selected.universeId).toBe("universe");
  expect(selected.universeSnapshot).toEqual(snapshot().project.universeSnapshot);
  expect((memory.rows.get(`projects/${next.id}/targets/character_a`) as Target).needsReview).toBe(false);
});

it("changing model cancels a never-started queue entry and unblocks a new request", async () => {
  const j = await enqueue("test", a);
  const models = { ...snapshot().project.models, text: "gemini-3.1-pro-preview" };
  const updated = await editProject("test", 1, { models });
  expect(updated.models).toEqual(models);
  expect(updated.revision).toBe(1);
  expect((memory.rows.get(`jobs/${j.id}`) as Job).state).toBe("stopped");
  const next = await enqueue("test", { ...a, requestId: "new-model-request" });
  expect(next.snapshot.project.models.text).toBe("gemini-3.1-pro-preview");
});
it("changing future models does not invalidate or alter an executing snapshot", async () => {
  const j = await enqueue("test", a);
  memory.rows.set(`jobs/${j.id}`, { ...j, state: "running", leaseUntil: Date.now() + 60000, attempts: 1 });
  await editProject("test", 1, { models: { ...snapshot().project.models, image: "gemini-3.1-flash-image" } });
  const running = memory.rows.get(`jobs/${j.id}`) as Job;
  expect(running.state).toBe("running");
  expect(running.snapshot.project.models.image).toBe(snapshot().project.models.image);
  expect((memory.rows.get("projects/test") as Project).revision).toBe(1);
});
it("stopping a never-started queued job releases the queue immediately", async () => {
  const j = await enqueue("test", a);
  await jobControl(j.id, "stop");
  expect((memory.rows.get(`jobs/${j.id}`) as Job).state).toBe("stopped");
});

it("uses newest successful images for videos and newest clips for montage without approvals", async () => {
  const s = snapshot();
  for (const t of s.targets) memory.rows.set(`projects/test/targets/${t.id}`, { ...t, approvedVersionId: undefined, needsReview: true });
  const opening = s.assets.find(a => a.id === "i2")!;
  memory.rows.set("projects/test/assets/new-image", { ...opening, id: "new-image", createdAt: opening.createdAt + 100 });
  memory.rows.set("projects/test/assets/rejected-image", { ...opening, id: "rejected-image", createdAt: opening.createdAt + 200, status: "rejected" });
  const video = s.assets.find(a => a.id === "v1")!;
  memory.rows.set("projects/test/assets/new-video", { ...video, id: "new-video", createdAt: video.createdAt + 100 });
  memory.rows.delete("projects/test/observed/clip_1");
  const current = await readSnapshot("test");
  expect(current.targets.find(t => t.id === opening.targetId)?.approvedVersionId).toBe("new-image");
  expect(current.targets.every(t => !t.needsReview)).toBe(true);
  const job = await enqueue("test", { ...a, type: "finalize" });
  expect(job.snapshot.manifest?.[0]).toBe("new-video");
});
