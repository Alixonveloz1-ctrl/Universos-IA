// Quality gates added 2026-10-24: block bad dialogue and invented motion
// BEFORE a paid Veo call, instead of generating a rushed or off-plan clip.
import { expect, it } from "vitest";
import { snapshot } from "./fixtures";
import type { Job } from "../lib/types";
import { dialogueProblems } from "../lib/director/speech";
import { motionBeatProblems } from "../lib/director/motion";
import { compileVideoPrompt } from "../lib/director";

it("blocks dialogue that is too dense for natural Spanish delivery", () => {
  const s = structuredClone(snapshot());
  const c = s.plan!.clips[0];
  c.dialogue = [
    { characterId: "a", text: "Yo quiero que me digas ahora mismo toda la verdad completa", intention: "Exigir", start: 0, end: 3 },
  ];
  expect(dialogueProblems(s, c).join(" ")).toContain("demasiado densa");
});

it("blocks dialogue turns with no pause between speakers", () => {
  const s = structuredClone(snapshot());
  s.bible!.characters.push({ ...s.bible!.characters[0], id: "b", name: "Beto" });
  const c = s.plan!.clips[0];
  c.characterIds = ["a", "b"];
  c.dialogue = [
    { characterId: "a", text: "¿Es tuyo?", intention: "Preguntar", start: 0, end: 2 },
    { characterId: "b", text: "Sí, es mío.", intention: "Responder", start: 2, end: 4 },
  ];
  expect(dialogueProblems(s, c).join(" ")).toContain("0,2 s");
});

it("rejects staged motion that invents a character outside the clip cast", () => {
  const s = structuredClone(snapshot());
  s.bible!.characters.push({ ...s.bible!.characters[0], id: "b", name: "Beto" });
  const c = s.plan!.clips[0];
  const j = { snapshot: s } as Job;
  const problems = motionBeatProblems(j, c, [
    "Alba levanta el anillo.",
    "Beto entra en la habitación con una carta nueva.",
    "Alba mira el anillo.",
    "Alba ofrece el anillo.",
  ]);
  expect(problems.join(" ")).toContain("Beto");
});

it("rejects staged motion that copies literal dialogue into a visual beat", () => {
  const s = structuredClone(snapshot());
  const c = s.plan!.clips[0];
  const j = { snapshot: s } as Job;
  const problems = motionBeatProblems(j, c, [
    "Alba levanta el anillo.",
    "Alba dice: ¿Es tuyo?",
    "Alba mira el anillo.",
    "Alba ofrece el anillo.",
  ]);
  expect(problems.join(" ")).toContain("frase literal");
});

it("rejects a final beat that walks a character off screen in the last second", () => {
  const s = structuredClone(snapshot());
  const c = s.plan!.clips[0];
  const j = { snapshot: s } as Job;
  const problems = motionBeatProblems(j, c, [
    "Alba comienza a levantar el anillo.",
    "Alba gira la muñeca hacia la luz.",
    "Alba acerca el anillo a sus ojos.",
    "Alba sale de la habitación caminando hacia la puerta.",
  ]);
  expect(problems.join(" ")).toContain("salir");
});

it("rejects a final beat that leaves the character idle waiting for the cut", () => {
  const s = structuredClone(snapshot());
  const c = s.plan!.clips[0];
  const j = { snapshot: s } as Job;
  const problems = motionBeatProblems(j, c, [
    "Alba comienza a levantar el anillo.",
    "Alba gira la muñeca hacia la luz.",
    "Alba acerca el anillo a sus ojos.",
    "Alba se queda quieto esperando el corte.",
  ]);
  expect(problems.join(" ")).toContain("quieto");
});

it("writes an explicit 7-8s final-second instruction into the Veo prompt", () => {
  const s = structuredClone(snapshot());
  const c = s.plan!.clips[0];
  const prompt = compileVideoPrompt(s, c, "", {
    beats: [
      "Alba comienza a levantar el anillo.",
      "Alba gira la muñeca hacia la luz.",
      "Alba acerca el anillo a sus ojos.",
      "Alba sigue ofreciendo el anillo, mirando al interlocutor.",
    ],
  });
  expect(prompt).toContain("7–8s FINAL SECOND");
  expect(prompt).toContain("MID-ACTION");
  expect(prompt).toContain("No one starts walking toward a door");
});

it("accepts four distinct beats that stay inside the approved clip", () => {
  const s = structuredClone(snapshot());
  const c = s.plan!.clips[0];
  const j = { snapshot: s } as Job;
  expect(motionBeatProblems(j, c, [
    "Alba comienza a levantar el anillo.",
    "Alba gira la muñeca hacia la luz.",
    "Alba acerca el anillo a sus ojos.",
    "Alba afloja los dedos y ofrece el anillo.",
  ])).toHaveLength(0);
});
