export type CharacterDesignContext = { beings: string; characterDesign?: string };

// Cristal is the legacy name used by existing mineral universes.
const selectableFamilies = ["Frutas", "Verduras", "Diamantes y minerales", "Cristal", "Objetos", "Insectos"];

export function designContext(project: { universeSnapshot: { beings: string }; characterDesign?: string }): CharacterDesignContext {
  return { beings: project.universeSnapshot.beings, characterDesign: project.characterDesign };
}

export function usesSpeciesHead(context?: CharacterDesignContext): boolean {
  return !!context && selectableFamilies.includes(context.beings) && context.characterDesign === "Cabeza de especie/material";
}

export const speciesCrownDirection = "Corona natural de la especie/material: cáliz, hojas, tallo, facetas, antenas o acabado propio del objeto según su ficha. El cabello humano es opcional; la forma completa de la cabeza debe permanecer reconocible.";

export function headDesignPlanDirection(context?: CharacterDesignContext): string {
  if (context && !selectableFamilies.includes(context.beings))
    return `DISEÑO DE CABEZA: la categoría ${context.beings} conserva su anatomía natural y sus fichas aprobadas; el selector de cabeza de especie/material no se aplica a esta categoría.`;
  if (!usesSpeciesHead(context))
    return "DISEÑO DE CABEZA — 100% HUMANOIDE: cabeza, cráneo, rostro y cabello humanoides. La especie/material se reconoce en la superficie, color, textura y rasgos sutiles; conserva el diseño humanoide aprobado.";
  return [
    "DISEÑO DE CABEZA — CABEZA DE ESPECIE/MATERIAL: cuerpo adulto humanoide proporcionado y vestido; la cabeza ENTERA tiene el volumen y contorno de la fruta, verdura, mineral, objeto o insecto concreto. Debe reconocerse la especie por la silueta incluso en una miniatura, no solo por color o semillas sobre una cara humana.",
    "Ejemplos de forma, solo para la especie correspondiente: fresa con volumen de fresa completo, parte superior ancha, punta inferior, semillas y cáliz de hojas; piña con cuerpo ovalado, patrón de cáscara y corona de hojas; mango con contorno ovalado asimétrico y tallo/hojas cuando corresponda. Una taza conserva su forma y asa, una zanahoria su forma cónica y hojas, un mineral sus facetas. No mezcles estos rasgos entre especies.",
    "Integra ojos, cejas y boca expresivos EN esa forma sin sustituirla por un cráneo humano pintado ni colocar una máscara de fruta sobre un rostro humano. Se permite una cabeza moderadamente ampliada para expresar emociones y leer su forma, manteniendo cuerpo y proporciones inequívocamente adultos y estables.",
    speciesCrownDirection + " En hair describe la corona natural o el cabello realmente elegido; no añadas una peluca humana obligatoria. Si se diseña cabello, no tapa el contorno, hojas ni rasgos que identifican la especie. Conserva literalmente el diseño de personajes ya aprobados.",
  ].join("\n");
}

export function headDesignDirection(context: CharacterDesignContext): string {
  if (!selectableFamilies.includes(context.beings))
    return `CHARACTER DESIGN LOCK: preserve the natural anatomy of the selected ${context.beings} family and the approved individual identity. The species/material-head selector does not override this category.`;
  if (!usesSpeciesHead(context))
    return "CHARACTER DESIGN LOCK: 100% HUMANOID HEAD. Keep a fully humanoid head and face, skull and hairstyle. Express the selected species/material through the body's surface, color, texture and appropriate subtle traits only; do not reshape the head into the species/material.";
  return "CHARACTER DESIGN LOCK: SPECIES/MATERIAL HEAD. The ENTIRE head has the complete recognizable three-dimensional volume and outer silhouette of that character's specific fruit, vegetable, mineral, object or insect, with expressive eyes, brows and mouth integrated INTO that form. A strawberry head has a broad top, tapered lower tip, seeds and leafy calyx; a pineapple head has an oval rind body and leafy crown; a mango head has an asymmetric oval mango contour. Use only the traits of the actual species. Do not substitute a human skull painted with fruit colors, a fruit mask, fruit-shaped hair or a fruit helmet over a human face. The species must be readable from the silhouette at thumbnail size. Keep an attractive, clothed, adult humanoid body with natural joints; a moderately enlarged expressive species head is allowed with stable adult proportions, never a giant head on a tiny childlike body. Natural leaves, calyx, stem, facets or species-specific crown may occupy the top of the head; human hair is OPTIONAL, never compulsory. If approved hair exists, preserve it without hiding the recognizable species contour. Adapt the same complete head architecture to the chosen visual technique. Approved own-character reference images retain identity priority: never silently redesign an existing approved character inside a shot or video.";
}
