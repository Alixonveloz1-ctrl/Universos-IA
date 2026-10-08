import { z } from "zod";
import type { Clip } from "../schemas";
import type { Job, Snapshot, Target } from "../types";
import { textGenerate } from "../providers/vertex";
import { AppError } from "../errors";
import { withoutDialogue } from "./speech";

const motion = z.object({ beats: z.array(z.string().trim().min(1).max(1200)).length(4) });
export type Motion = z.infer<typeof motion>;
export const MOTION_PLAN_DIRECTION = "ACTUACIÓN TEMPORAL CONCRETA: escribe exactamente cuatro elementos en shots por clip, con tiempos 0–2, 2–4, 4–6 y 6–8. Son fases de UNA toma continua y solo el primero tiene imagen; no son cortes ni cuatro videos. En cada action escribe quién realiza qué movimiento visible, cómo responde el interlocutor y qué cambia respecto al tramo anterior. El tercer y cuarto tramo deben continuar el intercambio o acción pendiente con un paso concreto, no 'se queda quieto', 'mantiene la pose', 'espera', 'mira' sin evolución o 'reacciona hasta terminar'. Conserva una sola acción causal del guion, desarróllala a velocidad natural durante los ocho segundos y no la resuelvas en la primera mitad para posar después. No añadas caminata de salida, baile, celebración o pantomima para rellenar. Si partir es realmente parte del guion, mantén a los participantes visibles mediante seguimiento suave hasta el corte, sin dejar el lugar vacío. El último tramo termina en una respuesta, gesto o acción concreta que continúa en el siguiente clip; nunca en una despedida técnica del video.";

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
    "Da instrucciones positivas, breves y filmables de movimiento: actor, gesto o acción y respuesta del otro. Conserva la acción aprobada y su orden; distribuye preparación, desarrollo y respuesta a velocidad natural durante todo el clip. Cada tramo avanza desde el anterior, no repite el evento. Desarrolla el diálogo o interacción existente hasta el corte; la segunda mitad no es una pose de espera. No inventes otro acontecimiento para llenar tiempo.",
    "Los personajes, sus rostros, ropa, objetos y escenario ya existen en la imagen. No los redescribas ni inventes participantes, objetos, transformaciones, fenómenos ni decoraciones. Todos permanecen visibles con cámara estable o seguimiento corto si la acción requiere desplazarse. No añadas salida de pantalla, habitación vacía, baile o pantomima; el humor se interpreta con diálogo y gestos plausibles. La petición explícita del usuario dirige la actuación.",
    "Los diálogos aprobados solo sirven para entender causa y reacción: NO copies ni reformules las frases en beats, no añadas habla ni narres el guion. Los campos knowledge, secret, nextAction y la intención interna no son diálogo ni autorización para anticipar el clip siguiente. La acción terminal llega cerca del segundo 8, no a los cuatro segundos seguida de una pausa larga.",
    JSON.stringify({
      cast: c.characterIds.map(id => ({ id, name: j.snapshot.bible?.characters.find(ch => ch.id === id)?.name || id })),
      goal: c.goal,
      approvedAction: c.shots.map(sh => ({ start: sh.start, end: sh.end, action: withoutDialogue(sh.action, c) })),
      dialogue: c.dialogue,
      ...motionStates(j.snapshot, c),
      instructions: j.instructions || target.instructions,
    }),
  ].join("\n\n");
  for (let attempt = 0; attempt < 2; attempt++) {
    const callKey = attempt ? `${key}_repair` : key;
    if (!j.checkpoint[callKey]) {
      await beforeCall(callKey);
      const repair = attempt ? "\n\nCorrige únicamente el formato de la respuesta anterior: devuelve exactamente cuatro cadenas no vacías en beats, cada una de hasta 1200 caracteres. Respuesta anterior: " + JSON.stringify(j.checkpoint[key]) : "";
      const result = await textGenerate(j.snapshot.project.models.text, direction + repair, z.toJSONSchema(motion), 4096, 90000);
      await checkpoint(callKey, result);
    }
    const parsed = motion.safeParse(j.checkpoint[callKey]);
    if (parsed.success) return parsed.data;
  }
  throw new AppError("DIRECTOR_JSON", "El Director no devolvió los cuatro tramos de actuación del clip. El video todavía no se ha enviado a Veo.", 502);
}

export const CHAPTER_MOTION_NEGATIVE_PROMPT = "frozen character pose, prolonged idle character pose, repeated action loop, aimless pacing, gratuitous off-frame departure, empty-room ending, outro, fade-out, camera cut, unexpected character replacement";
