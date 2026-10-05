import { bucket, objectPath, privateObject, projectObjectPath } from "../lib/persistence/google";
import { AppError } from "../lib/errors";

// Inspect only the immutable destination of this attempt. No provider request.
type Location = { title: string; chapterNumber: number };
function paths(projectId: string, versionId: string, name: string, location?: Location) {
  return location
    ? [projectObjectPath(location.title, projectId, location.chapterNumber, versionId, name), objectPath(projectId, versionId, name)]
    : [objectPath(projectId, versionId, name)];
}

export async function recoverImage(projectId: string, versionId: string, location?: Location) {
  for (const [extension, mime] of [
    ["png", "image/png"],
    ["jpg", "image/jpeg"],
    ["webp", "image/webp"],
  ]) {
    for (const object of paths(projectId, versionId, `image.${extension}`, location)) {
      const file = privateObject(object);
      if ((await file.exists())[0]) {
        const [bytes] = await file.download();
        return { bytes, mime, object };
      }
    }
  }
  return null;
}

export function assertNoPendingCall(pending: unknown) {
  if (pending)
    throw new AppError(
      "AMBIGUOUS",
      "La solicitud anterior puede haber consumido créditos. No se repetirá automáticamente. Puedes volver a comprobar su recuperación o cerrar el intento tras revisarlo.",
      409,
    );
}

export async function recoverVideo(projectId: string, versionId: string, location?: Location) {
  let found: string | null = null;
  for (const root of paths(projectId, versionId, "provider", location)) {
    const prefix = root + "/";
    const [files, nextQuery] = await bucket().getFiles({ prefix, autoPaginate: false, maxResults: 2 });
    if (nextQuery || files.length > 1 || (found && files.length))
      throw new AppError("AMBIGUOUS", "Hay varios objetos en el destino del intento; revisa el resultado antes de continuar.");
    const file = files[0];
    if (!file) continue;
    if (!file.name.startsWith(prefix) || !file.name.endsWith(".mp4"))
      throw new AppError("AMBIGUOUS", "El objeto recuperado no es un MP4 del intento.");
    found = file.name;
  }
  return found;
}
