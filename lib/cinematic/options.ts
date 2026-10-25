export const CINEMATIC_STYLES = [
  { id: "realistic", label: "Cinemático realista" },
  { id: "anime2d", label: "Anime 2D" },
] as const;

export type CinematicVisualStyle = (typeof CINEMATIC_STYLES)[number]["id"];

export const CINEMATIC_GENRES = [
  { id: "drama", label: "Drama", subgenres: [
    { id: "family", label: "Familiar" }, { id: "betrayal", label: "Traición" },
    { id: "revenge", label: "Venganza" }, { id: "social", label: "Social" },
  ] },
  { id: "romance", label: "Romance", subgenres: [
    { id: "forbidden", label: "Amor prohibido" }, { id: "second-chance", label: "Segunda oportunidad" },
    { id: "love-triangle", label: "Triángulo amoroso" }, { id: "romantic-drama", label: "Drama romántico" },
  ] },
  { id: "thriller", label: "Suspenso", subgenres: [
    { id: "psychological", label: "Psicológico" }, { id: "crime", label: "Crimen" },
    { id: "survival", label: "Supervivencia" }, { id: "conspiracy", label: "Conspiración" },
  ] },
  { id: "mystery", label: "Misterio", subgenres: [
    { id: "family-secret", label: "Secreto familiar" }, { id: "detective", label: "Detectives" },
    { id: "supernatural-mystery", label: "Sobrenatural" }, { id: "disappearance", label: "Desaparición" },
  ] },
  { id: "fantasy", label: "Fantasía", subgenres: [
    { id: "high-fantasy", label: "Fantasía épica" }, { id: "isekai", label: "Otro mundo / isekai" },
    { id: "magic", label: "Magia" }, { id: "dark-fantasy", label: "Fantasía oscura" },
  ] },
  { id: "action", label: "Acción", subgenres: [
    { id: "rescue", label: "Rescate" }, { id: "espionage", label: "Espionaje" },
    { id: "heist", label: "Atraco" }, { id: "pursuit", label: "Persecución" },
  ] },
  { id: "horror", label: "Terror", subgenres: [
    { id: "paranormal", label: "Paranormal" }, { id: "gothic", label: "Gótico" },
    { id: "folk-horror", label: "Folclórico" }, { id: "creature", label: "Criaturas" },
  ] },
  { id: "scifi", label: "Ciencia ficción", subgenres: [
    { id: "dystopia", label: "Distopía" }, { id: "time-travel", label: "Viajes en el tiempo" },
    { id: "artificial-intelligence", label: "Inteligencia artificial" }, { id: "space", label: "Espacial" },
  ] },
  { id: "comedy", label: "Comedia", subgenres: [
    { id: "romantic-comedy", label: "Romántica" }, { id: "situational", label: "Situacional" },
    { id: "satire", label: "Sátira" }, { id: "dark-comedy", label: "Comedia negra" },
  ] },
] as const;

export type CinematicGenre = (typeof CINEMATIC_GENRES)[number]["id"];
export const DEFAULT_CINEMATIC_GENRE: CinematicGenre = "drama";
export const DEFAULT_CINEMATIC_SUBGENRE = "family";

export function cinematicGenre(id: string | undefined) {
  return CINEMATIC_GENRES.find(genre => genre.id === id) || CINEMATIC_GENRES[0];
}

export function cinematicSubgenre(genre: string | undefined, subgenre: string | undefined) {
  const options = cinematicGenre(genre).subgenres;
  return options.find(option => option.id === subgenre) || options[0];
}

export function cinematicStyle(id: string | undefined): CinematicVisualStyle {
  return id === "anime2d" ? "anime2d" : "realistic";
}

export const CINEMATIC_WORLDS = [
  { id: "free", label: "Sin mundo específico (lo decide el Director)", rule: "El Director elige el mundo que mejor sirva a la historia." },
  { id: "apocalypse-ruins", label: "Apocalipsis en ruinas", rule: "Mundo colapsado, supervivientes, criaturas que acechan, refugios improvisados y objetos que protegen, como un traje grueso que resiste mordidas." },
  { id: "abandoned-park", label: "Parque de diversiones abandonado", rule: "Juegos oxidados, cabinas rotas, luces que fallan y un lugar que fue de diversión y ahora es trampa y refugio a la vez." },
  { id: "flooded-city", label: "Ciudad inundada", rule: "Calles bajo agua, edificios a medio hundir, botes y pasarelas, y el agua como obstáculo y como camino." },
  { id: "postwar-desert", label: "Desierto tras la guerra", rule: "Arena, restos de máquinas, escasez de agua y comida, y viajeros que protegen lo poco que tienen." },
  { id: "enchanted-forest", label: "Bosque encantado", rule: "Árboles enormes, niebla, luz que cambia y criaturas que guardan el bosque y sus reglas antiguas." },
  { id: "medieval-kingdom", label: "Reino medieval", rule: "Castillos, aldeas, espadas, gremios y un orden feudal que se rompe por dentro." },
  { id: "cyberpunk-city", label: "Ciudad cyberpunk", rule: "Neón, lluvia, implantes, corporaciones y calles donde la tecnología es poder y también vigilancia." },
  { id: "space-station", label: "Estación espacial", rule: "Gravedad artificial que falla, oxígeno limitado, pasillos metálicos y el vacío afuera como amenaza constante." },
  { id: "underwater-world", label: "Mundo submarino", rule: "Ciudades bajo el mar, luz que se filtra, presión, oxígeno y criaturas de las profundidades." },
  { id: "ice-kingdom", label: "Reino de hielo", rule: "Nieve eterna, hielo que cruje, refugios cálidos y el frío como enemigo que no perdona errores." },
  { id: "shadow-world", label: "Mundo de sombras", rule: "La luz es refugio, las sombras se mueven y esconden cosas, y cruzar de un lado a otro tiene precio." },
  { id: "land-of-giants", label: "Tierra de gigantes", rule: "Todo es enorme para los protagonistas: puertas, herramientas, huellas y peligros a escala gigante." },
  { id: "victorian-fog", label: "Ciudad victoriana de niebla", rule: "Niebla densa, faroles, carruajes, secretos en mansiones y una sociedad que esconde lo que pasa de noche." },
  { id: "ghost-west", label: "Oeste fantasma", rule: "Pueblos vacíos, polvo, trenes detenidos y fantasmas de una frontera que ya no existe." },
  { id: "pirate-island", label: "Isla pirata", rule: "Mar abierto, mapas, tesoros, barcos encallados y códigos de piratas que se rompen." },
  { id: "crystal-world", label: "Mundo de cristal", rule: "Todo refracta luz, el cristal guarda memoria y sonido, y romperse tiene consecuencias visibles." },
  { id: "lost-jungle", label: "Selva perdida", rule: "Vegetación que lo cubre todo, ruinas antiguas, ríos y animales que no se ven hasta que es tarde." },
  { id: "floating-city", label: "Ciudad flotante", rule: "Islas en el cielo, puentes colgantes, caídas al vacío y un orden que depende de mantenerse en el aire." },
  { id: "underworld", label: "Inframundo", rule: "Ríos oscuros, puertas que no se abren dos veces, guardianes y deudas que se pagan con memoria." },
  { id: "mirror-world", label: "Mundo de espejos", rule: "Cada espejo muestra otra versión, cruzar cambia algo en quien cruza, y el reflejo no siempre obedece." },
  { id: "desert-kingdom", label: "Reino del desierto", rule: "Oasis, caravanas, templos enterrados y agua como moneda y como poder." },
  { id: "nocturnal-city", label: "Ciudad que nunca duerme", rule: "Noche permanente, mercados nocturnos, faros y personajes que solo viven de noche." },
  { id: "volcanic-land", label: "Tierra volcánica", rule: "Lava, ceniza, roca negra y refugios que se mueven cuando la tierra tiembla." },
  { id: "sky-archipelago", label: "Archipiélago del cielo", rule: "Islas flotantes conectadas por cables y barcos voladores, con tormentas que separan." },
  { id: "deep-woods", label: "Bosque profundo y oscuro", rule: "Árboles que no dejan pasar la luz, senderos que cambian y criaturas que cazan de noche." },
  { id: "clockwork-city", label: "Ciudad de relojes y engranajes", rule: "Todo funciona con engranajes, el tiempo es visible y romper un mecanismo cambia la ciudad." },
  { id: "dream-city", label: "Ciudad de los sueños", rule: "Los sueños se construyen como lugares, despertar borra parte de lo vivido y dormir es viajar." },
  { id: "war-torn-frontier", label: "Frontera en guerra", rule: "Trincheras, puestos de control, refugiados y decisiones que se toman bajo fuego." },
  { id: "arctic-outpost", label: "Base ártica aislada", rule: "Hielo, tormentas blancas, una base pequeña y algo afuera que no se debe dejar entrar." },
  { id: "jungle-temple", label: "Templo en la selva", rule: "Piedra antigua, trampas, inscripciones y un poder que se despierta al entrar." },
  { id: "ocean-abyss", label: "Abismo oceánico", rule: "Oscuridad total, luces propias, presión y criaturas que solo existen abajo." },
  { id: "nomad-steppe", label: "Estepa nómada", rule: "Caballos, tiendas, migraciones y un pueblo que vive moviéndose con las estaciones." },
  { id: "hidden-valley", label: "Valle escondido", rule: "Un valle que no aparece en mapas, con sus propias reglas, idioma y guardianes." },
  { id: "ruined-castle", label: "Castillo en ruinas", rule: "Torres caídas, pasadizos secretos, fantasmas de una corte y un tesoro que nadie reclama." },
  { id: "neon-harbor", label: "Puerto de neón", rule: "Barcos, muelles, contrabando y luces de neón reflejadas en agua sucia." },
  { id: "storm-plains", label: "Llanuras de tormenta", rule: "Tormentas constantes, relámpagos que marcan el camino y refugios que se levantan rápido." },
  { id: "garden-labyrinth", label: "Jardín laberinto", rule: "Setos altos, caminos que se cierran, estatuas que cambian de lugar y un centro que no se ve." },
  { id: "moon-colony", label: "Colonia lunar", rule: "Gravedad baja, trajes, aire reciclado y la Tierra visible en el cielo como recuerdo." },
  { id: "ancient-empire", label: "Imperio antiguo", rule: "Templos, ejércitos, escribas y un imperio que se cae por dentro mientras finge orden." },
  { id: "witch-village", label: "Aldea de brujas", rule: "Casas con hierbas, mercados de pociones, reglas de trueque y magia que se paga con algo personal." },
] as const;

export type CinematicWorld = (typeof CINEMATIC_WORLDS)[number]["id"];
export const DEFAULT_CINEMATIC_WORLD: CinematicWorld = "free";
export function cinematicWorld(id: string | undefined) {
  return CINEMATIC_WORLDS.find(world => world.id === id) || CINEMATIC_WORLDS[0];
}
