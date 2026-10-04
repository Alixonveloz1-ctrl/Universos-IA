import { profiles } from "./catalog";

type Selection = { genre: string; subgenre: string; plotType: string; worldSetting?: string };

function worldLock(world = "Mundo real actual") {
  const locks: Record<string, string> = {
    "Mundo real actual": "Presente real reconocible. Usa casas, apartamentos, barrios, carreteras, oficinas, tiendas, restaurantes, playas, parques u otros lugares actuales que la historia necesite. Arquitectura, ropa, vehículos, teléfonos y señalización contemporáneos normales. PROHIBIDO convertir por defecto el presente en megaciudad futurista: sin estética cyberpunk, sin rascacielos de ciencia ficción, sin hologramas y sin neón decorativo dominante. De noche usa farolas, lámparas, escaparates y luces urbanas normales.",
    "Ciudad moderna": "Ciudad contemporánea real, no futurista: edificios, calles, tráfico, comercios y transporte actuales. No cyberpunk, no hologramas, no megaciudad futurista y no neón dominante salvo que una localización concreta lo requiera de forma natural.",
    "Pueblo contemporáneo": "Pueblo actual reconocible: calles pequeñas, viviendas, comercios locales y entorno cotidiano. No metrópolis, no skyline futurista, no cyberpunk y no neón decorativo dominante.",
    "Vida cotidiana": "Entornos cotidianos actuales y plausibles: hogar, trabajo, estudio, compras, cafetería, parque, calle o transporte según la historia. No convertirlo en metrópolis futurista ni añadir neón porque sí.",
    "Isla remota": "ISLA REMOTA VISIBLE Y PROTAGÓNICA. La historia y sus localizaciones deben leerse inequívocamente como una isla aislada: costa, mar abierto, playa/rocas, vegetación insular y horizonte oceánico. Si hay supervivencia o naufragio, muestra restos del naufragio, refugio improvisado y recursos naturales cuando corresponda. Una cueva puede existir solo como localización secundaria causal y debe seguir conectada visual/narrativamente con la isla; nunca sustituye toda la isla. Prohibido reemplazarla por una cueva de cristales, ciudad, metrópolis, cyberpunk, reino mágico o interiores de neón salvo petición explícita del usuario.",
    "Megaciudad futurista": "Megaciudad inequívocamente futurista con infraestructura avanzada y gran escala urbana. La iluminación puede ser tecnológica, pero el neón no es obligatorio ni debe llenar cada superficie.",
    "Cyberpunk": "Ciudad cyberpunk explícita; aquí sí son apropiados anuncios luminosos, tecnología urbana densa y neón cuando ayuden a la escena.",
    "Futuro cercano": "Futuro cercano reconocible derivado del presente: tecnología algo avanzada pero arquitectura y vida todavía plausibles. No convertir automáticamente en cyberpunk ni llenar de neón.",
    "Futuro lejano": "Futuro lejano coherente con la historia. Tecnología y arquitectura avanzadas, pero no asumir cyberpunk o neón salvo que el contexto lo pida.",
  };
  return locks[world] || `MUNDO ELEGIDO: ${world}. El título de esta selección es una restricción literal de ambientación. Construye historia, localizaciones, arquitectura, naturaleza, tecnología, vestuario contextual y fondos para que un espectador pueda reconocer «${world}» sin leer el título. No sustituyas este mundo por una metrópolis futurista/cyberpunk ni añadas luces de neón decorativas salvo que el propio mundo o una escena concreta las requiera.`;
}

export function settingDirection(selection: Selection) {
  const historical = /histórico|de época/i.test(selection.subgenre);
  const speculative = /fantasía|ciencia ficción/i.test(selection.genre) || /fantástico|paranormal|sobrenatural|superhéroes|cósmico/i.test(selection.subgenre) || selection.plotType === "Maldición";
  const { especulativo, ...ordinaryProfiles } = profiles;
  const selectedWorld = selection.worldSetting || "Mundo real actual";
  const base = historical
    ? "Respeta la época histórica seleccionada; no añadas magia o tecnología futurista salvo elección explícita compatible."
    : speculative
      ? "Utiliza únicamente los elementos históricos, fantásticos o de ciencia ficción que exige el género, subgénero, trama o mundo seleccionados. El aspecto de fruta o gema no obliga a añadir otros poderes ni reinos."
      : "Los personajes viven como personas dentro del mundo elegido. Su especie es diseño visual, NO permiso para inventar magia, reinos, profecías, linajes, poderes o tecnología futurista. El tono elegante, oscuro o épico tampoco cambia la época ni el mundo.";
  return {
    profiles: speculative ? profiles : ordinaryProfiles,
    instruction: [
      "AMBIENTACIÓN — EL SELECTOR DE MUNDO ES AUTORITATIVO.",
      `Selección exacta del usuario: «${selectedWorld}».`,
      worldLock(selectedWorld),
      base,
      "FIDELIDAD VISUAL: cada localización de la Biblia y cada toma debe pertenecer claramente a este mundo. El Director no puede reemplazarlo por su ambientación favorita. No usar metrópolis, skyline futurista, cuevas de cristal, carteles luminosos o iluminación neón como decoración genérica cuando no pertenezcan al mundo seleccionado.",
      "LUZ: el estilo visual controla la técnica y calidad de iluminación, NO el tipo de mundo. Cinemático, 3D Viral, Anime o tono oscuro no significan neón. Usa luz natural, solar, lunar, doméstica, práctica o ambiental coherente con el lugar; reserva el neón para Cyberpunk o para una fuente que la historia pida explícitamente.",
      "Mantén esta selección desde las ideas hasta historia, Biblia, localizaciones, guion, imágenes y video.",
    ].join("\n"),
  };
}
