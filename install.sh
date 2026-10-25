#!/usr/bin/env bash
set -euo pipefail
# Cloud Shell opens this repository; this single entry point installs the worker,
# including FFmpeg and the assembler. No paid generation is started.
cd "$(dirname "${BASH_SOURCE[0]}")"
for installer_command in gcloud node git; do
  command -v "$installer_command" >/dev/null || { echo "Falta $installer_command. Ejecuta este archivo en Cloud Shell." >&2; exit 1; }
done
if [[ -z "$(gcloud auth list --filter=status:ACTIVE --format='value(account)')" ]]; then
  printf 'Autoriza tu cuenta de Google para instalar en tu proyecto.\n'
  gcloud auth login --no-launch-browser
fi
ask() {
  local key="$1" label="$2" suggested="${3:-}" answer
  if [[ -n "${!key:-}" ]]; then return; fi
  read -r -p "$label${suggested:+ [$suggested]}: " answer
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
printf '\nEjecutor instalado. Para la web, configura las variables indicadas en Vercel.\n'
if [[ -t 0 ]]; then
  printf 'Prepara ahora tu clave personal; los valores siguientes son privados.\n'
  bash scripts/configure-access.sh
fi
printf 'APP_ORIGIN debe ser la dirección HTTPS de tu web en Vercel, sin barra final.\n'
