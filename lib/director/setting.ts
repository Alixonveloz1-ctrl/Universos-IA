import { profiles } from './catalog';

type Selection = { genre: string; subgenre: string; plotType: string };
export function settingDirection(selection: Selection) {
  const historical = /histórico|de época/i.test(selection.subgenre);
  const speculative = /fantasía|ciencia ficción/i.test(selection.genre) || /fantástico|paranormal|sobrenatural|superhéroes|cósmico/i.test(selection.subgenre) || selection.plotType === 'Maldición';
  const { especulativo, ...ordinaryProfiles } = profiles;
  return {
    profiles: speculative ? profiles : ordinaryProfiles,
    instruction: historical
      ? 'AMBIENTACIÓN: respeta la época histórica seleccionada; no añadas magia o tecnología futurista salvo elección explícita compatible.'
      : speculative
        ? 'AMBIENTACIÓN: utiliza únicamente los elementos históricos, fantásticos o de ciencia ficción que exige el género, subgénero o trama seleccionados. El aspecto de fruta o gema no obliga a añadir otros poderes ni reinos.'
        : 'AMBIENTACIÓN POR DEFECTO: presente contemporáneo cotidiano, con vida social, ropa, lugares y tecnología actuales. Los personajes de frutas, gemas u otros tipos viven como personas: casa, universidad, trabajo, barrio, cafetería, pareja, familia y amistades. Su especie es diseño visual, NO un género narrativo ni un motivo para inventar magia, reinos, profecías, linajes, poderes, tecnología futurista o leyes biológicas especiales. El conflicto debe entenderse en la vida real: celos, infidelidad, traición, rivalidad o el tipo de trama elegido. No convertir a protagonistas en herederas, princesas o aristócratas por defecto. Si se elige Herencia, resolverla como una herencia familiar actual, sin monarquías. Tono elegante, oscuro o épico no cambia la época. worldRules describe solo condiciones cotidianas necesarias para esa historia; no necesita reglas sobrenaturales. En las tres propuestas varía protagonistas, situaciones y lugares sin abandonar el presente. Mantén esta ambientación en historia, Biblia, ropa, escenarios y plan.',
  };
}
