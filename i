#!/usr/bin/env bash
# Atajo para el celular: en Chrome no se puede pegar, así que con este
# archivo corto ya no hay que escribir ni pegar los valores largos.
# Solo hay que escribir: bash i
# Los valores aquí son nombres de proyecto, almacén y Vercel, no contraseñas.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
export GCP_PROJECT_ID=civic-genre-507713-m2
export GCP_REGION=us-central1
export GCS_OUTPUT_BUCKET=universos-ia-civic-genre-507713-m2
export VERCEL_TEAM_SLUG=alixonveloz1-3809s-projects
export VERCEL_PROJECT_NAME=universos-ia
export APP_ORIGIN=https://universos-ia.vercel.app
bash install.sh && ./v
