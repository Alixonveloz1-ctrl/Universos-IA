import { z } from "zod";
import { bible, character, location, id } from "../schemas";
import { textGenerate } from "../providers/vertex";
import { validateChapterBible } from "../continuity/chapters";
import { AppError } from "../errors";
import type { Job } from "../types";

// Keep Google's response schema small; enforce length limits and canon locally.
export function compactSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !["$schema", "minLength", "maxLength", "pattern", "minItems", "maxItems", "additionalProperties"].includes(key),
  ).map(([key, child]) => [key, compactSchema(child)]));
}
const outline = z.object({
  characters: z.array(z.object({ id, name: z.string().min(1), role: z.string().min(1), gender: z.string().min(1).optional(), age: z.string().min(1).optional() })).min(1).max(12),
  locations: z.array(z.object({ id, name: z.string().min(1) })).min(1).max(12),
  props: bible.shape.props,
  relationships: bible.shape.relationships,
  lockedTraits: bible.shape.lockedTraits,
}).refine(v => new Set(v.characters.map(c => c.id)).size === v.characters.length &&
  new Set(v.locations.map(l => l.id)).size === v.locations.length, "IDs duplicados");

export async function buildBible(j: Job, prompt: string,
  before: (key: string) => Promise<void>, save: (key: string, value: unknown) => Promise<void>) {
  const legacy = j.checkpoint.director_1 || j.checkpoint.director_0;
  const old = bible.safeParse(legacy);
  if (old.success) { validateChapterBible(j.snapshot.project, old.data); return old.data; }
  const round = Number(j.checkpoint.narrativeRetry || 0);
  async function part<T>(name: string, schema: z.ZodType<T>, instruction: string): Promise<T> {
    let previous: unknown;
    let errors = "";
    for (let attempt = 0; attempt < 2 * (round + 1); attempt++) {
      const key = `bible_${name}_${attempt}`;
      let value = j.checkpoint[key];
      if (!value) {
        await before(key);
        value = await textGenerate(j.snapshot.project.models.text,
          `${prompt}\n\n${instruction}\nTodos los campos de texto deben ser cadenas; usa 'No aplica' para pelo, ropa u otros rasgos que no existan. IDs solo con letras sin acentos, números, guiones o guiones bajos. Descripciones concretas y breves (máximo 1000 caracteres por rasgo). Para personajes nuevos, gender usa mujer, hombre, no binario o no especificado; age expresa la edad en años cuando se conozca o una etapa vital explícita como adulta, adolescente o niña. No omitas estos campos. En frutas y humanos, material y texture describen piel viva flexible, microtextura orgánica y reflejos suaves, nunca resina, plástico, porcelana, lacado ni cuerpo rígido. face describe ojos expresivos, párpados suaves, mejillas y gesto vivo; silhouette describe anatomía natural continua. Evita lenguaje de estatuilla o producto de colección en todos los campos, incluidos lockedTraits. Gemas y robots mantienen su material propio. El vestuario define ropa de tela con caída y pliegues, no un cuerpo moldeado.` +
          (attempt ? `\nCorrige ESTE resultado sin cambiar identidades: ${JSON.stringify(previous)}\nErrores exactos: ${errors}` : ""),
          compactSchema(z.toJSONSchema(schema)));
        await save(key, value);
      }
      const parsed = schema.safeParse(value);
      if (parsed.success) return parsed.data;
      previous = value;
      errors = parsed.error.issues.map(e => `${e.path.join(".")}: ${e.message}`).join("; ").slice(0,4000);
    }
    throw new AppError("DIRECTOR_JSON", `No se pudo completar ${name === "outline" ? "la lista de personajes y escenarios" : "una ficha de la Biblia"}. Reanudar volverá a pedir solo la parte fallida. Detalle: ${errors.slice(0,500)}`, 502);
  }
  const previousBible = j.snapshot.project.previousChapter?.bible;
  const list = await part("outline", outline,
    "Devuelve únicamente la lista de personajes (id, nombre, papel, gender y age), escenarios (id y nombre), objetos, relaciones y rasgos fijos de la historia APROBADA. No desarrolles todavía las fichas. Conserva los IDs previos si este es otro capítulo. gender identifica el género del personaje (mujer, hombre, no binario o no especificado), no el género narrativo. age indica edad o etapa vital. Derívalos de la historia aprobada, nunca del nombre de la fruta ni de su profesión. Si la historia dice mujer, esposa, madre o hermana, no la conviertas en hombre. Conserva estos datos en todas sus fichas.");
  const characters = [];
  for (const entry of list.characters) {
    const prior = previousBible?.characters.find(c => c.id === entry.id);
    const hasSavedCard = Object.keys(j.checkpoint).some(key => key.startsWith(`bible_character_${entry.id}_`));
    const cardSchema = (hasSavedCard ? character : character.required({ gender: true, age: true })).extend({
      id: z.literal(entry.id), name: z.literal(entry.name),
      ...(entry.gender ? { gender: z.literal(entry.gender) } : {}),
      ...(entry.age ? { age: z.literal(entry.age) } : {}),
    });
    characters.push(prior || await part(`character_${entry.id}`, cardSchema,
      `Completa SOLO la ficha del personaje ${JSON.stringify(entry)}. Contexto del reparto: ${JSON.stringify(list)}. Incluye gender y age explícitos, coherentes con la historia aprobada y el papel; conserva exactamente los de la lista. Rostro, silueta y voz deben corresponder a ESA identidad. No inventes que una mujer es hombre por llevar traje, tener poder o antagonizar. Incluye todos los campos de voz en español con el idioma y acento elegidos. visualPrompt describe únicamente UN retrato de cuerpo completo de ESTE personaje, una sola vista sobre fondo neutro, sin otros personajes ni escenas, viñetas o collage. Mantén la dirección visual compartida del universo en todas las fichas; no inventes otra técnica de render para cada personaje.`));
  }
  const locations = [];
  for (const entry of list.locations) {
    const prior = previousBible?.locations.find(l => l.id === entry.id);
    locations.push(prior || await part(`location_${entry.id}`, location.extend({ id: z.literal(entry.id), name: z.literal(entry.name) }),
      `Completa SOLO la ficha del escenario ${JSON.stringify(entry)}. Contexto: ${JSON.stringify(list)}.`));
  }
  // Earlier chapter entities remain immutable even when absent from this episode.
  for (const c of previousBible?.characters || []) if (!characters.some(x => x.id === c.id)) characters.push(c);
  for (const l of previousBible?.locations || []) if (!locations.some(x => x.id === l.id)) locations.push(l);
  const result = bible.parse({ ...list, characters, locations });
  validateChapterBible(j.snapshot.project, result);
  return result;
}
