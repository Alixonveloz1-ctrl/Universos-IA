#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
# Update only this application's existing worker; preserve environment and IAM.
project=alixon-jhan
region=us-central1
job=universos-worker
build_dir=$(mktemp -d)
trap 'rm -rf "$build_dir"' EXIT
gcloud run jobs describe "$job" --project="$project" --region="$region" --format=json > "$build_dir/job.json"
node --input-type=module - "$build_dir/job.json" <<'JS'
import fs from 'node:fs';
const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const container = job.spec?.template?.spec?.template?.spec?.containers?.[0];
const env = Object.fromEntries((container?.env || []).map(e => [e.name, e.value]));
if (env.GCP_PROJECT_ID !== 'alixon-jhan' || env.GCS_OUTPUT_BUCKET !== 'universos_ia')
  throw Error('El ejecutor no corresponde al proyecto y bucket de Universos IA. No se modificó.');
JS
rm -f "$build_dir/job.json"
image="$region-docker.pkg.dev/$project/universos-ia/worker:isolated-$(git rev-parse --short HEAD)"
cp package.json package-lock.json "$build_dir/"
cp -R lib worker "$build_dir/"
cp worker/Dockerfile "$build_dir/Dockerfile"
cat > "$build_dir/cloudbuild.yaml" <<BUILD
steps:
  - name: gcr.io/cloud-builders/docker
    args: ['build', '-t', '$image', '.']
images: ['$image']
options:
  logging: CLOUD_LOGGING_ONLY
BUILD
gcloud builds submit "$build_dir" --project="$project" --region="$region" --config="$build_dir/cloudbuild.yaml" --service-account="projects/$project/serviceAccounts/universos-build@$project.iam.gserviceaccount.com" --gcs-source-staging-dir=gs://universos_ia/universos-ia/build/source
gcloud run jobs update "$job" --project="$project" --region="$region" --image="$image" --update-labels=firestore-scope=universos-ia-v1,story-flow=automatic-universe-v1
printf '\nEjecutor actualizado. Universos IA usa su propio espacio de datos. No se iniciaron generaciones.\n'
