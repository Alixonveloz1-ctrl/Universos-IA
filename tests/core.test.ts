import { describe, it, expect, vi } from "vitest";
import { randomBytes, scryptSync } from "node:crypto";
import { ideas, plan, validatePlan } from "../lib/schemas";
import {
  createSession,
  validSession,
  verifyPassword,
  verifyAccessPassword,
  sessionCookie,
  originCheck,
  requireSession,
} from "../lib/auth";
import { videoRequest, imageRequest } from "../lib/providers/vertex";
import { prerequisites, affected } from "../lib/continuity/rules";
import { compileVideoPrompt } from "../lib/director";
import { snapshot, b, q } from "./fixtures";
vi.mock("../lib/persistence/google", () => ({
  db: vi.fn(),
  googlePost: vi.fn(),
}));
const action = {
  type: "video" as const,
  expectedRevision: 1,
  targetId: "clip_2",
  requestId: "dddddddd-dddd-4ddd-addd-dddddddddddd",
  instructions: "",
};
describe("Deterministic invariants (no Google calls)", () => {
  it("requires exactly three ideas", () => {
    expect(ideas.safeParse({ ideas: [] }).success).toBe(false);
  });
  it("requires ordered eight by eight, valid shot coverage and speakers", () => {
    expect(validatePlan(q, b).clips).toHaveLength(8);
    const p = structuredClone(q);
    p.clips[0].durationSeconds = 6 as 8;
    expect(plan.safeParse(p).success).toBe(false);
    p.clips[0].durationSeconds = 8;
    p.clips[0].shots[0].start = 1;
    expect(plan.safeParse(p).success).toBe(false);
  });
  it("rejects foreign character IDs", () => {
    const p = structuredClone(q);
    p.clips[0].characterIds = ["other"];
    expect(() => validatePlan(p, b)).toThrow();
  });
  it("blocks video until previous clip approval and observed state", () => {
    const s = snapshot();
    prerequisites(s, action);
    delete s.targets[0].approvedVersionId;
    expect(() => prerequisites(s, action)).toThrow("anterior");
  });
  it("blocks stale revision, missing images and export continuity conflicts", () => {
    const s = snapshot();
    expect(() =>
      prerequisites(s, { ...action, expectedRevision: 0 }),
    ).toThrow();
    s.targets[3].needsReview = true;
    expect(() => prerequisites(s, action)).toThrow();
    expect(() => prerequisites(s, { ...action, type: "finalize" })).toThrow();
  });
  it("marks only actual dependencies; does not mutate versions", () => {
    const s = snapshot();
    expect([...affected(s.targets[1], s.targets, s.assets, "i1")]).toEqual([
      "clip_1",
    ]);
    expect(s.assets[0].id).toBe("v1");
  });
  it("sends observed previous state and verbatim dialogue", () => {
    const s = snapshot();
    s.observed.clip_1 = { location: "Unexpected garden" };
    const prompt = compileVideoPrompt(s, q.clips[1], "");
    expect(prompt).toContain("Unexpected garden");
    expect(prompt).toContain("¿Es tuyo?");
  });
  it("Veo always requests native audio, 8 seconds, one 9:16 result", () => {
    const r = videoRequest(
      "veo-3.1-lite-generate-001",
      "test",
      [{ bytesBase64Encoded: "AA==", mimeType: "image/jpeg" }],
      "initial",
      "gs://test/output/",
    );
    expect(r.parameters).toMatchObject({
      durationSeconds: 8,
      generateAudio: true,
      sampleCount: 1,
      aspectRatio: "9:16",
    });
    expect(r.instances[0]).toHaveProperty("image.mimeType", "image/jpeg");
    expect(() =>
      videoRequest("veo-2.0-generate-001", "test", [], "initial", ""),
    ).toThrow();
    expect(() =>
      videoRequest("veo-3.1-lite-generate-001", "test", [], "references", ""),
    ).toThrow();
  });
  it("attaches image references as bytes and configures 9:16", () => {
    const r = imageRequest("test", [
      { bytesBase64Encoded: "AAA", mimeType: "image/png" },
    ]);
    expect(r.contents[0].parts[1]).toEqual({
      inlineData: { data: "AAA", mimeType: "image/png" },
    });
    expect(r.generationConfig.imageConfig.aspectRatio).toBe("9:16");
  });
});
describe("Access", () => {
  it("validates a password hash and rejects wrong password", () => {
    const salt = randomBytes(12).toString("hex");
    const hash =
      "scrypt:" + salt + ":" + scryptSync("correct", salt, 64).toString("hex");
    expect(verifyPassword("correct", hash)).toBe(true);
    expect(verifyPassword("wrong", hash)).toBe(false);
  });
  it("rejects expired and forged sessions", () => {
    process.env.SESSION_SECRET = "a".repeat(48);
    const token = createSession(1000);
    expect(validSession(token, 2000)).toBe(true);
    expect(validSession(token, 1e12)).toBe(false);
    expect(validSession(token + "x", 2000)).toBe(false);
  });
  it("blocks no-session requests and foreign origins", () => {
    process.env.APP_ORIGIN = "https://example.test";
    expect(() =>
      requireSession(new Request("https://example.test/api/projects")),
    ).toThrow();
    expect(() =>
      originCheck(
        new Request("https://example.test/api/projects", {
          headers: { origin: "https://evil.test" },
        }),
      ),
    ).toThrow();
  });
});
it("REGRESSION alternate storyboard shot invalidates its own video even if not sent as initial image", () => {
  const s = snapshot();
  const second = {
    ...s.targets[1],
    id: "second",
    entityId: "second",
    approvedVersionId: "secondimage",
  };
  s.targets.push(second);
  expect([...affected(second, s.targets, s.assets, "secondimage")]).toEqual([
    "clip_1",
  ]);
});

it("REGRESSION deleting a required target cannot bypass approval guards", () => {
  const s = snapshot();
  s.targets = s.targets.filter((t) => t.id !== "shot_s1");
  expect(() => prerequisites(s, action)).toThrow("imágenes");
  const canonical = snapshot();
  canonical.targets = canonical.targets.filter((t) => t.role !== "character");
  expect(() => prerequisites(canonical, action)).toThrow("canónicas");
});
it("REGRESSION an observed state from another version cannot authorize the next clip", () => {
  const s = snapshot();
  s.observed.clip_1 = { ...(s.observed.clip_1 as object), versionId: "old" };
  expect(() => prerequisites(s, action)).toThrow("observado");
});

it("REGRESSION shot character IDs must also be present in the clip context", () => {
  const p = structuredClone(q);
  p.clips[0].characterIds = [];
  p.clips[0].dialogue = [];
  expect(() => validatePlan(p, b)).toThrow("IDs");
});

it("REGRESSION the default image model cannot silently drop required references", async () => {
  const { imageReferenceIds } = await import("../lib/continuity/rules");
  const s = snapshot();
  s.plan = structuredClone(s.plan!);
  s.plan.clips[0].shots[0].characterIds = ["a", "b", "c"];
  for (const id of ["b", "c"])
    s.targets.push({
      id: "character_" + id,
      entityId: id,
      role: "character",
      kind: "image",
      approvedVersionId: "canonical_" + id,
      needsReview: false,
      instructions: "",
    });
  expect(() => imageReferenceIds(s, s.targets[1])).toThrow("admite 3");
  s.project.models.image = "gemini-3.1-flash-image";
  expect(imageReferenceIds(s, s.targets[1])).toHaveLength(4);
});

it("REGRESSION a replaced proposal list cannot use a dangling story selection", () => {
  const s = snapshot();
  s.project.ideas = s.project.ideas.map((i) => ({ ...i, id: "new_" + i.id }));
  expect(() => prerequisites(s, { ...action, type: "story" })).toThrow(
    "actuales",
  );
});

it("uses the chosen Vercel password and invalidates sessions when it changes", () => {
  vi.stubEnv("SESSION_SECRET", "a".repeat(48));
  vi.stubEnv("APP_PASSWORD", "mi clave elegida");
  vi.stubEnv("APP_PASSWORD_HASH", "obsolete-hash");
  try {
    expect(verifyAccessPassword("mi clave elegida")).toBe(true);
    expect(verifyAccessPassword("otra")).toBe(false);
    const token = createSession(1000);
    expect(validSession(token, 1000 + 29 * 86400000)).toBe(true);
    expect(validSession(token, 1000 + 30 * 86400000)).toBe(false);
    expect(sessionCookie(token)).toContain("Max-Age=2592000");
    expect(sessionCookie(token)).toContain("HttpOnly; Secure; SameSite=Strict");
    vi.stubEnv("APP_PASSWORD", "otra clave elegida");
    expect(validSession(token, 2000)).toBe(false);
  } finally {
    vi.unstubAllEnvs();
  }
});
it("keeps existing hash access when no direct password is configured", () => {
  vi.stubEnv("APP_PASSWORD", "");
  const salt = "test-salt";
  vi.stubEnv(
    "APP_PASSWORD_HASH",
    "scrypt:" + salt + ":" + scryptSync("legacy", salt, 64).toString("hex"),
  );
  try {
    expect(verifyAccessPassword("legacy")).toBe(true);
  } finally {
    vi.unstubAllEnvs();
  }
});
