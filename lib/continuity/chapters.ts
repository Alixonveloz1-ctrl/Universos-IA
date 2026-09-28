import type { Project } from "../types";
import type { Bible, Plan } from "../schemas";
import { assert } from "../errors";

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
    JSON.stringify(next.clips[0].continuityIn) === JSON.stringify(previous.finalState),
    "El capítulo debe comenzar desde el estado final observado del capítulo anterior.",
  );
}
