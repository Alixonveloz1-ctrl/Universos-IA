// SIMULATED Firestore/GCS/Vertex orchestration; real image validation with Sharp.
import { beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import { snapshot } from "./fixtures";
import type { Job } from "../lib/types";
const memory = vi.hoisted(() => ({
  rows: new Map<string, unknown>(),
  files: new Map<string, Buffer>(),
  failAssetCreate: false,
  corruptNextUpload: false,
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
    googleAuth: () => ({ getAccessToken: async () => "test-token" }),
    objectPath: (p: string, v: string, n: string) =>
      `universos-ia/${p}/${v}/${n}`,
    privateObject: (key: string) => ({
      delete: async () => { memory.files.delete(key); },
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
        memory.files.set(key, memory.corruptNextUpload ? Buffer.from("corrupt") : Buffer.from(bytes));
        memory.corruptNextUpload = false;
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
import { textGenerate, imageGenerate, startVideo, pollVideo } from "../lib/providers/vertex";
import { execute, startupCheck } from "../worker/main";
import { jobControl } from "../lib/persistence/projects";
const jobId = "e".repeat(64);
beforeEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  memory.rows.clear();
  memory.files.clear();
  memory.failAssetCreate = false;
  memory.corruptNextUpload = false;
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
  expect(textGenerate).not.toHaveBeenCalled();
  expect(
    [...memory.rows.keys()].filter((k) => k.includes("/assets/")),
  ).toHaveLength(1);
});
it("SIMULATED concurrent Cloud Run dispatches acquire only one lease and paid request", async () => {
  await Promise.all([execute(jobId), execute(jobId)]);
  expect(imageGenerate).toHaveBeenCalledTimes(1);
  expect((memory.rows.get("jobs/" + jobId) as Job).attempts).toBe(1);
});
it("direct image generation calls the image model without an extra text request", async () => {
  expect(await execute(jobId, true)).toBeUndefined();
  expect((memory.rows.get("jobs/" + jobId) as Job).state).toBe("completed");
  expect(imageGenerate).toHaveBeenCalledTimes(1);
  expect(textGenerate).not.toHaveBeenCalled();
  expect((memory.rows.get("jobs/" + jobId) as Job).leaseUntil).toBe(0);
});
it("direct video calls Veo before handing the accepted operation to media processing", async () => {
  vi.stubEnv("GCP_PROJECT_ID", "test-project");
  vi.stubEnv("GCS_OUTPUT_BUCKET", "test-bucket");
  const j = memory.rows.get("jobs/" + jobId) as Job;
  j.type = "video";
  j.targetId = j.snapshot.targets.find(t => t.kind === "video")!.id;
  for (const a of j.snapshot.assets.filter(a => a.kind === "image")) memory.files.set(a.storageObject, Buffer.from("reference"));
  vi.mocked(startVideo).mockReset().mockResolvedValue("projects/test/operations/accepted");
  vi.mocked(pollVideo).mockReset();
  expect(await execute(jobId, true)).toBe("continue");
  const next = await execute(jobId, true);
  expect(next, JSON.stringify((memory.rows.get("jobs/" + jobId) as Job).error)).toBe("cloud");
  expect(startVideo).toHaveBeenCalledTimes(1);
  expect(pollVideo).not.toHaveBeenCalled();
  expect((memory.rows.get("jobs/" + jobId) as Job).checkpoint.operation).toBe("projects/test/operations/accepted");
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
  const job = memory.rows.get("jobs/" + jobId) as Job;
  job.type = "video";
  job.targetId = "clip_1";
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

it("uses the previous chapter's final frame as the first clip's actual image input", async () => {
  const j = memory.rows.get("jobs/" + jobId) as Job;
  vi.stubEnv("GCP_PROJECT_ID", "test-project");
  vi.stubEnv("GCS_OUTPUT_BUCKET", "test-bucket");
  j.type = "video"; j.targetId = "clip_1";
  j.snapshot.plan = structuredClone(j.snapshot.plan!);
  j.snapshot.plan.clips[0].startMode = "previousFrame";
  const last = { ...j.snapshot.assets.find(a => a.id === "v8")!, lastFrameObject: "universos-ia/previous/last.png" };
  j.snapshot.project.previousChapter = { projectId: "previous", exportId: "final", finalState: j.snapshot.observed.clip_8, bible: j.snapshot.bible!, lastClip: last };
  memory.files.set(last.lastFrameObject, Buffer.from("previous chapter frame"));
  memory.rows.set("jobs/" + jobId, j);
  vi.mocked(startVideo).mockReset().mockRejectedValue(new Error("Stop simulated provider before any real video processing"));
  await execute(jobId);
  process.exitCode = 0;
  vi.unstubAllEnvs();
  expect(startVideo, JSON.stringify((memory.rows.get("jobs/" + jobId) as Job).error)).toHaveBeenCalledOnce();
  expect(JSON.stringify(vi.mocked(startVideo).mock.calls[0])).toContain(Buffer.from("previous chapter frame").toString("base64"));
});

it("startup check verifies storage and Firestore without calling generators", async () => {
  vi.mocked(startVideo).mockReset();
  await startupCheck();
  expect(memory.rows.get("system/startupCheck")).toEqual(expect.objectContaining({ status: "ok" }));
  expect(memory.files.size).toBe(0);
  expect(textGenerate).not.toHaveBeenCalled();
  expect(imageGenerate).not.toHaveBeenCalled();
  expect(startVideo).not.toHaveBeenCalled();
});
it("recovers a bad SDK upload through Google's API and verifies the actual stored bytes", async () => {
  memory.corruptNextUpload = true;
  vi.stubEnv("GCP_PROJECT_ID", "alixon-jhan");
  vi.stubEnv("GCS_OUTPUT_BUCKET", "universos_ia");
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (init?.method === "POST") {
      memory.files.set(url.searchParams.get("name")!, Buffer.from(init.body as Uint8Array));
      return new Response("{}", { status: 200 });
    }
    const key = decodeURIComponent(url.pathname.split("/o/")[1]);
    return new Response(new Uint8Array(memory.files.get(key)!), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  await startupCheck();
  expect(memory.files.size).toBe(0);
  expect(memory.rows.get("system/startupCheck")).toEqual(expect.objectContaining({ status: "ok" }));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(imageGenerate).not.toHaveBeenCalled();
});
it("refuses to approve corrupt bytes even when Google's direct API accepts an upload", async () => {
  memory.corruptNextUpload = true;
  vi.stubEnv("GCP_PROJECT_ID", "alixon-jhan");
  vi.stubEnv("GCS_OUTPUT_BUCKET", "universos_ia");
  vi.stubGlobal("fetch", vi.fn(async (_: string | URL, init?: RequestInit) =>
    new Response(init?.method === "POST" ? "{}" : "wrong", { status: 200 })));
  await expect(startupCheck()).rejects.toThrow("Google guardó");
  expect(memory.rows.get("system/startupCheck")).toEqual(expect.objectContaining({ status: "checking" }));
});
it("records a startup capacity failure rather than leaving the job queued forever", async () => {
  memory.rows.set("system/workerSlots", { slots: { another: Date.now() + 60000 } });
  await expect(execute(jobId)).rejects.toThrow("otro trabajo");
  const job = memory.rows.get(`jobs/${jobId}`) as Job;
  expect(job.state).toBe("failed");
  expect(job.error?.code).toBe("CONCURRENCY");
  expect(imageGenerate).not.toHaveBeenCalled();
});

it("uploads Vercel images directly, verifies bytes and does not use the broken SDK upload", async () => {
  vi.stubEnv("VERCEL", "1"); vi.stubEnv("GCP_PROJECT_ID", "test-project"); vi.stubEnv("GCS_OUTPUT_BUCKET", "test-bucket");
  // If the SDK path is used this marker is consumed and writes corrupt data.
  memory.corruptNextUpload = true;
  const request = vi.fn().mockImplementation(async (url: string | URL, options: RequestInit = {}) => {
    const u = new URL(url);
    if (u.pathname.includes("/upload/")) {
      memory.files.set(u.searchParams.get("name")!, Buffer.from(options.body as Uint8Array));
      return Response.json({ size: (options.body as Uint8Array).byteLength });
    }
    const key = decodeURIComponent(u.pathname.split("/o/")[1]);
    return new Response(new Uint8Array(memory.files.get(key)!));
  });
  vi.stubGlobal("fetch", request);
  await execute(jobId, true);
  expect((memory.rows.get("jobs/" + jobId) as Job).state).toBe("completed");
  expect(memory.corruptNextUpload).toBe(true);
  expect(request).toHaveBeenCalledTimes(2);
  expect(imageGenerate).toHaveBeenCalledTimes(1); expect(textGenerate).not.toHaveBeenCalled();
});

it("ends a fruitless text recovery without a paid request and allows an explicit retry", async () => {
  const j = memory.rows.get("jobs/" + jobId) as Job;
  j.type = "ideas";
  j.checkpoint = { pendingCall: "director_0", submitted: true, completedPart: "keep" };
  memory.rows.set("jobs/" + jobId, j);
  await execute(jobId, true);
  let saved = memory.rows.get("jobs/" + jobId) as Job;
  expect(saved.state).toBe("failed");
  expect(saved.error?.code).toBe("TEXT_RESPONSE_LOST");
  expect(saved.checkpoint.pendingCall).toBeNull();
  expect(saved.checkpoint.completedPart).toBe("keep");
  expect(saved.checkpoint.lostTextCalls).toEqual([expect.objectContaining({ key: "director_0", possibleCharge: true })]);
  expect(textGenerate).not.toHaveBeenCalled();
  const result = { ideas: ["one", "two", "three"].map(id => ({ id, title: "A title", synopsis: "A clear conflict and consequence." })) };
  vi.mocked(textGenerate).mockResolvedValue(result);
  await jobControl(jobId, "resume");
  await execute(jobId, true);
  saved = memory.rows.get("jobs/" + jobId) as Job;
  expect(saved.state).toBe("completed");
  expect(textGenerate).toHaveBeenCalledTimes(1);
});

it("recovers a saved text response without declaring it lost or paying again", async () => {
  const j = memory.rows.get("jobs/" + jobId) as Job;
  j.type = "ideas";
  j.checkpoint = { pendingCall: "director_0", submitted: true };
  memory.rows.set("jobs/" + jobId, j);
  const result = { ideas: ["one", "two", "three"].map(id => ({ id, title: "A title", synopsis: "A clear conflict and consequence." })) };
  memory.rows.set(`jobs/${jobId}/checkpoints/director_0`, { value: result });
  await execute(jobId, true);
  expect((memory.rows.get("jobs/" + jobId) as Job).state).toBe("completed");
  expect(textGenerate).not.toHaveBeenCalled();
});
