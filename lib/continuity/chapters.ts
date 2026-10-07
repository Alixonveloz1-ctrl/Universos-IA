import type { Project } from "../types";
import { state, type Bible, type Plan } from "../schemas";
import { assert } from "../errors";
import { isDeepStrictEqual } from "node:util";

export function validateChapterBible(project: Project, next: Bible) {
  const previous = project.previousChapter?.bible;
  if (!previous) return;
  for (const key of ["characters", "locations"] as const)
    for (const entity of previous[key])
      assert(
        JSON.stringify(next[key].find(x => x.id === entity.id)) === JSON.stringify(entity),
        `Conserva la ficha canónica de ${entity.name}; la evolución se describe en la historia y los estados de las escenas.`,
      );
}
export function validateChapterPlan(project: Project, next: Plan) {
  const previous = project.previousChapter;
  if (!previous) return;
  assert(
    isDeepStrictEqual(state.parse(next.clips[0].continuityIn), state.parse(previous.finalState)),
    "El capítulo debe comenzar desde el estado final observado del capítulo anterior.",
  );
  // previousFrame literally starts from the exported final frame. Its set
  // cannot jump to a different canonical location before any action occurs.
  if (next.clips[0].startMode === "previousFrame") {
    const incoming = state.parse(previous.finalState);
    const location = previous.bible.locations.find(item =>
      item.id === incoming.location || item.name.toLocaleLowerCase() === incoming.location.toLocaleLowerCase());
    if (location)
      assert(next.clips[0].locationId === location.id,
        "El primer clip debe conservar el lugar del fotograma final anterior o usar un nuevo encuadre.");
  }
}
