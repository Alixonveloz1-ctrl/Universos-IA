import { it, expect, vi, afterEach } from "vitest";
import { continuationToken, validContinuation } from "../lib/direct-token";
afterEach(() => vi.unstubAllEnvs());
it("binds a continuation to a single job, step and short expiry", () => {
  vi.stubEnv("SESSION_SECRET", "unit-test-secret-for-direct-continuations");
  const token = continuationToken("a".repeat(64), 3);
  expect(validContinuation(token, "a".repeat(64), 3)).toBe(true);
  expect(validContinuation(token, "b".repeat(64), 3)).toBe(false);
  expect(validContinuation(token, "a".repeat(64), 4)).toBe(false);
  expect(validContinuation(continuationToken("a".repeat(64), 3, Date.now() - 1), "a".repeat(64), 3)).toBe(false);
  expect(validContinuation("bad", "a".repeat(64), 3)).toBe(false);
});
