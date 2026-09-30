import { z } from "zod";
import { plan, validatePlan, type Plan } from "../schemas";
import type { Job, Snapshot } from "../types";
import { validateChapterPlan } from "../continuity/chapters";
import { AppError } from "../errors";
import { textGenerate } from "../providers/vertex";

type Row = Record<string, unknown>;
const row = (value: unknown): value is Row => value !== null && typeof value === "object" && !Array.isArray(value);
export type PlanIssue = { path: string; code: string; message: string };

// Only normalize unambiguous serialization details. Never invent missing
// actions, characters, words, scenes, timings or ending states.
export function prepareGeneratedPlan(value: unknown): unknown {
  let decoded = value;
  if (row(decoded) && typeof decoded.invalidJsonText === "string") decoded = decoded.invalidJsonText;
  if (typeof decoded === "string") {
    const match = decoded.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    decoded = JSON.parse(match ? match[1] : decoded);
  }
  let copy: unknown = structuredClone(decoded);
  // Accept the common harmless wrapper {"plan":{"clips":[...]}} and ignore
  // explanatory siblings. The durable schema itself is still strict.
  if (row(copy) && row(copy.plan) && Array.isArray(copy.plan.clips)) copy = structuredClone(copy.plan);
  if (!row(copy) || !Array.isArray(copy.clips)) return copy;
  // The plan root contains only clips. Providers sometimes append summary,
  // notes, metadata or other explanatory fields despite the JSON contract.
  copy = { clips: copy.clips };
  const numberFields = (target: Row, keys: string[]) => {
    for (const key of keys) {
      const value = target[key];
      if (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim())) target[key] = Number(value);
    }
  };
  for (let i = 0; i < copy.clips.length; i++) {
    const clip: unknown = copy.clips[i];
    if (!row(clip)) continue;
    numberFields(clip, ["number", "durationSeconds"]);
    if (Array.isArray(clip.dialogue)) {
      for (const turn of clip.dialogue) if (row(turn)) numberFields(turn, ["start", "end"]);
    }
    if (Array.isArray(clip.shots)) {
      for (const shot of clip.shots) {
        if (!row(shot)) continue;
        numberFields(shot, ["start", "end"]);
        // Spoken lines live in clip.dialogue. Omitting the deliberately empty
        // legacy shot field does not make a complete dialogue plan invalid.
        if (shot.dialogue === undefined && Array.isArray(clip.dialogue)) shot.dialogue = "";
      }
    }
    const previous: unknown = i > 0 ? copy.clips[i - 1] : null;
    if (row(previous) && row(previous.plannedEndState)) {
      clip.continuityIn = structuredClone(previous.plannedEndState);
    }
  }
  return copy;
}

class PlanIssues extends Error {
  constructor(public issues: PlanIssue[]) { super("Guion inválido"); }
}

export function validateGeneratedPlan(value: unknown, snapshot: Snapshot): Plan {
  if (!snapshot.bible) throw new PlanIssues([{ path: "bible", code: "missing", message: "Falta la biblia de este trabajo." }]);
  const prepared = prepareGeneratedPlan(value);
  if (!row(prepared) || !Array.isArray(prepared.clips)) return plan.parse(prepared);
  const characterIds = new Set(snapshot.bible.characters.map(ch => ch.id));
  const characterByName = new Map(snapshot.bible.characters.map(ch => [ch.name.trim().toLocaleLowerCase(), ch.id]));
  const locationIds = new Set(snapshot.bible.locations.map(loc => loc.id));
  const locationByName = new Map(snapshot.bible.locations.map(loc => [loc.name.trim().toLocaleLowerCase(), loc.id]));
  const resolveCharacter = (value: unknown) => {
    if (typeof value !== "string") return value;
    if (characterIds.has(value)) return value;
    return characterByName.get(value.trim().toLocaleLowerCase()) || value;
  };
  const resolveLocation = (value: unknown) => {
    if (typeof value !== "string") return value;
    if (locationIds.has(value)) return value;
    return locationByName.get(value.trim().toLocaleLowerCase()) || value;
  };
  const stateKeys = new Set(["location","note","characters"]);
  const stateCharacterKeys = new Set(["characterId","posture","emotion","knowledge","heldObjects","wardrobe","damage","lastAction","nextAction"]);
  const cleanState = (value: unknown) => {
    if (!row(value)) return value;
    const state = Object.fromEntries(Object.entries(value).filter(([k]) => stateKeys.has(k))) as Row;
    if (typeof state.location === "string") state.location = String(resolveLocation(state.location));
    if (Array.isArray(state.characters)) state.characters = state.characters.map(item => {
      if (!row(item)) return item;
      const cleaned = Object.fromEntries(Object.entries(item).filter(([k]) => stateCharacterKeys.has(k))) as Row;
      cleaned.characterId = resolveCharacter(cleaned.characterId);
      return cleaned;
    });
    return state;
  };
  const clipKeys = new Set(["number","durationSeconds","goal","continuityIn","plannedEndState","characterIds","locationId","shots","dialogue","soundDirection","startMode","constraints"]);
  const shotKeys = new Set(["id","start","end","framing","action","characterIds","locationId","dialogue"]);
  const dialogueKeys = new Set(["characterId","text","intention","start","end"]);
  const soundKeys = new Set(["ambience","effects","music"]);
  const normalized = {
    clips: prepared.clips.map(rawClip => {
      if (!row(rawClip)) return rawClip;
      const clip = Object.fromEntries(Object.entries(rawClip).filter(([k]) => clipKeys.has(k))) as Row;
      let cast = Array.isArray(clip.characterIds) ? clip.characterIds.map(resolveCharacter) : [];
      if (Array.isArray(clip.dialogue)) clip.dialogue = clip.dialogue.map(turn => {
        if (!row(turn)) return turn;
        const d = Object.fromEntries(Object.entries(turn).filter(([k]) => dialogueKeys.has(k))) as Row;
        d.characterId = resolveCharacter(d.characterId ?? turn.speaker ?? turn.speakerId ?? turn.character ?? turn.name);
        if (typeof d.characterId === "string" && characterIds.has(d.characterId) && !cast.includes(d.characterId)) cast.push(d.characterId);
        return d;
      });
      clip.characterIds = cast;
      clip.locationId = resolveLocation(clip.locationId);
      clip.continuityIn = cleanState(clip.continuityIn);
      clip.plannedEndState = cleanState(clip.plannedEndState);
      if (Array.isArray(clip.shots)) clip.shots = clip.shots.map(rawShot => {
        if (!row(rawShot)) return rawShot;
        const sh = Object.fromEntries(Object.entries(rawShot).filter(([k]) => shotKeys.has(k))) as Row;
        sh.locationId = resolveLocation(sh.locationId);
        if (Array.isArray(sh.characterIds)) sh.characterIds = sh.characterIds.map(resolveCharacter);
        return sh;
      });
      if (row(clip.soundDirection)) clip.soundDirection = Object.fromEntries(Object.entries(clip.soundDirection).filter(([k]) => soundKeys.has(k)));
      return clip;
    }),
  };
  const parsed = plan.parse(normalized);
  const chars = new Set(snapshot.bible.characters.map(c => c.id));
  const locations = new Set(snapshot.bible.locations.map(l => l.id));
  const issues: PlanIssue[] = [];
  const unknownId = (path: string) => issues.push({ path, code: "unknown_id", message: "El identificador no pertenece a la biblia o al reparto de este clip." });
  for (const [i, clip] of parsed.clips.entries()) {
    if (!locations.has(clip.locationId)) unknownId(`clips[${i}].locationId`);
    clip.characterIds.forEach((id, k) => { if (!chars.has(id)) unknownId(`clips[${i}].characterIds[${k}]`); });
    clip.shots.forEach((shot, k) => {
      if (!locations.has(shot.locationId)) unknownId(`clips[${i}].shots[${k}].locationId`);
      shot.characterIds.forEach((id, m) => { if (!chars.has(id) || !clip.characterIds.includes(id)) unknownId(`clips[${i}].shots[${k}].characterIds[${m}]`); });
    });
    for (const field of ["continuityIn", "plannedEndState"] as const) {
      clip[field].characters.forEach((character, k) => { if (!chars.has(character.characterId)) unknownId(`clips[${i}].${field}.characters[${k}].characterId`); });
    }
  }
  if (issues.length) throw new PlanIssues(issues);
  const validated = validatePlan(parsed, snapshot.bible, !!snapshot.project.previousChapter);
  validateChapterPlan(snapshot.project, validated);
  // validatePlan may share object references across the handoff. The durable
  // result remains detached from both the raw response and the caller's data.
  return structuredClone(validated);
}

export function planIssues(error: unknown): PlanIssue[] {
  if (error instanceof PlanIssues) return error.issues.slice(0, 8);
  if (error instanceof z.ZodError) return error.issues.slice(0, 8).map(issue => ({
    path: issue.path.reduce<string>((path, key) => typeof key === "number" ? `${path}[${key}]` : `${path}${path ? "." : ""}${String(key).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80)}`, "") || "plan",
    code: issue.code,
    // Zod messages may contain received content. Log only constraints and
    // field paths, never a raw model response, story, prompt or credential.
    message: issue.code === "invalid_type" ? `Tipo incorrecto; se esperaba ${"expected" in issue ? String(issue.expected) : "otro tipo"}.`
      : issue.code === "too_small" ? "Faltan elementos o el valor está por debajo del mínimo."
      : issue.code === "too_big" ? "El valor supera el máximo permitido."
      : issue.code === "unrecognized_keys" ? "Hay campos no contemplados en el esquema."
      : issue.code === "custom" ? issue.message.slice(0, 180)
      : "El valor no cumple el formato o las opciones permitidas.",
  }));
  if (error instanceof SyntaxError) return [{ path: "plan", code: "json_syntax", message: "La respuesta no contiene un JSON completo y válido." }];
  const message = error instanceof Error ? error.message : "";
  if (message === "El primer clip no tiene fotograma previo") return [{ path: "clips[0].startMode", code: "previous_frame", message }];
  if (message.includes("estado final observado del capítulo anterior")) return [{ path: "clips[0].continuityIn", code: "chapter_handoff", message: "El inicio no coincide con el estado final del capítulo anterior." }];
  return [{ path: "plan", code: "validation", message: "No se pudo validar la estructura del guion." }];
}

export const planDraftKeys = (checkpoint: Record<string, unknown>) => Object.keys(checkpoint)
  .filter(key => /^director_\d+$/.test(key)).sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)));
export const describePlanIssues = (issues: PlanIssue[]) => issues.map(issue => `${issue.path}: ${issue.message}`).join(" ").slice(0, 1400);

// One shared plan pipeline for EVERY selected genre and visual style. Same
// provider, model, checkpoints, two-attempt budget and caller's lease guards.
export async function runPlan(
  j: Job,
  promptFor: (repair?: string) => string,
  beforeCall: (key: string) => Promise<void>,
  checkpoint: (key: string, value: unknown) => Promise<void>,
): Promise<Plan> {
  for (const key of planDraftKeys(j.checkpoint)) {
    try { return validateGeneratedPlan(j.checkpoint[key], j.snapshot); }
    catch { /* An invalid saved draft still needs the existing bounded repair. */ }
  }
  let failure = "";
  const retry = Number(j.checkpoint.narrativeRetry || 0);
  if (!Number.isSafeInteger(retry) || retry < 0) throw new AppError("DIRECTOR_JSON", "El contador de reparación del guion es inválido.", 422);
  const maxAttempts = 2 * (retry + 1);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const key = `director_${attempt}`;
    let result = j.checkpoint[key];
    if (!result) {
      await beforeCall(key);
      result = await textGenerate(
        j.snapshot.project.models.text,
        `${promptFor(failure)}\n\nFormato JSON obligatorio: ${JSON.stringify(z.toJSONSchema(plan))}\nLos tiempos start/end son números locales de 0 a 8. Conserva los ocho clips y todos los diálogos. shots[].dialogue es una cadena vacía cuando el diálogo ya está en clip.dialogue.\n${attempt ? `Borrador a corregir: ${JSON.stringify(j.checkpoint[`director_${attempt - 1}`])}` : ""}`,
        undefined,
        32768,
      );
      // Preserve the received output verbatim for diagnostics and recovery.
      await checkpoint(key, result);
    }
    try { return validateGeneratedPlan(result, j.snapshot); }
    catch (error) {
      const issues = planIssues(error);
      failure = describePlanIssues(issues);
      await checkpoint(`director_validation_${attempt}`, { draftKey: key, issues });
      console.warn("director_plan_validation", { jobId: j.id, draftKey: key, issues });
      if (attempt === maxAttempts - 1) {
        throw new AppError("DIRECTOR_JSON", `El Director no pudo completar el guion. ${failure}`, 502);
      }
    }
  }
  throw new AppError("DIRECTOR_JSON", "No se obtuvo un guion válido.", 502);
}
