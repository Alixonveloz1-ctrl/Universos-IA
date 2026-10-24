import { z } from "zod";
import type { Clip } from "../schemas";
import type { Job, Snapshot, Target } from "../types";
import { textGenerate } from "../providers/vertex";
import { AppError } from "../errors";
import { withoutDialogue } from "./speech";

const motion = z.object({ beats: z.array(z.string().trim().min(1).max(1200)).length(4) });
export type Motion = z.infer<typeof motion>;
export const MOTION_PLAN_DIRECTION = "ACTUACIÓN TEMPORAL CONCRETA: escribe exactamente cuatro elementos en shots por clip, con tiempos 0–2, 2–4, 4–6 y 6–8. Son fases de UNA toma continua y solo el primero tiene imagen; no son cortes ni cuatro videos. En cada action escribe quién realiza qué movimiento visible, cómo responde el interlocutor y qué cambia respecto al tramo anterior. El tercer y cuarto tramo deben continuar el intercambio o acción pendiente con un paso concreto, no 'se queda quieto', 'mantiene la pose', 'espera', 'mira' sin evolución o 'reacciona hasta terminar'. Conserva una sola acción causal del guion, desarróllala a velocidad natural durante los ocho segundos y no la resuelvas en la primera mitad para posar después. No añadas caminata de salida, baile, celebración o pantomima para rellenar. CORTE A MITAD DE ACCIÓN: el cuarto tramo (6–8s) termina a mitad de una acción en curso, con todos los personajes dentro del encuadre y anclados —sentados, de pie con los pies fijos, sosteniendo un objeto o mirando al interlocutor— y debe decir explícitamente qué sigue pasando en 7–8s. Nunca termina con una acción ya completada, con nadie empezando a caminar hacia una puerta, una salida o el borde del encuadre, ni con nadie quieto esperando el corte. Si partir es realmente parte del guion, deja solo el gesto de partir en este clip; la salida completa pertenece al siguiente clip, no a este.";

export function motionStates(s: Snapshot, c: Clip) {
  const previous = s.targets.find(t => t.role === "clip" && t.clipNumber === c.number - 1);
  const incoming = previous ? s.observed[previous.id] || c.continuityIn : s.project.previousChapter?.finalState || c.continuityIn;
  const physical = (value: unknown) => {
    const state = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return {
      location: state.location,
      characters: Array.isArray(state.characters) ? state.characters.filter(ch => ch && typeof ch === "object" && c.characterIds.includes(ch.characterId)).map(ch => ({ characterId: ch.characterId, posture: ch.posture, emotion: ch.emotion, heldObjects: ch.heldObjects, damage: ch.damage })) : [],
    };
  };
  return { incoming: physical(incoming), ending: physical(c.plannedEndState) };
}

export const FINAL_SECOND_EXIT_PATTERN = /\b(salir|saliendo|sale|se va|se marcha|abandona|abandonando|alej[aá]ndose|camina fuera|cruza la puerta|hacia la salida|fuera del encuadre|fuera de pantalla|deja el lugar|leaves? (?:the )?frame|walks? off|walks? away|exits?|leaving the frame)\b/iu;
export const FINAL_SECOND_IDLE_PATTERN = /\b(se queda quieto|se detiene|espera sin|pose de espera|mira al vac[ií]o|queda inm[oó]vil|congela|freeze|idle pose|waits? silently)\b/iu;

// The last second is where Veo, left with a finished action, invents its
// own ending: characters stop, then walk off screen. A clip is joined to
// the next clip's separate opening image, so a completed exit on screen
// can never match the next clip: the next image shows the same people
// back in the same place. The only safe final state is a mid-action,
// anchored state inside the frame: the departure, if the story needs one,
// is hinted as a gesture, never completed on screen in this clip.
export function finalSecondProblems(c: Clip, beats: string[]): string[] {
  if (!beats.length) return [];
  const last = beats[beats.length - 1];
  const problems: string[] = [];
  if (FINAL_SECOND_EXIT_PATTERN.test(last))
    problems.push("El último tramo hace salir a un personaje de pantalla; el clip debe cortarse a mitad de una acción en curso, con todos dentro del encuadre. Si la historia necesita una salida, deja solo el gesto de partir y completa la salida en el siguiente clip.");
  if (FINAL_SECOND_IDLE_PATTERN.test(last))
    problems.push("El último tramo deja al personaje quieto o en pose de espera; el último segundo debe tener una acción o reacción en curso, no un vacío que Veo rellene saliendo de pantalla.");
  void c;
  return problems;
}

export function motionBeatProblems(j: Job, c: Clip, beats: string[]): string[] {
  const problems: string[] = [];
  if (beats.length !== 4) problems.push("La actuación debe tener exactamente cuatro tramos.");
  const seen = new Set<string>();
  for (const beat of beats) {
    const normalized = beat.trim().toLocaleLowerCase();
    if (!normalized) problems.push("Un tramo de actuación está vacío.");
    else if (seen.has(normalized)) problems.push("Dos tramos de actuación repiten la misma acción.");
    seen.add(normalized);
  }
  // Staged motion must be a phase of the approved action, never a new shot,
  // character, object or event. If the staging model invents a participant,
  // the video will not match the approved plan or the opening image.
  const castIds = new Set(c.characterIds);
  const castNames = new Set(
    c.characterIds.map((id) => j.snapshot.bible?.characters.find((ch) => ch.id === id)?.name).filter((name): name is string => !!name),
  );
  for (const character of j.snapshot.bible?.characters || []) {
    if (!castIds.has(character.id) && beats.some((beat) => new RegExp(`(?<![\\p{L}\\p{N}])${character.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu").test(beat)))
      problems.push(`Un tramo menciona a ${character.name}, que no participa en este clip.`);
  }
  for (const line of c.dialogue.map((d) => d.text.trim()).filter(Boolean)) {
    if (beats.some((beat) => beat.includes(line)))
      problems.push("Un tramo copia una frase literal del diálogo; los beats solo describen actuación visual.");
  }
  problems.push(...finalSecondProblems(c, beats));
  void castNames;
  return problems;
}

export function plannedMotion(c: Clip): Motion | null {
  if (c.shots.length !== 4 || c.shots.some((sh, i) => sh.start !== i * 2 || sh.end !== (i + 1) * 2)) return null;
  const beats = c.shots.map(sh => withoutDialogue(sh.action, c).trim());
  if (new Set(beats).size !== 4) return null;
  const parsed = motion.safeParse({ beats });
  return parsed.success ? parsed.data : null;
}

// Old approved plans stay intact. Only the staging is expanded; the compiler
// supplies the unchanged canonical dialogue, cast, audio and continuity.
export async function prepareMotion(j: Job, target: Target, c: Clip,
  beforeCall: (key: string) => Promise<void>, checkpoint: (key: string, value: unknown) => Promise<void>): Promise<Motion> {
  const key = `motion_${target.id}_v2`;
  const saved = motion.safeParse(j.checkpoint[key]);
  if (saved.success) return saved.data;
  const explicit = plannedMotion(c);
  if (explicit && !(j.instructions || target.instructions).trim()) return explicit;
  const direction = [
    "Eres el Director de actuación de UNA toma continua de 8 segundos a partir de una imagen inicial aprobada. Devuelve solo {beats:[cuatro cadenas]}; los índices significan 0–2, 2–4, 4–6 y 6–8 segundos.",
    "Da instrucciones positivas, breves y filmables de movimiento: actor, gesto o acción y respuesta del otro. Conserva la acción aprobada y su orden; distribuye preparación, desarrollo y respuesta a velocidad natural durante todo el clip. Cada tramo avanza desde el anterior, no repite el evento. Cada beat es una fase de la acción aprobada en shots, NO una escena nueva, un corte, un cambio de lugar ni un hecho nuevo: no introduzcas personajes, objetos, lugares ni acontecimientos que no estén en el guion aprobado. Desarrolla el diálogo o interacción existente hasta el corte; la segunda mitad no es una pose de espera. No inventes otro acontecimiento para llenar tiempo.",
    "Los personajes, sus rostros, ropa, objetos y escenario ya existen en la imagen. No los redescribas ni inventes participantes, objetos, transformaciones, fenómenos ni decoraciones. Todos permanecen visibles con cámara estable o seguimiento corto si la acción requiere desplazarse. No añadas salida de pantalla, habitación vacía, baile o pantomima; el humor se interpreta con diálogo y gestos plausibles. La petición explícita del usuario dirige la actuación.",
    "Los diálogos aprobados solo sirven para entender causa y reacción: NO copies ni reformules las frases en beats, no añadas habla ni narres el guion. Los campos knowledge, secret, nextAction y la intención interna no son diálogo ni autorización para anticipar el clip siguiente. El cuarto beat (6–8s) NO es una acción terminal: es una acción en curso que se corta a mitad en el segundo 8, con los personajes anclados dentro del encuadre, y debe incluir explícitamente lo que sigue pasando en 7–8s. Nunca escribas en el cuarto beat una salida, una caminata hacia una puerta o el borde, una acción ya terminada ni una pose de espera.",
    JSON.stringify({
      cast: c.characterIds.map(id => ({ id, name: j.snapshot.bible?.characters.find(ch => ch.id === id)?.name || id })),
      goal: c.goal,
      approvedAction: c.shots.map(sh => ({ start: sh.start, end: sh.end, action: withoutDialogue(sh.action, c) })),
      dialogue: c.dialogue,
      ...motionStates(j.snapshot, c),
      instructions: j.instructions || target.instructions,
    }),
  ].join("\n\n");
  let beatProblems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const callKey = attempt ? `${key}_repair` : key;
    if (!j.checkpoint[callKey]) {
      await beforeCall(callKey);
      const repair = attempt
        ? `\n\nCorrige únicamente estos problemas, sin cambiar la acción aprobada: ${beatProblems.join(" ")} Devuelve exactamente cuatro cadenas no vacías en beats, cada una de hasta 1200 caracteres. Respuesta anterior: ${JSON.stringify(j.checkpoint[key])}`
        : "";
      const result = await textGenerate(j.snapshot.project.models.text, direction + repair, z.toJSONSchema(motion), 4096, 90000);
      await checkpoint(callKey, result);
    }
    const parsed = motion.safeParse(j.checkpoint[callKey]);
    if (!parsed.success) continue;
    beatProblems = motionBeatProblems(j, c, parsed.data.beats);
    if (!beatProblems.length) return parsed.data;
    // Do not submit staged motion that invents a participant or copies
    // dialogue to Veo: a bad beat is cheaper to repair here than a bad
    // paid clip. The second attempt repairs it; after that, fail loudly.
  }
  throw new AppError("DIRECTOR_JSON", `El Director no devolvió cuatro tramos de actuación válidos para el clip. ${beatProblems.join(" ")} El video todavía no se ha enviado a Veo.`, 502);
}

export const CHAPTER_MOTION_NEGATIVE_PROMPT = "frozen character pose, prolonged idle character pose, repeated action loop, aimless pacing, gratuitous off-frame departure, final-second walk-off, character leaving frame in last second, empty-room ending, outro, fade-out, camera cut, unexpected character replacement";
