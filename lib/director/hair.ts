import { speciesCrownDirection, usesSpeciesHead, type CharacterDesignContext } from "./character-design";

type HairCharacter = { id: string; hair: string };

const looks = [
  "cabellera larga y ondulada de color negro azabache",
  "cabellera abundante de rizos castaños oscuros",
  "cabello largo liso de color rubio dorado",
  "cabello pelirrojo cobrizo con ondas suaves",
  "cabello castaño claro en ondas con volumen",
  "cabello negro rizado con volumen natural",
  "cabello rubio ceniza de corte medio y textura ondulada",
  "cabello castaño oscuro liso y brillante de corte medio",
  "cabello rojizo de rizos sueltos",
  "cabellera negra de textura crespa definida",
  "cabello rubio miel con ondas amplias",
  "cabello castaño de rizos naturales y corte a los hombros",
];

const missingHair = /^(?:no aplica|no tiene(?: cabello| pelo)?|sin (?:cabello|pelo)|ningun[oa]?|calv[oa]|ninguno|none|n\/a|)$/i;

export function hairDirection(projectId: string, characterId: string, existing: string[] = []) {
  const hash = Array.from(`${projectId}:${characterId}`).reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0);
  const start = hash % looks.length;
  const selected = looks.map((_, offset) => looks[(start + offset) % looks.length])
    .find(candidate => !existing.some(hair => hair.toLocaleLowerCase() === candidate.toLocaleLowerCase())) || looks[start];
  return selected;
}

export function renderHair(projectId: string, character: HairCharacter, context?: CharacterDesignContext): string {
  return character.hair?.trim() && !missingHair.test(character.hair.trim())
    ? character.hair
    : usesSpeciesHead(context) ? speciesCrownDirection : hairDirection(projectId, character.id);
}
