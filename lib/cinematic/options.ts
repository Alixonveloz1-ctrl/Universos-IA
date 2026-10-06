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
