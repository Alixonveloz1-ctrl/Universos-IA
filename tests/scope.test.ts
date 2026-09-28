import { describe, expect, it, vi } from "vitest";
import type { Firestore } from "@google-cloud/firestore";
import { DATA_ROOT, scopedDatabase } from "../lib/persistence/scope";

describe("application data isolation", () => {
  it("scopes every collection and document, including transactions, away from legacy records", async () => {
    const records = new Map<string, unknown>([["universes/feri", { name: "Feri" }]]);
    const doc = vi.fn((path: string) => ({
      path,
      collection: (name: string) => ({ path: `${path}/${name}` }),
      get: async () => records.get(path),
    }));
    const transaction = { set: (ref: { path: string }, value: unknown) => records.set(ref.path, value) };
    const database = { doc, runTransaction: async (fn: (tx: typeof transaction) => unknown) => fn(transaction), recursiveDelete: async () => {} };
    const app = scopedDatabase(database as unknown as Firestore);
    for (const name of ["universes", "projects", "jobs", "system"])
      expect(app.collection(name).path).toBe(`${DATA_ROOT}/${name}`);
    expect(await app.doc("universes/feri").get()).toBeUndefined();
    await app.runTransaction(async (tx) => { tx.set(app.doc("universes/feri"), { name: "Own universe" }); });
    expect(records.get("universes/feri")).toEqual({ name: "Feri" });
    expect(records.get(`${DATA_ROOT}/universes/feri`)).toEqual({ name: "Own universe" });
    expect(app.doc("projects/p/assets/a").path).toBe(`${DATA_ROOT}/projects/p/assets/a`);
  });
  it("rejects paths that could escape the namespace", () => {
    const app = scopedDatabase({ doc: () => ({}), runTransaction: () => {}, recursiveDelete: async () => {} } as unknown as Firestore & { runTransaction: unknown });
    for (const path of ["../universes/feri", "/universes/feri", "universes//feri"])
      expect(() => app.doc(path)).toThrow();
  });
});
