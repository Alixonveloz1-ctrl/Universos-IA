#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
for installer_command in gcloud node git; do command -v "$installer_command" >/dev/null; done
# Newly created IAM identities may not yet be visible to policy APIs.
# Retry only idempotent bindings and only propagation/concurrency errors.
iam_binding() {
 local attempt error_file status
 error_file=$(mktemp)
 for attempt in 1 2 3 4 5 6 7; do
  if gcloud "$@" 2>"$error_file"; then
   rm -f "$error_file"
   return 0
  else
   status=$?
  fi
  if (( attempt == 7 )) || ! grep -Eiq 'does not exist|not found|concurrent|ABORTED|Please retry' "$error_file"; then
   cat "$error_file" >&2
   rm -f "$error_file"
   return "$status"
  fi
  printf 'Google está propagando los permisos; esperando %s segundos (%s/7)…\n' "$((attempt * 5))" >&2
  sleep "$((attempt * 5))"
 done
}
# Run from this repository in the owner's authenticated Cloud Shell.
# Resource names are owner-selected; this script never selects another app's resources.
for task_name in GCP_PROJECT_ID GCS_OUTPUT_BUCKET GCP_REGION WORKER_ACCOUNT WEB_ACCOUNT BUILD_ACCOUNT CLOUD_RUN_JOB_NAME ARTIFACT_REPOSITORY VERCEL_TEAM_SLUG VERCEL_PROJECT_NAME WIF_POOL WIF_PROVIDER; do
  if [[ -z "${!task_name:-}" ]]; then read -r -p "$task_name: " task_value; printf -v "$task_name" '%s' "$task_value"; export "$task_name"; fi
  [[ "${!task_name}" =~ ^[a-z0-9][a-z0-9._-]*$ ]] || { echo "Valor inválido: $task_name" >&2; exit 1; }
done
[[ "$WORKER_ACCOUNT" != "$WEB_ACCOUNT" && "$BUILD_ACCOUNT" != "$WORKER_ACCOUNT" && "$BUILD_ACCOUNT" != "$WEB_ACCOUNT" ]] || { echo 'Usa identidades distintas para web, ejecutor y compilación.' >&2; exit 1; }
for account in "$WORKER_ACCOUNT" "$WEB_ACCOUNT" "$BUILD_ACCOUNT"; do
 [[ "$account" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || { echo 'ID de cuenta de servicio inválido (6–30 caracteres).' >&2; exit 1; }
done
GCS_PREFIX="${GCS_PREFIX:-universos-ia}"
[[ "$GCS_PREFIX" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 1
FIRESTORE_DATABASE_ID="${FIRESTORE_DATABASE_ID:-(default)}"
[[ "$FIRESTORE_DATABASE_ID" == '(default)' || "$FIRESTORE_DATABASE_ID" =~ ^[a-z0-9-]+$ ]] || exit 1
command -v gcloud >/dev/null
gcloud projects describe "$GCP_PROJECT_ID" --format='value(projectId)' >/dev/null
number=$(gcloud projects describe "$GCP_PROJECT_ID" --format='value(projectNumber)')
gcloud services enable aiplatform.googleapis.com firestore.googleapis.com storage.googleapis.com run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com --project="$GCP_PROJECT_ID"
if ! gcloud firestore databases list --project="$GCP_PROJECT_ID" --format='value(name)' | grep -Fxq "projects/$GCP_PROJECT_ID/databases/$FIRESTORE_DATABASE_ID"; then
 gcloud firestore databases create --project="$GCP_PROJECT_ID" --database="$FIRESTORE_DATABASE_ID" --location="$GCP_REGION" --type=firestore-native
fi
[[ "$(gcloud firestore databases describe --project="$GCP_PROJECT_ID" --database="$FIRESTORE_DATABASE_ID" --format='value(type)')" == FIRESTORE_NATIVE ]] || { echo 'La base elegida debe ser Firestore Native.' >&2; exit 1; }
if ! gcloud storage buckets list --project="$GCP_PROJECT_ID" --format='value(name)' | grep -Fxq "$GCS_OUTPUT_BUCKET"; then
 gcloud storage buckets create "gs://$GCS_OUTPUT_BUCKET" --project="$GCP_PROJECT_ID" --location="$GCP_REGION" --uniform-bucket-level-access --public-access-prevention
fi
# Fail if a pre-existing bucket is not private; do not alter unrelated bucket policy.
bucket_check=$(mktemp)
trap 'rm -f "$bucket_check"' EXIT
gcloud storage buckets describe "gs://$GCS_OUTPUT_BUCKET" --raw --format=json > "$bucket_check"
node -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1]));if(String(b.projectNumber)!==process.argv[2]||b.iamConfiguration?.publicAccessPrevention!=="enforced"||b.iamConfiguration?.uniformBucketLevelAccess?.enabled!==true)throw Error("El bucket debe pertenecer al proyecto elegido, ser uniforme y tener prevención pública habilitada")' "$bucket_check" "$number"
rm -f "$bucket_check"
for account in "$WORKER_ACCOUNT" "$WEB_ACCOUNT"; do
 if ! gcloud iam service-accounts list --project="$GCP_PROJECT_ID" --format='value(email)' | grep -Fxq "$account@$GCP_PROJECT_ID.iam.gserviceaccount.com"; then
  gcloud iam service-accounts create "$account" --project="$GCP_PROJECT_ID"
 fi
 iam_binding projects add-iam-policy-binding "$GCP_PROJECT_ID" --member="serviceAccount:$account@$GCP_PROJECT_ID.iam.gserviceaccount.com" --role=roles/datastore.user --condition=None --quiet >/dev/null
 done
worker_email="$WORKER_ACCOUNT@$GCP_PROJECT_ID.iam.gserviceaccount.com"
web_email="$WEB_ACCOUNT@$GCP_PROJECT_ID.iam.gserviceaccount.com"
iam_binding projects add-iam-policy-binding "$GCP_PROJECT_ID" --member="serviceAccount:$worker_email" --role=roles/aiplatform.user --condition=None --quiet >/dev/null
for account in "$worker_email" "$web_email"; do
 role=roles/storage.objectViewer
 [[ "$account" == "$worker_email" ]] && role=roles/storage.objectUser
 iam_binding storage buckets add-iam-policy-binding "gs://$GCS_OUTPUT_BUCKET" --member="serviceAccount:$account" --role="$role" --condition="expression=resource.name.startsWith('projects/_/buckets/$GCS_OUTPUT_BUCKET/objects/$GCS_PREFIX/'),title=universos-prefix" >/dev/null
 done
# Object listing is bucket-scoped in GCS. Worker alone can list names for
# reconciliation; get/write access remains restricted to this app's prefix.
list_role_id=universosObjectLister
if ! gcloud iam roles list --project="$GCP_PROJECT_ID" --format='value(name)' | grep -Fxq "projects/$GCP_PROJECT_ID/roles/$list_role_id"; then
 gcloud iam roles create "$list_role_id" --project="$GCP_PROJECT_ID" --title='Universos result reconciliation' --permissions=storage.objects.list
fi
iam_binding storage buckets add-iam-policy-binding "gs://$GCS_OUTPUT_BUCKET" --member="serviceAccount:$worker_email" --role="projects/$GCP_PROJECT_ID/roles/$list_role_id" --condition=None --quiet >/dev/null
# Signing short-lived private media URLs; no service-account private key is created.
iam_binding iam service-accounts add-iam-policy-binding "$web_email" --project="$GCP_PROJECT_ID" --member="serviceAccount:$web_email" --role=roles/iam.serviceAccountTokenCreator --condition=None --quiet >/dev/null
if ! gcloud artifacts repositories list --project="$GCP_PROJECT_ID" --location="$GCP_REGION" --format='value(name)' | grep -Fxq "projects/$GCP_PROJECT_ID/locations/$GCP_REGION/repositories/$ARTIFACT_REPOSITORY"; then
 gcloud artifacts repositories create "$ARTIFACT_REPOSITORY" --project="$GCP_PROJECT_ID" --location="$GCP_REGION" --repository-format=docker
fi
[[ "$(gcloud artifacts repositories describe "$ARTIFACT_REPOSITORY" --project="$GCP_PROJECT_ID" --location="$GCP_REGION" --format='value(format)')" == DOCKER ]] || { echo 'El repositorio de contenedores debe ser Docker.' >&2; exit 1; }
build_email="$BUILD_ACCOUNT@$GCP_PROJECT_ID.iam.gserviceaccount.com"
if ! gcloud iam service-accounts list --project="$GCP_PROJECT_ID" --format='value(email)' | grep -Fxq "$build_email"; then
 gcloud iam service-accounts create "$BUILD_ACCOUNT" --project="$GCP_PROJECT_ID"
fi
iam_binding projects add-iam-policy-binding "$GCP_PROJECT_ID" --member="serviceAccount:$build_email" --role=roles/logging.logWriter --condition=None --quiet >/dev/null
iam_binding artifacts repositories add-iam-policy-binding "$ARTIFACT_REPOSITORY" --project="$GCP_PROJECT_ID" --location="$GCP_REGION" --member="serviceAccount:$build_email" --role=roles/artifactregistry.writer --condition=None --quiet >/dev/null
iam_binding storage buckets add-iam-policy-binding "gs://$GCS_OUTPUT_BUCKET" --member="serviceAccount:$build_email" --role=roles/storage.objectViewer --condition="expression=resource.name.startsWith('projects/_/buckets/$GCS_OUTPUT_BUCKET/objects/$GCS_PREFIX/build/'),title=universos-build-source" >/dev/null
image="$GCP_REGION-docker.pkg.dev/$GCP_PROJECT_ID/$ARTIFACT_REPOSITORY/worker:$(git rev-parse --short HEAD)"
# Cloud Build needs Dockerfile at context root; use an isolated copy, preserving source.
build_dir=$(mktemp -d)
trap 'rm -rf "$build_dir"' EXIT
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
gcloud builds submit "$build_dir" --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --config="$build_dir/cloudbuild.yaml" --service-account="projects/$GCP_PROJECT_ID/serviceAccounts/$build_email" --gcs-source-staging-dir="gs://$GCS_OUTPUT_BUCKET/$GCS_PREFIX/build/source"
gcloud run jobs deploy "$CLOUD_RUN_JOB_NAME" --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --image="$image" --service-account="$worker_email" --labels=firestore-scope=universos-ia-v1,story-flow=chapters-v1 --tasks=1 --parallelism=1 --max-retries=0 --task-timeout=3600s --memory=2Gi --cpu=2 --set-env-vars="GCP_PROJECT_ID=$GCP_PROJECT_ID,GCS_OUTPUT_BUCKET=$GCS_OUTPUT_BUCKET,GCS_PREFIX=$GCS_PREFIX,FIRESTORE_DATABASE_ID=$FIRESTORE_DATABASE_ID,MAX_ACTIVE_JOBS=1"
role_id=universosJobExecutor
if ! gcloud iam roles list --project="$GCP_PROJECT_ID" --format='value(name)' | grep -Fxq "projects/$GCP_PROJECT_ID/roles/$role_id"; then
 gcloud iam roles create "$role_id" --project="$GCP_PROJECT_ID" --title='Universos job execution' --permissions=run.jobs.run,run.jobs.runWithOverrides,run.jobs.get
fi
iam_binding run jobs add-iam-policy-binding "$CLOUD_RUN_JOB_NAME" --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --member="serviceAccount:$web_email" --role="projects/$GCP_PROJECT_ID/roles/$role_id" --condition=None --quiet >/dev/null
if ! gcloud iam workload-identity-pools list --project="$GCP_PROJECT_ID" --location=global --format='value(name)' | grep -Fxq "projects/$number/locations/global/workloadIdentityPools/$WIF_POOL"; then
 gcloud iam workload-identity-pools create "$WIF_POOL" --project="$GCP_PROJECT_ID" --location=global
fi
if ! gcloud iam workload-identity-pools providers list --project="$GCP_PROJECT_ID" --location=global --workload-identity-pool="$WIF_POOL" --format='value(name)' | grep -Fxq "projects/$number/locations/global/workloadIdentityPools/$WIF_POOL/providers/$WIF_PROVIDER"; then
 gcloud iam workload-identity-pools providers create-oidc "$WIF_PROVIDER" --project="$GCP_PROJECT_ID" --location=global --workload-identity-pool="$WIF_POOL" --issuer-uri="https://oidc.vercel.com/$VERCEL_TEAM_SLUG" --allowed-audiences="https://vercel.com/$VERCEL_TEAM_SLUG" --attribute-mapping='google.subject=assertion.sub' --attribute-condition="assertion.sub=='owner:$VERCEL_TEAM_SLUG:project:$VERCEL_PROJECT_NAME:environment:production'"
fi
subject="owner:$VERCEL_TEAM_SLUG:project:$VERCEL_PROJECT_NAME:environment:production"
gcloud iam workload-identity-pools providers describe "$WIF_PROVIDER" --project="$GCP_PROJECT_ID" --location=global --workload-identity-pool="$WIF_POOL" --format=json > "$build_dir/provider.json"
node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1]));const team=process.argv[2],sub=process.argv[3];if(p.state!=="ACTIVE"||p.disabled||p.oidc?.issuerUri!=="https://oidc.vercel.com/"+team||p.oidc?.allowedAudiences?.length!==1||p.oidc.allowedAudiences[0]!=="https://vercel.com/"+team||p.attributeMapping?.["google.subject"]!=="assertion.sub"||p.attributeCondition!=="assertion.sub=="+String.fromCharCode(39)+sub+String.fromCharCode(39))throw Error("El proveedor WIF existente no coincide con esta aplicación. Revisa los nombres elegidos; no se modificó su configuración.")' "$build_dir/provider.json" "$VERCEL_TEAM_SLUG" "$subject"
iam_binding iam service-accounts add-iam-policy-binding "$web_email" --project="$GCP_PROJECT_ID" --role=roles/iam.workloadIdentityUser --member="principal://iam.googleapis.com/projects/$number/locations/global/workloadIdentityPools/$WIF_POOL/subject/$subject" --condition=None --quiet >/dev/null
printf '\nConfiguración de servidor para Vercel (sin secretos):\n'
printf 'GCP_PROJECT_ID=%s\nGCS_OUTPUT_BUCKET=%s\nGCS_PREFIX=%s\nFIRESTORE_DATABASE_ID=%s\nMAX_ACTIVE_JOBS=1\n' "$GCP_PROJECT_ID" "$GCS_OUTPUT_BUCKET" "$GCS_PREFIX" "$FIRESTORE_DATABASE_ID"
printf 'GCP_SERVICE_ACCOUNT_EMAIL=%s\nGCP_WIF_AUDIENCE=//iam.googleapis.com/projects/%s/locations/global/workloadIdentityPools/%s/providers/%s\nCLOUD_RUN_JOB_RESOURCE=projects/%s/locations/%s/jobs/%s\n' "$web_email" "$number" "$WIF_POOL" "$WIF_PROVIDER" "$GCP_PROJECT_ID" "$GCP_REGION" "$CLOUD_RUN_JOB_NAME"
