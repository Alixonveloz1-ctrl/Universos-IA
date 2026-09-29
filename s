#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
# One-command mobile updater. Always build from the latest main so an old
# Cloud Shell tab cannot silently redeploy a stale worker.
git fetch origin main
git checkout -B main origin/main
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
# Allow the web app to report the real outcome of a dispatched execution.
./d
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
gcloud run jobs update "$job" --project="$project" --region="$region" --image="$image" --update-labels=firestore-scope=universos-ia-v1,story-flow=chapters-v1,model-catalog=text-v2
printf '\nComprobando el arranque y el acceso a tus datos, sin generar contenido…\n'
if ! gcloud run jobs execute "$job" --project="$project" --region="$region" --update-env-vars=WORKER_SELF_TEST=1 --tasks=1 --task-timeout=120s --wait; then
  printf '\nFalló la comprobación. Consultando el error de esta ejecución…\n' >&2
  if gcloud run jobs executions list --job="$job" --project="$project" --region="$region" --limit=1 --format=json > "$build_dir/executions.json"; then
    execution=$(node - "$build_dir/executions.json" <<'JS'
const executions = require(process.argv[2]);
const name = executions[0]?.name || executions[0]?.metadata?.name || '';
process.stdout.write(name.split('/').at(-1));
JS
)
    if [[ -n "$execution" ]]; then
      gcloud beta run jobs executions logs read "$execution" --project="$project" --region="$region" --limit=20 --format='value(textPayload)' >&2 || true
    fi
  fi
  exit 1
fi
deployed_image=$(gcloud run jobs describe "$job" --project="$project" --region="$region" --format='value(spec.template.spec.template.spec.containers[0].image)')
[[ "$deployed_image" == "$image" ]] || { echo "Cloud Run no quedó apuntando a la imagen recién construida." >&2; exit 1; }
printf '\nLISTO: Universos IA actualizado a %s y verificado sin generaciones de pago.\n' "$(git rev-parse --short HEAD)"
