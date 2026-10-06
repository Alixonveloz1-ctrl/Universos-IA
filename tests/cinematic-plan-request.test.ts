import { describe, expect, it, vi } from "vitest";
import { AppError } from "../lib/errors";

const textGenerate = vi.hoisted(() => vi.fn());
vi.mock("../lib/providers/vertex", () => ({ textGenerate }));

import { generateCinematicPlan } from "../lib/cinematic/director";

describe("cinematic plan request", () => {
  it("sends only a compact provider schema and reports invalid generated content", async () => {
    textGenerate.mockReset();
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
      expect(prompt).not.toContain("FORMATO JSON OBLIGATORIO:");
      expect(prompt).toContain("They buried my dad alive.");
      expect(schema.properties).toHaveProperty("segments");
      expect(schema.required).toContain("characters");
      expect(JSON.stringify(schema)).not.toMatch(/minLength|maxLength|pattern|additionalProperties|anyOf|const/);
      expect(maxOutputTokens).toBe(32768);
      expect(timeoutMs).toBe(130000);
    }
  });

  it("falls back to JSON mode only when Google explicitly rejects the compact schema", async () => {
    textGenerate.mockReset();
    textGenerate.mockRejectedValueOnce(new AppError("PROVIDER_REJECTED", "Google respondió 400. Request contains an invalid argument.", 502));
    textGenerate.mockResolvedValue({});
    await expect(generateCinematicPlan({
      concept: "They buried my dad alive.", durationSeconds: 30, language: "English", accent: "American",
      models: { text: "gemini-3-flash-preview", image: "gemini-3.1-flash-image", video: "veo-3.1-lite-generate-001" },
    })).rejects.toThrow("plan incompleto");
    expect(textGenerate).toHaveBeenCalledTimes(3);
    expect(textGenerate.mock.calls[0][2]).toBeDefined();
    expect(textGenerate.mock.calls[1][2]).toBeUndefined();
    expect(textGenerate.mock.calls[1][1]).toContain("FORMATO JSON OBLIGATORIO:");
    expect(textGenerate.mock.calls[2][2]).toBeUndefined();
  });
});
