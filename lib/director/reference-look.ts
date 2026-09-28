import references from "./reference-look.json";
import type { ImageRef } from "../providers/vertex";

type CharacterLook = { id: string; name: string; gender?: string; age?: string; material?: string };
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export const referenceLookInstruction = "La ÚLTIMA imagen adjunta es una referencia editorial de diseño FEMENINO, NO un personaje de esta historia. Usa su anatomía orgánica continua, proporciones adultas naturales, rostro atractivo y expresivo, colores vivos y acabado cuidado. Representa exclusivamente a la mujer solicitada con su propia especie, identidad, edad, ropa y accesorios. No copies literalmente el personaje, vestuario, pose ni escenario de la muestra. Conserva la técnica visual elegida: traduce el diseño a 2D o anime cuando corresponda; el ejemplo 3D no reemplaza esa elección. Humanos conservan cabeza y piel humanas; otras especies conservan sus propios rasgos. No dibujes juntas de muñeca, cintura pinzada ni piezas de plástico. La referencia de identidad aprobada del personaje conserva prioridad para rostro e identidad.";

export function femaleReference(character?: CharacterLook) {
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

export function withReferenceLook(prompt: string, refs: ImageRef[], maxRefs: number, character?: CharacterLook) {
  const reference = femaleReference(character);
  if (!reference) return { prompt, refs };
  if (refs.length >= maxRefs) throw new Error("No hay espacio para la referencia visual femenina.");
  const { bytesBase64Encoded, mimeType } = reference;
  return {
    prompt: prompt.replace("The LAST attached reference image is an approved character", "The last identity reference image (before the editorial reference) is an approved character") + "\n\n" + referenceLookInstruction + "\nDIRECCIÓN DE DISEÑO PRIORITARIA: al crear esta ficha, toma de la muestra el lenguaje facial, la relación de tamaño cabeza/cuerpo y las transiciones anatómicas suaves, no solo la paleta. La ficha textual define quién es y qué viste; la muestra define el acabado visual dentro de la técnica elegida. Una descripción textual de material rígido, lacado o plástico no debe convertir a una fruta o humana viva en figura de colección. Ojos grandes y expresivos con párpados suaves, mejillas con volumen, sonrisa o gesto vivo y postura relajada con peso corporal natural. Piel flexible con microtextura sutil y reflejos amplios suaves; ropa de tela con caída y pliegues. Sin pose de maniquí, cuello ensamblado ni brillo uniforme de resina. Respeta la edad específica; no rejuvenezcas a personajes mayores.",
    refs: [...refs, { bytesBase64Encoded, mimeType }],
  };
}
