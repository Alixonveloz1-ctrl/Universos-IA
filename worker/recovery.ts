import { bucket, objectPath, privateObject } from "../lib/persistence/google";
import { AppError } from "../lib/errors";

// Inspect only the immutable destination of this attempt. No provider request.
export async function recoverImage(projectId: string, versionId: string) {
  for (const [extension, mime] of [
    ["png", "image/png"],
    ["jpg", "image/jpeg"],
    ["webp", "image/webp"],
  ]) {
    const object = objectPath(projectId, versionId, `image.${extension}`);
    const file = privateObject(object);
    if ((await file.exists())[0]) {
      const [bytes] = await file.download();
      return { bytes, mime, object };
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

export async function recoverVideo(projectId: string, versionId: string) {
  const prefix = objectPath(projectId, versionId, "provider") + "/";
  const [files, nextQuery] = await bucket().getFiles({
    prefix,
    autoPaginate: false,
    maxResults: 2,
  });
  if (nextQuery || files.length > 1)
    throw new AppError(
      "AMBIGUOUS",
      "Hay varios objetos en el destino del intento; revisa el resultado antes de continuar.",
    );
  const file = files[0];
  if (!file) return null;
  if (!file.name.startsWith(prefix) || !file.name.endsWith(".mp4"))
    throw new AppError(
      "AMBIGUOUS",
      "El objeto recuperado no es un MP4 del intento.",
    );
  return file.name;
}
