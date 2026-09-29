import { TELENOVELA_STYLE } from "./styles";

export const genres: Record<string, string[]> = {
  "Melodrama / telenovela": ["Familiar", "Romántico", "Social", "Absurdo", "De época", "De intriga", "De venganza", "Juvenil"],
  Romance: ["Contemporáneo", "Fantástico", "Dramático", "Histórico", "Comedia romántica", "Paranormal", "Aventura romántica", "Segundas oportunidades"],
  Drama: ["Familiar", "Psicológico", "Social", "Romántico", "Histórico", "Judicial", "Médico", "Deportivo", "Político", "De superación"],
  Comedia: ["Absurda", "Romántica", "Negra", "De enredos", "Satírica", "Costumbrista", "De aventuras", "Parodia"],
  Suspenso: ["Psicológico", "Doméstico", "Supervivencia", "Policial", "Judicial", "Político", "De espionaje", "Tecnológico"],
  Misterio: ["Detectivesco", "Íntimo", "Sobrenatural", "Criminal", "Histórico", "De habitación cerrada", "De desapariciones", "De conspiraciones"],
  Fantasía: ["Urbana", "Oscura", "De reinos", "Épica", "Mitológica", "De cuentos de hadas", "Portal a otro mundo", "De aventuras"],
  Terror: ["Psicológico", "Sobrenatural", "De criaturas", "Gótico", "Cósmico", "Folclórico", "De supervivencia", "De casas encantadas"],
  "Ciencia ficción": ["Distópica", "Social", "Tecnológica", "Espacial", "Ciberpunk", "Viajes en el tiempo", "Primer contacto", "Posapocalíptica", "Biotecnológica"],
  Acción: ["Aventura", "Escape", "Rescate", "Artes marciales", "Espionaje", "Policial", "Superhéroes", "De supervivencia"],
};
export const plots = [
  "Secreto familiar",
  "Herencia",
  "Traición",
  "Amor prohibido",
  "Triángulo",
  "Reencuentro",
  "Sacrificio",
  "Ambición",
  "Redención",
  "Equívoco",
  "Inversión de roles",
  "Rivalidad",
  "Chantaje",
  "Encierro",
  "Cuenta atrás",
  "Identidad oculta",
  "Desaparición",
  "Prueba falsa",
  "Pacto",
  "Maldición",
  "Sucesión",
  "Intrusión",
  "Pérdida de control",
  "Acecho",
  "Memoria alterada",
  "Sustitución",
  "Rebelión",
  "Persecución",
  "Protección",
  "Venganza",
  "Celos",
  "Ascenso y caída",
  "Secreto",
  "Doble vida",
  "Manipulación",
  "Error de identidad",
  "Poder",
  "Pérdida y reparación",
];
export const tones = [
  "Emocional",
  "Oscuro",
  "Elegante",
  "Absurdo",
  "Romántico",
  "Tenso",
  "Misterioso",
  "Cómico",
  "Épico",
];
export const endings = ["Resolución", "Giro final", "Cliffhanger"];
export const beings = [
  "Frutas", "Verduras", "Diamantes y minerales", "Humanos", "Animales",
  "Objetos", "Robots", "Antropomorfos", "Insectos", "Ángeles",
];
export const styles = [
  "3D Viral Estilizado", "Cinemático Épico", "Anime 2D", "Realista",
];
export const worlds = [
  "Mundo real actual", "Ciudad moderna", "Pueblo contemporáneo", "Vida cotidiana",
  "Instituto / universidad", "Mundo corporativo", "Alta sociedad",
  "Época antigua", "Antigua Roma", "Antiguo Egipto", "Grecia antigua", "Edad Media",
  "Renacimiento", "Era victoriana", "Oeste salvaje", "Años 1920", "Años 1950", "Años 1980",
  "Futuro cercano", "Futuro lejano", "Megaciudad futurista", "Cyberpunk", "Solarpunk", "Steampunk",
  "Ciencia ficción", "Colonias espaciales", "Nave espacial", "Planeta alienígena",
  "Distopía", "Utopía", "Posapocalíptico", "Apocalipsis zombi", "Mundo devastado",
  "Fantasía medieval", "Alta fantasía", "Fantasía urbana", "Fantasía oscura",
  "Reino mágico", "Academia de magia", "Mundo de dioses y mitología",
  "Cielo / reino angelical", "Inframundo", "Mundo sobrenatural", "Gótico",
  "Isekai / otro mundo", "Videojuego / mundo virtual", "Realidad simulada",
  "Universo paralelo", "Viaje en el tiempo", "Mundo submarino", "Isla remota",
  "Selva fantástica", "Desierto fantástico", "Mundo helado", "Personalizado por el concepto",
];
export const profiles = {
  romance:
    "Deseo, obstáculo, decisión con costo. Diálogo con subtexto; evitar declaración que repita la imagen.",
  secreto:
    "Señal inicial, versiones incompatibles, revelación que cambia una relación. No resolver con información nunca planteada.",
  venganza:
    "Injusticia, respuesta y precio personal. El desenlace debe resultar de una elección.",
  misterio:
    "Pregunta, pista visible, reinterpretación y resolución o amenaza concreta. Evitar azar como solución.",
  comedia:
    "Expectativa, escalada del equívoco, remate con consecuencia. Evitar explicar el chiste.",
  especulativo:
    "Regla del mundo, consecuencia y elección personal. Evitar exposición que sustituya la acción.",
};
