#!/usr/bin/env bash
set -euo pipefail
# Cloud Shell opens this repository; this single entry point installs the worker,
# including FFmpeg and the assembler. No paid generation is started.
cd "$(dirname "${BASH_SOURCE[0]}")"
# Si volviste después de cerrar la aplicación del celular, carga los valores
# guardados la vez anterior, solo los que no estén ya puestos, para no tener
# que volver a escribirlos ni a clonar.
if [[ -f "$HOME/universos-ia-env.sh" ]]; then
  while IFS= read -r line; do
    key="${line#export }"
    key="${key%%=*}"
    value="${line#*=}"
    if [[ -n "$key" && -z "${!key:-}" ]]; then export "$key=$value"; fi
  done < "$HOME/universos-ia-env.sh"
fi
for installer_command in gcloud node git; do
  command -v "$installer_command" >/dev/null || { echo "Falta $installer_command. Ejecuta este archivo en Cloud Shell." >&2; exit 1; }
done
account="$(gcloud auth list --format='value(account)' | head -n 1)"
if [[ -z "$account" ]]; then
  printf 'No hay una cuenta de Google activa en esta terminal, así que el instalador no puede seguir todavía.\n'
  printf 'No escribas ningún enlace ni código de Google aquí: eso solo te hace dar más pasos en inglés.\n'
  printf 'Para activar una cuenta, ejecuta gcloud auth login, abre el enlace que te da, entra con tu cuenta de Google nueva, pega el código que te da, y luego vuelve a ejecutar bash install.sh.\n'
  exit 1
fi
printf 'Cuenta de Google activa: %s\n' "$account"
ask() {
  local key="$1" label="$2" suggested="${3:-}" answer
  if [[ -n "${!key:-}" ]]; then return; fi
  read -r -p "$label${suggested:+ [$suggested]}: " answer || true
  printf -v "$key" '%s' "${answer:-$suggested}"
  export "$key"
}
printf '\nUniversos IA — instalación del ejecutor y ensamblador\n'
printf 'Elige el proyecto propio de esta aplicación. No se iniciarán generaciones.\n\n'
ask GCP_PROJECT_ID 'ID del proyecto de Google Cloud'
ask GCP_REGION 'Región del ejecutor' 'us-central1'
if [[ -z "${GCS_OUTPUT_BUCKET:-}" ]]; then
  bucket_names=$(gcloud storage buckets list --project="$GCP_PROJECT_ID" --format='value(name)')
  buckets=()
  while IFS= read -r bucket; do
    [[ -z "$bucket" ]] || buckets+=("${bucket#gs://}")
  done <<< "$bucket_names"
  printf '\nBuckets del proyecto %s:\n' "$GCP_PROJECT_ID"
  printf '  0) Crear un almacén nuevo\n'
  for i in "${!buckets[@]}"; do printf '  %s) %s\n' "$((i+1))" "${buckets[$i]}"; done
  while true; do
    read -r -p 'Escribe el número del bucket, o 0 para crear uno nuevo: ' choice
    if [[ "$choice" == "0" ]]; then
      while true; do
        read -r -p 'Nombre del almacén nuevo (minúsculas, sin espacios, único en todo Google Cloud): ' new_bucket
        if [[ ! "$new_bucket" =~ ^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$ ]]; then
          echo 'Ese nombre no es válido: usa minúsculas, números, guiones o puntos, y entre 3 y 63 caracteres.'
          continue
        fi
        if gcloud storage buckets create "gs://$new_bucket" --project="$GCP_PROJECT_ID" --location="$GCP_REGION" --uniform-bucket-level-access --public-access-prevention; then
          export GCS_OUTPUT_BUCKET="$new_bucket"
          break 2
        fi
        echo 'No se pudo crear ese almacén, probablemente porque el nombre ya está usado. Prueba con otro nombre.'
      done
    fi
    if [[ "$choice" =~ ^[1-9][0-9]{0,5}$ ]] && (( choice <= ${#buckets[@]} )); then
      export GCS_OUTPUT_BUCKET="${buckets[$((choice-1))]%/}"
      break
    fi
    echo 'Selecciona uno de los números de la lista, o 0 para crear uno nuevo.'
  done
fi
ask VERCEL_TEAM_SLUG 'Nombre del equipo o cuenta en Vercel (slug)'
ask VERCEL_PROJECT_NAME 'Nombre del proyecto en Vercel' 'universos-ia'
export WORKER_ACCOUNT="${WORKER_ACCOUNT:-universos-worker}"
export WEB_ACCOUNT="${WEB_ACCOUNT:-universos-web}"
export BUILD_ACCOUNT="${BUILD_ACCOUNT:-universos-build}"
export CLOUD_RUN_JOB_NAME="${CLOUD_RUN_JOB_NAME:-universos-worker}"
export ARTIFACT_REPOSITORY="${ARTIFACT_REPOSITORY:-universos-ia}"
export WIF_POOL="${WIF_POOL:-universos-vercel}"
export WIF_PROVIDER="${WIF_PROVIDER:-vercel}"
bash scripts/setup-gcp.sh
# Deja listas, en ESTA misma terminal, todas las variables que ./v necesita
# para poner las 14 variables en Vercel de una vez, sin copiar nada a mano.
# Antes, ./v fallaba porque estas variables no estaban exportadas aquí.
export GCS_PREFIX="${GCS_PREFIX:-universos-ia}"
export FIRESTORE_DATABASE_ID="${FIRESTORE_DATABASE_ID:-(default)}"
export GCP_SERVICE_ACCOUNT_EMAIL="${WEB_ACCOUNT}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
export CLOUD_RUN_JOB_RESOURCE="projects/${GCP_PROJECT_ID}/locations/${GCP_REGION}/jobs/${CLOUD_RUN_JOB_NAME}"
export GCP_WIF_AUDIENCE="//iam.googleapis.com/projects/$(gcloud projects describe "$GCP_PROJECT_ID" --format='value(projectNumber)')/locations/global/workloadIdentityPools/${WIF_POOL}/providers/${WIF_PROVIDER}"
ask APP_ORIGIN 'Dirección HTTPS de tu web en Vercel, sin barra final' "https://${VERCEL_PROJECT_NAME}.vercel.app"
# Guarda los valores en tu casa de Cloud Shell, que sí sobrevive al cerrar
# la aplicación del celular. Así, si vuelves después, no tienes que volver
# a escribir los exports ni a clonar: ./v los carga solo desde este archivo.
{
  printf 'export GCP_PROJECT_ID=%s\n' "$GCP_PROJECT_ID"
  printf 'export GCP_REGION=%s\n' "$GCP_REGION"
  printf 'export GCS_OUTPUT_BUCKET=%s\n' "$GCS_OUTPUT_BUCKET"
  printf 'export GCS_PREFIX=%s\n' "$GCS_PREFIX"
  printf 'export FIRESTORE_DATABASE_ID=%s\n' "$FIRESTORE_DATABASE_ID"
  printf 'export CLOUD_RUN_JOB_RESOURCE=%s\n' "$CLOUD_RUN_JOB_RESOURCE"
  printf 'export GCP_SERVICE_ACCOUNT_EMAIL=%s\n' "$GCP_SERVICE_ACCOUNT_EMAIL"
  printf 'export GCP_WIF_AUDIENCE=%s\n' "$GCP_WIF_AUDIENCE"
  printf 'export VERCEL_TEAM_SLUG=%s\n' "$VERCEL_TEAM_SLUG"
  printf 'export VERCEL_PROJECT_NAME=%s\n' "$VERCEL_PROJECT_NAME"
  printf 'export APP_ORIGIN=%s\n' "$APP_ORIGIN"
} > "$HOME/universos-ia-env.sh"
chmod 600 "$HOME/universos-ia-env.sh"
printf 'Valores guardados en tu casa de Cloud Shell para la próxima vez.\n'
printf '\nEjecutor instalado.\n'
printf 'Ahora, en ESTA misma terminal, ejecuta ./v para que Cloud Shell ponga de una vez las 14 variables en Vercel, borre las viejas incluidas las de Preview, y haga el redeploy.\n'
printf 'Tu contraseña personal no cambia: sigues entrando con la misma de siempre, ./v no te va a dar otra clave para entrar.\n'
