import { describe, expect, it, vi } from "vitest";

const textGenerate = vi.hoisted(() => vi.fn());
vi.mock("../lib/providers/vertex", () => ({ textGenerate }));

import { generateCinematicPlan } from "../lib/cinematic/director";

describe("cinematic plan request", () => {
  it("keeps the large contract in the prompt instead of sending an invalid provider schema", async () => {
    textGenerate.mockResolvedValue({});
    await expect(generateCinematicPlan({
      concept: "They buried my dad alive.",
      durationSeconds: 30,
      language: "English",
      accent: "American",
      models: {
        text: "gemini-3-flash-preview",
        image: "gemini-3.1-flash-image",
        video: "veo-3.1-lite-generate-001",
      },
    })).rejects.toThrow();

    expect(textGenerate).toHaveBeenCalledTimes(2);
    for (const [model, prompt, schema, maxOutputTokens, timeoutMs] of textGenerate.mock.calls) {
      expect(model).toBe("gemini-3-flash-preview");
      expect(prompt).toContain("FORMATO JSON OBLIGATORIO:");
      expect(prompt).toContain('"segments"');
      expect(prompt).toContain("They buried my dad alive.");
      expect(schema).toBeUndefined();
      expect(maxOutputTokens).toBe(32768);
      expect(timeoutMs).toBe(130000);
    }
  });
});
