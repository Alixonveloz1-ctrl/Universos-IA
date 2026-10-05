import type { Clip } from "../schemas";
import type { Snapshot } from "../types";

export const SPEECH_PLAN_DIRECTION = [
  "DIRECCIÓN DE DIÁLOGO: español hablado natural, oraciones completas y idiomáticas, con tildes, signos de interrogación y puntuación correctos. No habla telegráfica, palabras aisladas ni sílabas separadas artificialmente.",
  "Cada intervención pertenece exclusivamente a su characterId y a la voz canónica de ese personaje. Conserva el idioma y acento seleccionados. Es diálogo pronunciado en cámara por el personaje visible, no narración ni voz en off. Quien escucha reacciona con ojos, cejas y postura, sin articular las palabras del otro.",
  "Planifica turnos sin solapamiento, con una pequeña pausa natural al cambiar de hablante y tiempo para terminar la última palabra antes del final del clip. Prefiere una intervención breve o un intercambio de dos intervenciones cuando sea necesario; no recortes la gramática para hacerlas caber. Reparte el intercambio entre los clips existentes cuando no quepa, sin añadir clips.",
  "Las ventanas de diálogo contienen frases enteras, no pulsos de dos segundos ni tiempos por palabra. Usa aproximadamente 2–3 palabras por segundo como orientación editorial, no como metrónomo ni garantía de duración. Reserva tiempo para respiración, puntuación y reacción.",
  "Escribe el texto literal SOLO en clip.dialogue[].text; shots[].dialogue queda vacío y shots[].action describe únicamente actuación visual. No copies las frases en goal, action, estados, música ni efectos. La actuación puede cambiar emoción e intensidad, pero nunca la identidad vocal, acento o hablante.",
  "SUBTEXTO OBLIGATORIO: desire, fear, secret, intention, nextAction, planes internos y objetivos ocultos son notas para el Director, NO frases pronunciables. El personaje jamás dice literalmente su estrategia oculta, ambición secreta, manipulación, seducción calculada, engaño o traición al interlocutor salvo que la historia aprobada marque una confesión/revelación explícita en ese momento. Expresa lo oculto mediante elección de palabras plausible, evasión, cumplido, pregunta, silencio, mirada, postura o acción.",
  "PRUEBA DE VOZ ALTA: antes de aceptar cada línea, comprueba si una persona real con ese objetivo la diría literalmente frente a ese interlocutor. Si la frase expone información que intenta ocultar, reescríbela como subtexto. Evita diálogo de sinopsis o guionista: «mi ambición», «mi plan», «quiero seducirte/manipularte», explicaciones de motivación y frases que cuentan al otro lo que el público debe inferir.",
  "EXPRESIVIDAD DE CORTO VIRAL: diálogo breve, coloquial y con personalidad. Favorece interrupciones naturales, preguntas directas, dobles sentidos, réplicas, silencios incómodos, cambios de mirada y reacciones visibles cuando encajen. Cada clip debe tener una emoción legible y una intención de actuación concreta; evita parlamentos ceremoniosos, genéricos, literarios o explicativos. La energía nace del conflicto y de la reacción, no de añadir exposición.",
  "APROVECHA LOS 8 SEGUNDOS: no diseñes un clip con una frase de 1–3 segundos seguida de varios segundos mirando al vacío. Cuando haya diálogo, usa normalmente 5–7 segundos del clip para una frase sustancial o un intercambio natural, dejando solo pausas breves para respiración/reacción. Si el conflicto funciona mejor sin hablar durante un momento, ese silencio debe contener una acción/reacción narrativa concreta que cambie la situación, no espera pasiva.",
  "DENSIDAD SIN PRISA: apunta aproximadamente a 10–18 palabras habladas por clip cuando sea natural y quepan con dicción clara; puede haber menos si existe una acción narrativa fuerte. No rellenes con exposición ni aceleres la voz. Cada intervención debe aportar presión, información nueva, provocación, decisión, mentira, amenaza, deseo, réplica o consecuencia.",
  "CONFLICTO DESDE EL PRIMER SEGUNDO: el clip 1 no presenta tranquilamente el mundo ni explica antecedentes. Empieza cuando el problema YA está ocurriendo: acusación, descubrimiento, provocación, situación vergonzosa, tentación, ultimátum, mentira a punto de caer, entrada que altera la escena o acción que exige reacción inmediata. Los antecedentes se infieren después mediante subtexto y consecuencias.",
].join("\n");

// This is a writing heuristic, not a measurement of generated speech.
export function dialogueWarnings(c: Clip): string[] {
  return c.dialogue.flatMap((d, i) => {
    const words = d.text.trim().split(/\s+/u).filter(Boolean).length;
    const seconds = d.end - d.start;
    return seconds > 0 && words / seconds > 3
      ? [`Clip ${c.number}, intervención ${i + 1}: ${words} palabras en ${seconds.toFixed(1)} s; puede faltar tiempo para una dicción natural y sus pausas.`]
      : [];
  });
}

export function dialogueProblems(s: Snapshot, c: Clip): string[] {
  const problems: string[] = [];
  const turns = [...c.dialogue].sort((a, b) => a.start - b.start);
  for (let i = 0; i < turns.length; i++) {
    const d = turns[i];
    if (!c.characterIds.includes(d.characterId) || !s.bible?.characters.some(x => x.id === d.characterId))
      problems.push(`Clip ${c.number}: el hablante ${d.characterId} no corresponde a un personaje presente.`);
    if (!d.text.trim() || !Number.isFinite(d.start) || !Number.isFinite(d.end) || d.start < 0 || d.end > 8 || d.end <= d.start)
      problems.push(`Clip ${c.number}: revisa el texto y los tiempos de la intervención ${i + 1}.`);
    if (i > 0 && d.start < turns[i - 1].end - 0.001)
      problems.push(`Clip ${c.number}: turnos de diálogo superpuestos.`);
  }
  return problems;
}

function normalizedSpeechTurns(c: Clip) {
  return [...c.dialogue].sort((a, b) => a.start - b.start);
}

// Old plans sometimes repeat literal dialogue in action or shot fields. Keep
// those fields as visual direction, with one authoritative spoken script.
export function withoutDialogue(text: string, c: Clip): string {
  let result = text;
  const lines = [...new Set(c.dialogue.map(d => d.text.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  for (const line of lines) {
    const escaped = line.split(/\s+/u).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
    // Boundaries avoid replacing a short line inside an unrelated word.
    result = result.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "gu"), "[dialogue in the speech schedule]");
  }
  return result;
}

function useful(value?: string) {
  const normalized = (value || "").trim();
  return /^(?:no aplica|no tiene|sin especificar|no especificado|n\/a)$/iu.test(normalized) ? "" : normalized;
}

export function speakerDescription(s: Snapshot, characterId: string) {
  const c = s.bible?.characters.find(x => x.id === characterId);
  if (!c) return `${characterId} (identity missing from the Bible)`;
  // Do not infer screen position, gender or voice from array order or species.
  const identity = [useful(c.gender), useful(c.age), useful(c.material), useful(c.color), useful(c.hair), useful(c.wardrobe)]
    .filter(Boolean).join("; ");
  return `${c.name} [speaker_${c.id}] (${identity})`;
}

export function speechDirection(s: Snapshot, c: Clip) {
  const turns = normalizedSpeechTurns(c);
  const cast = c.characterIds.map(id => s.bible?.characters.find(x => x.id === id)).filter(x => !!x);
  // Only characters who actually speak in this clip receive a voice
  // specification. Silent visible characters get reaction/mouth instructions
  // below, but no competing voice profile for Veo to accidentally assign.
  const speakingIds = [...new Set(turns.map(turn => turn.characterId))];
  const voices = speakingIds.flatMap(characterId => {
    const character = s.bible?.characters.find(x => x.id === characterId);
    if (!character) return [];
    const v = character.voice;
    return [`${speakerDescription(s, character.id)}. CANONICAL VOICE FOR THIS CHARACTER — reuse this same baseline whenever this character speaks in any clip: gender ${useful(character.gender)}; perceived age ${useful(character.age)}; language ${s.project.language}; accent ${s.project.accent}; timbre ${v.timbre}; register ${v.register}; base rhythm ${v.rhythm}; base energy ${v.energy}; diction ${v.diction}; baseline expression ${v.expression}. Keep timbre, register, perceived age, accent, base cadence and vocal identity as close as possible to this same profile across clips. Scene emotion may alter intensity or pace slightly, but must not create a different voice.`];
  });
  const schedule: string[] = [];
  let previousEnd = 0;
  for (const [i, d] of turns.entries()) {
    if (d.start > previousEnd)
      schedule.push(`${previousEnd}-${d.start}s: no speech; natural breathing and silent reactions, with the approved ambience.`);
    const speaker = s.bible?.characters.find(x => x.id === d.characterId);
    const listeners = cast.filter(x => x.id !== d.characterId).map(x => `${x.name} [speaker_${x.id}]`).join(", ");
    schedule.push(
      `${d.start}-${d.end}s — turn ${i + 1}. ${speaker?.name || d.characterId} [speaker_${d.characterId}] is the ONLY audible speaker and the ONLY mouth articulating speech. Delivery intention: ${withoutDialogue(d.intention, c)}. ${listeners ? `${listeners} listen silently, with relaxed mouths; they do not mouth or repeat this line.` : ""}\n${speaker?.name || d.characterId} says the ENTIRE line, including any opening name/vocative, in ${s.project.language}, with the selected ${s.project.accent} accent. The first audible phoneme is already this speaker: ${d.text}`,
    );
    previousEnd = Math.max(previousEnd, d.end);
  }
  if (previousEnd < 8)
    schedule.push(`${previousEnd}-8s: no speech; let the final expression and the approved ambience continue naturally.`);
  return [
    "ON-CAMERA SPEECH — the only spoken script in this clip.",
    `Language: ${s.project.language}. Accent: ${s.project.accent}. Keep this selected accent throughout, including when an older voice card names a different accent. Preserve every word, accent mark and punctuation in the script; never translate it.`,
    "Match each named speaker to the visible character in the initial image by their own identity, hair and clothing, NOT by cast order or by whichever mouth happens to move. The image determines the actual positions. Keep each voice attached to that same character for the entire clip and across clips; never swap, blend or duplicate voices. Gender, age and the character's own voice card identify the performance, not the fruit name or another cast member.",
    "Audio is diegetic speech coming from the visible speaking character, with natural synchronized lip, jaw and facial articulation to the actual Spanish phonemes. SPEAKER OWNERSHIP IS HARD: during each scheduled line, ONLY that named speaker may open/shape the mouth into speech phonemes; every other visible character keeps lips closed or naturally relaxed and may react only with eyes, eyebrows, head and posture. Never animate a listener's lips to another character's voice. Never attach the speaker's audio to another face. The speaker looks at the visible interlocutor. No narrator, voice-over, off-screen substitute, dubbing-like detached voice, extra speech or vocal music.",
    "TURN-START VOICE LOCK: the FIRST audible phoneme, syllable and word of every scheduled turn belong to that turn's named speaker and MUST already use that speaker's canonical voice. Never let a listener, previous/next speaker, narrator or alternate voice pronounce the addressee's name or the opening word before handing the sentence to the correct speaker. A vocative at the start (for example «Mateo, ...») is part of the SAME speaker's line, not a cue for Mateo to speak. Voice identity may change ONLY at an explicit boundary between two separate scheduled dialogue turns.",
    "NO PRE-ROLL SPEECH: immediately before a turn begins, all non-speakers are silent. Do not generate an anticipatory word, echoed name, pickup syllable, call-out, vocal reaction or lead-in in another character's voice. Start the named speaker's audio cleanly at the scheduled turn and keep that same voice through the final word.",
    "Speak in complete conversational phrases with idiomatic Spanish word stress, connected words, clear vowels and consonants, and natural question/exclamation intonation. Commas allow a short breath and sentence endings a natural pause. Do not chant, spell, syllabify, flatten the intonation, pause after every word, rush or stretch words to fill time. Emotion changes delivery, not identity or accent. A rhythm or diction descriptor in a voice card never overrides these natural-phrase rules or authorizes broken grammar.",
    "Each time window is ONE complete speech turn. Speak the line once across its window; do not restart it at visual timing boundaries or synchronize syllables to two-second beats. A short line may finish early: use the remaining time for silence and reaction, not slower robotic speech. Finish the last word before the clip ends. Direction labels, IDs and timestamps are silent instructions, never spoken or rendered as subtitles.",
    "VOICE BINDINGS FOR SPEAKERS IN THIS CLIP ONLY:\n" + voices.map(line => withoutDialogue(line, c)).join("\n"),
    "SPEECH SCHEDULE:\n" + schedule.join("\n\n"),
  ].join("\n\n");
}
