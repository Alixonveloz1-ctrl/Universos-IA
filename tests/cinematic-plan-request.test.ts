import { describe, expect, it, vi } from "vitest";
import { AppError } from "../lib/errors";

const textGenerate = vi.hoisted(() => vi.fn());
vi.mock("../lib/providers/vertex", () => ({ textGenerate }));

import { generateCinematicPlan } from "../lib/cinematic/director";
import { cinematicProjectInput } from "../lib/cinematic/schema";

describe("cinematic plan request", () => {
  it("sends only a compact provider schema and reports invalid generated content", async () => {
    textGenerate.mockReset();
    textGenerate.mockResolvedValue({});
    await expect(generateCinematicPlan(cinematicProjectInput.parse({
      concept: "They buried my dad alive.",
      durationSeconds: 30,
      language: "English",
      accent: "American",
      models: {
        text: "gemini-3-flash-preview",
        image: "gemini-3.1-flash-image",
        video: "veo-3.1-lite-generate-001",
      },
    }))).rejects.toThrow();

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
    await expect(generateCinematicPlan(cinematicProjectInput.parse({
      concept: "They buried my dad alive.", durationSeconds: 30, language: "English", accent: "American",
      models: { text: "gemini-3-flash-preview", image: "gemini-3.1-flash-image", video: "veo-3.1-lite-generate-001" },
    }))).rejects.toThrow("plan incompleto");
    expect(textGenerate).toHaveBeenCalledTimes(3);
    expect(textGenerate.mock.calls[0][2]).toBeDefined();
    expect(textGenerate.mock.calls[1][2]).toBeUndefined();
    expect(textGenerate.mock.calls[1][1]).toContain("FORMATO JSON OBLIGATORIO:");
    expect(textGenerate.mock.calls[2][2]).toBeUndefined();
  });

  it("lets the Director invent another anime story from genre and subgenre when concept is blank", async () => {
    textGenerate.mockReset();
    textGenerate.mockResolvedValue({});
    const input = cinematicProjectInput.parse({
      concept: "", visualStyle: "anime2d", genre: "fantasy", subgenre: "isekai",
      durationSeconds: 30, language: "Español", accent: "Latinoamericano",
      models: { text: "gemini-3-flash-preview", image: "gemini-3.1-flash-image", video: "veo-3.1-lite-generate-001" },
    });
    await expect(generateCinematicPlan(input, {
      title: "Historia anterior", premise: "Un héroe descubre un portal", hook: "Portal",
      ending: "Regresa", characters: [], segments: [],
    } as never)).rejects.toThrow("plan incompleto");
    const prompt = textGenerate.mock.calls[0][1] as string;
    expect(prompt).toContain("Anime 2D dibujado");
    expect(prompt).toContain("Fantasía");
    expect(prompt).toContain("Otro mundo / isekai");
    expect(prompt).toContain("TRAMA LIBRE");
    expect(prompt).toContain("NUEVA TRAMA");
    expect(prompt).toContain("Historia anterior");
    expect(prompt).not.toContain("PREMIUM PHOTOREALISTIC");
  });

  it("keeps the written concept authoritative even when it conflicts with the selected genre", async () => {
    textGenerate.mockReset();
    textGenerate.mockResolvedValue({});
    const input = cinematicProjectInput.parse({
      concept: "Un detective busca a su hermana desaparecida.", visualStyle: "realistic",
      genre: "comedy", subgenre: "satire", durationSeconds: 30, language: "Español",
      accent: "Latinoamericano",
      models: { text: "gemini-3-flash-preview", image: "gemini-3.1-flash-image", video: "veo-3.1-lite-generate-001" },
    });
    await expect(generateCinematicPlan(input)).rejects.toThrow("plan incompleto");
    const prompt = textGenerate.mock.calls[0][1] as string;
    expect(prompt).toContain("CONCEPTO DEL USUARIO — AUTORIDAD NARRATIVA: Un detective busca a su hermana desaparecida.");
    expect(prompt).toContain("concepto escrito por el usuario MANDA");
    expect(prompt).not.toContain("TRAMA LIBRE");
  });
});
