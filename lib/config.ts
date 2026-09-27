import { AppError } from "./errors";
export function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new AppError("CONFIG", `Falta configurar ${name}`, 503);
  return value;
}
export function config() {
  const project = required("GCP_PROJECT_ID"),
    bucket = required("GCS_OUTPUT_BUCKET"),
    prefix = process.env.GCS_PREFIX || "universos-ia";
  if (
    !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project) ||
    !/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucket) ||
    !/^[a-zA-Z0-9_-]+$/.test(prefix)
  )
    throw new AppError("CONFIG", "Proyecto, bucket o prefijo inválido", 503);
  return {
    project,
    bucket,
    prefix,
    database: process.env.FIRESTORE_DATABASE_ID || "(default)",
  };
}
