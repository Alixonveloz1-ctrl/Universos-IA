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
ask GCS_OUTPUT_BUCKET 'Bucket privado para esta aplicación' "${GCP_PROJECT_ID}-universos-ia"
ask VERCEL_TEAM_SLUG 'Nombre del equipo o cuenta en Vercel (slug)'
ask VERCEL_PROJECT_NAME 'Nombre del proyecto en Vercel' 'universos-ia'
ask WORKER_ACCOUNT 'Cuenta del ejecutor' 'universos-worker'
ask WEB_ACCOUNT 'Cuenta de la web' 'universos-web'
ask BUILD_ACCOUNT 'Cuenta de compilación' 'universos-build'
ask CLOUD_RUN_JOB_NAME 'Nombre del ejecutor' 'universos-worker'
ask ARTIFACT_REPOSITORY 'Repositorio de contenedores' 'universos-ia'
ask WIF_POOL 'Grupo de identidad de Vercel' 'universos-vercel'
ask WIF_PROVIDER 'Proveedor de identidad de Vercel' 'vercel'
bash scripts/setup-gcp.sh
printf '\nEjecutor instalado. Para la web, configura las variables indicadas en Vercel.\n'
if [[ -t 0 ]]; then
  printf 'Prepara ahora tu clave personal; los valores siguientes son privados.\n'
  bash scripts/configure-access.sh
fi
printf 'APP_ORIGIN debe ser la dirección HTTPS de tu web en Vercel, sin barra final.\n'
