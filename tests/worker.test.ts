// SIMULATED Firestore/GCS/Vertex orchestration; real image validation with Sharp.
import { beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import { snapshot } from "./fixtures";
import type { Job } from "../lib/types";
const memory = vi.hoisted(() => ({
  rows: new Map<string, unknown>(),
  files: new Map<string, Buffer>(),
  failAssetCreate: false,
  tail: Promise.resolve(),
}));
vi.mock("../lib/persistence/google", () => {
  function doc(path: string) {
    return {
      path,
      collection: (name: string) => collection(path + "/" + name),
      get: async () => ({
        exists: memory.rows.has(path),
        data: () => structuredClone(memory.rows.get(path)),
      }),
      create: async (value: unknown) => {
        if (path.includes("/assets/") && memory.failAssetCreate) {
          memory.failAssetCreate = false;
          throw Error("simulated crash after upload");
        }
        if (memory.rows.has(path)) throw Error("already exists");
        memory.rows.set(path, structuredClone(value));
      },
      set: async (value: unknown) => {
        memory.rows.set(path, structuredClone(value));
      },
    };
  }
  function collection(path: string) {
    return { doc: (id: string) => doc(path + "/" + id) };
  }
  return {
    objectPath: (p: string, v: string, n: string) =>
      `universos-ia/${p}/${v}/${n}`,
    privateObject: (key: string) => ({
      exists: async () => [memory.files.has(key)],
      save: async (
        bytes: Buffer,
        options: { preconditionOpts?: { ifGenerationMatch: number } },
      ) => {
        if (
          options.preconditionOpts?.ifGenerationMatch === 0 &&
          memory.files.has(key)
        )
          throw Error("immutable output exists");
        memory.files.set(key, Buffer.from(bytes));
      },
      download: async () => {
        const b = memory.files.get(key);
        if (!b) throw Error("missing");
        return [b];
      },
    }),
    bucket: () => ({ getFiles: async () => [[]] }),
    db: () => ({
      doc,
      collection,
      runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const before = memory.tail;
        let release!: () => void;
        memory.tail = new Promise<void>((r) => {
          release = r;
        });
        await before;
        const writes: (() => void)[] = [];
        const tx = {
          get: async (ref: ReturnType<typeof doc>) => {
            if (writes.length) throw Error("read after write");
            return ref.get();
          },
          set: (ref: ReturnType<typeof doc>, data: object) =>
            writes.push(() => {
              memory.rows.set(ref.path, structuredClone(data));
            }),
          create: (ref: ReturnType<typeof doc>, data: object) => {
            if (ref.path.includes("/assets/") && memory.failAssetCreate) {
              memory.failAssetCreate = false;
              throw Error("simulated crash after upload");
            }
            if (memory.rows.has(ref.path)) throw Error("already exists");
            writes.push(() => { memory.rows.set(ref.path, structuredClone(data)); });
          },
          update: (ref: ReturnType<typeof doc>, data: object) =>
            writes.push(() => {
              memory.rows.set(ref.path, {
                ...(memory.rows.get(ref.path) as object),
                ...structuredClone(data),
              });
            }),
        };
        try {
          const result = await fn(tx);
          writes.forEach((w) => w());
          return result;
        } finally {
          release();
        }
      },
    }),
  };
});
vi.mock("../lib/providers/vertex", () => ({
  textGenerate: vi.fn(),
  imageGenerate: vi.fn(),
  pollVideo: vi.fn(),
  startVideo: vi.fn(),
}));
import { textGenerate, imageGenerate } from "../lib/providers/vertex";
import { execute } from "../worker/main";
import { jobControl } from "../lib/persistence/projects";
const jobId = "e".repeat(64);
beforeEach(async () => {
  memory.rows.clear();
  memory.files.clear();
  memory.failAssetCreate = false;
  memory.tail = Promise.resolve();
  vi.mocked(textGenerate).mockReset().mockResolvedValue({
    prompt: "An approved canonical image, preserving the full identity.",
  });
  vi.mocked(imageGenerate)
    .mockReset()
    .mockResolvedValue({
      mime: "image/png",
      bytes: Buffer.from(
        await sharp({
          create: { width: 90, height: 160, channels: 3, background: "blue" },
        })
          .png()
          .toBuffer(),
      ),
    });
  const s = snapshot();
  delete s.targets.find((t) => t.id === "character_a")!.approvedVersionId;
  const j: Job = {
    id: jobId,
    type: "image",
    projectId: "test",
    targetId: "character_a",
    instructions: "",
    requestId: "test",
    snapshot: s,
    createdAt: 1,
    heartbeat: 1,
    state: "queued",
    leaseOwner: null,
    leaseUntil: 0,
    attempts: 0,
    stopRequested: false,
    checkpoint: {},
  };
  memory.rows.set("jobs/" + jobId, j);
  memory.rows.set("projects/test", { ...s.project, activeJobId: jobId });
});
it("REGRESSION restart after upload registers the saved candidate without paying twice", async () => {
  memory.failAssetCreate = true;
  await execute(jobId);
  process.exitCode = 0;
  expect((memory.rows.get("jobs/" + jobId) as Job).state).toBe("needsReview");
  expect(memory.files.size).toBe(1);
  await jobControl(jobId, "resume");
  await execute(jobId);
  expect((memory.rows.get("jobs/" + jobId) as Job).state).toBe("completed");
  expect(imageGenerate).toHaveBeenCalledTimes(1);
  expect(textGenerate).toHaveBeenCalledTimes(1);
  expect(
    [...memory.rows.keys()].filter((k) => k.includes("/assets/")),
  ).toHaveLength(1);
});
it("SIMULATED concurrent Cloud Run dispatches acquire only one lease and paid request", async () => {
  await Promise.all([execute(jobId), execute(jobId)]);
  expect(imageGenerate).toHaveBeenCalledTimes(1);
  expect((memory.rows.get("jobs/" + jobId) as Job).attempts).toBe(1);
});
it("REGRESSION stopped or superseded jobs cannot execute from a late dispatch", async () => {
  const j = memory.rows.get("jobs/" + jobId) as Job;
  memory.rows.set("jobs/" + jobId, { ...j, state: "stopped" });
  await execute(jobId);
  memory.rows.set("jobs/" + jobId, j);
  memory.rows.set("projects/test", { activeJobId: "different" });
  await execute(jobId);
  expect(imageGenerate).not.toHaveBeenCalled();
  expect(textGenerate).not.toHaveBeenCalled();
});

it("REGRESSION a worker that loses its lease cannot write a late text checkpoint", async () => {
  vi.mocked(textGenerate).mockImplementationOnce(async () => {
    const j = memory.rows.get("jobs/" + jobId) as Job;
    memory.rows.set("jobs/" + jobId, { ...j, leaseOwner: "replacement-worker" });
    return { prompt: "Late response from the old worker must not overwrite recovery." };
  });
  await execute(jobId);
  process.exitCode = 0;
  expect(memory.rows.has(`jobs/${jobId}/checkpoints/prompt_character_a`)).toBe(false);
  expect(imageGenerate).not.toHaveBeenCalled();
  expect((memory.rows.get("jobs/" + jobId) as Job).leaseOwner).toBe("replacement-worker");
});
