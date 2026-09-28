import references from "./reference-look.json";
import type { ImageRef } from "../providers/vertex";

type CharacterLook = { id: string; name: string; gender?: string; age?: string; material?: string };
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export const referenceLookInstruction = "La ÚLTIMA imagen adjunta es una referencia editorial de diseño FEMENINO, NO un personaje de esta historia. Usa su anatomía orgánica continua, proporciones adultas naturales, rostro atractivo y expresivo, colores vivos y acabado cuidado. Representa exclusivamente a la mujer solicitada con su propia especie, identidad, edad, ropa y accesorios. No copies literalmente el personaje, vestuario, pose ni escenario de la muestra. Conserva la técnica visual elegida: traduce el diseño a 2D o anime cuando corresponda; el ejemplo 3D no reemplaza esa elección. Humanos conservan cabeza y piel humanas; otras especies conservan sus propios rasgos. No dibujes juntas de muñeca, cintura pinzada ni piezas de plástico. La referencia de identidad aprobada del personaje conserva prioridad para rostro e identidad.";

export function femaleReference(character?: CharacterLook) {
  if (!character || !/\b(mujer|femenin[oa]|female|woman)\b/.test(normalize(character.gender || ""))) return undefined;
  const age = normalize(character.age || "");
  const number = age.match(/\d+/);
  if (number ? Number(number[0]) < 18 : !/\b(adulta|adulto|adult|mayor de edad)\b/.test(age)) return undefined;
  const description = normalize(character.name + " " + (character.material || ""));
  const match = references.find(ref => new RegExp("\\b" + ref.id + "\\b").test(description));
  const hash = Array.from(character.id).reduce((sum, c) => (sum * 31 + c.charCodeAt(0)) >>> 0, 0);
  return match || references[hash % references.length];
}

export function withReferenceLook(prompt: string, refs: ImageRef[], maxRefs: number, character?: CharacterLook) {
  const reference = femaleReference(character);
  if (!reference) return { prompt, refs };
  if (refs.length >= maxRefs) throw new Error("No hay espacio para la referencia visual femenina.");
  const { bytesBase64Encoded, mimeType } = reference;
  return {
    prompt: prompt.replace("The LAST attached reference image is an approved character", "The last identity reference image (before the editorial reference) is an approved character") + "\n\n" + referenceLookInstruction,
    refs: [...refs, { bytesBase64Encoded, mimeType }],
  };
}
