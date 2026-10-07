import { usesSpeciesHead, type CharacterDesignContext } from "./character-design";
import references from "./reference-look.json";
import type { ImageRef } from "../providers/vertex";

type CharacterLook = { id: string; name: string; gender?: string; age?: string; material?: string };
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export const referenceLookInstruction = "La ÚLTIMA imagen adjunta es una referencia editorial de diseño FEMENINO, NO un personaje de esta historia. Es la guía principal para el ACABADO del personaje: reproduce la calidad de su rostro expresivo, mirada con párpados, mejillas suaves, anatomía adulta continua, piel de aspecto vivo, tela real y luz cálida favorecedora. Usa la ficha de abajo para identidad, especie, edad, colores y prendas concretas: esas características pertenecen al personaje nuevo. La referencia puede inspirar una postura relajada y una atmósfera cotidiana; no reproduzcas su identidad ni copies literalmente su vestuario. Conserva la técnica visual elegida: traduce el diseño a 2D o anime cuando corresponda; el ejemplo 3D no reemplaza esa elección. Humanos conservan cabeza y piel humanas; otras especies conservan sus propios rasgos. La referencia de identidad aprobada del personaje conserva prioridad para rostro e identidad.";

export function femaleReference(character?: CharacterLook, context?: CharacterDesignContext) {
  // These editorial portraits have humanoid skulls; they cannot define species-head anatomy.
  if (usesSpeciesHead(context)) return undefined;
  if (!character || !/\b(mujer|femenin[oa]|female|woman)\b/.test(normalize(character.gender || ""))) return undefined;
  const age = normalize(character.age || "");
  const numbers = age.match(/\d+/g)?.map(Number);
  if (/\b(nina|nino|infantil|adolescente|menor|child|teen)\b/.test(age)) return undefined;
  if (numbers ? Math.min(...numbers) < 18 : !/\b(adulta|adulto|adult|mayor de edad|mediana edad|anciana|tercera edad)\b/.test(age)) return undefined;
  const description = normalize(character.name + " " + (character.material || ""));
  const match = references.find(ref => new RegExp("\\b" + ref.id + "\\b").test(description));
  const hash = Array.from(character.id).reduce((sum, c) => (sum * 31 + c.charCodeAt(0)) >>> 0, 0);
  return match || references[hash % references.length];
}

export function withReferenceLook(prompt: string, refs: ImageRef[], maxRefs: number, character?: CharacterLook, context?: CharacterDesignContext) {
  const reference = femaleReference(character, context);
  if (!reference) return { prompt, refs };
  if (refs.length >= maxRefs) throw new Error("No hay espacio para la referencia visual femenina.");
  const { bytesBase64Encoded, mimeType } = reference;
  return {
    prompt: prompt.replace("The LAST attached reference image is an approved character", "The last identity reference image (before the editorial reference) is an approved character") + "\n\n" + referenceLookInstruction + "\nDIRECCIÓN DE DISEÑO PRIORITARIA: usa la muestra como guía de render, no solo la paleta. Conserva su lenguaje facial, la relación de tamaño cabeza/cuerpo, las transiciones anatómicas suaves, el acabado orgánico de superficies y la iluminación. La ficha textual define quién es y qué viste; la muestra define cómo se ve una protagonista atractiva de esta producción. Ojos grandes y expresivos con párpados suaves, mejillas con volumen, gesto vivo, postura relajada con peso corporal natural. Piel flexible con microtextura sutil y reflejos amplios suaves; ropa de tela con caída y pliegues. Respeta la edad específica; no rejuvenezcas a personajes mayores.",
    refs: [...refs, { bytesBase64Encoded, mimeType }],
  };
}
