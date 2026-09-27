import type { Firestore } from "@google-cloud/firestore";

// Shared by the web and worker. Never fall back to shared root collections.
export const DATA_SCOPE = "universos-ia-v1";
export const DATA_ROOT = `applications/${DATA_SCOPE}`;
export function scopedDatabase(database: Firestore) {
  const root = database.doc(DATA_ROOT);
  const valid = (path: string) => {
    if (!path || path.split("/").some((part) => !part || part === "." || part === ".."))
      throw new Error("Ruta de datos inválida");
    return path;
  };
  return {
    collection: (path: string) => root.collection(valid(path)),
    doc: (path: string) => database.doc(`${DATA_ROOT}/${valid(path)}`),
    runTransaction: database.runTransaction.bind(database),
  };
}
