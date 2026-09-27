import { beforeEach, it, expect, vi } from "vitest";
import { snapshot, observed } from "./fixtures";
const memory = vi.hoisted(() => ({
  rows: new Map<string, unknown>(),
  tail: Promise.resolve(),
}));
vi.mock("../lib/persistence/google", () => {
  function doc(path: string) {
    return { path, collection: (c: string) => collection(path + "/" + c) };
  }
  function collection(path: string) {
    return { path, query: true, doc: (id: string) => doc(path + "/" + id) };
  }
  return {
    db: () => ({
      doc,
      collection,
      runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        let release!: () => void;
        const before = memory.tail;
        memory.tail = new Promise<void>((r) => (release = r));
        await before;
        const changes: (() => void)[] = [];
        const tx = {
          get: async (ref: { path: string; query?: boolean }) => {
            if (changes.length)
              throw Error("Firestore forbids reads after writes");
            if (ref.query) {
              const docs = [...memory.rows]
                .filter(
                  ([p]) =>
                    p.startsWith(ref.path + "/") &&
                    p.split("/").length === ref.path.split("/").length + 1,
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
  jobControl,
  closeAmbiguousJob,
} from "../lib/persistence/projects";
import type { Asset, Job, Project, Target } from "../lib/types";
beforeEach(() => {
  memory.rows.clear();
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
it("REGRESSION changing story choice invalidates downstream approvals", async () => {
  await editProject("test", 1, { selectedIdeaId: "idea2" });
  const p = memory.rows.get("projects/test") as Project;
  expect(p.story?.approvedAt).toBe(0);
  expect(p.plan?.approvedAt).toBe(0);
});
it("REGRESSION removed shots do not receive updates after deletion", async () => {
  const s = snapshot(),
    p = structuredClone(s.plan!);
  p.clips[0].shots[0].id = "changed";
  await editProject("test", 1, { kind: "plan", data: p, approve: true });
  expect(memory.rows.has("projects/test/targets/shot_s0")).toBe(false);
  expect(memory.rows.has("projects/test/targets/shot_changed")).toBe(true);
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

it("REGRESSION canonical approval marks only dependent storyboard and video", async () => {
  const image = memory.rows.get("projects/test/assets/i1") as Asset;
  memory.rows.set("projects/test/assets/i1", { ...image, inputRefs: ["canonical_a"] });
  const canonical = memory.rows.get("projects/test/assets/canonical_a") as Asset;
  memory.rows.set("projects/test/assets/new-canonical", { ...canonical, id: "new-canonical" });
  await approveAsset("test", "character_a", "new-canonical", 1);
  expect((memory.rows.get("projects/test/targets/shot_s0") as Target).needsReview).toBe(true);
  expect((memory.rows.get("projects/test/targets/clip_1") as Target).needsReview).toBe(true);
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
  await editProject("test", 1, { selectedIdeaId: "idea2", versionId: "old-story" });
  expect((memory.rows.get("projects/test") as Project).selectedIdeaId).toBe("idea2");
});
