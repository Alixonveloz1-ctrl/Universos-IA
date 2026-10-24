#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
# Grant the web identity permission to call the generators directly.
# All real names come from the environment, never from this file:
#   GCP_PROJECT_ID, GCS_OUTPUT_BUCKET, GCS_PREFIX (default: universos-ia),
#   WEB_ACCOUNT (default: universos-web)
project="${GCP_PROJECT_ID:?Falta GCP_PROJECT_ID en el entorno.}"
bucket="${GCS_OUTPUT_BUCKET:?Falta GCS_OUTPUT_BUCKET en el entorno.}"
prefix="${GCS_PREFIX:-universos-ia}"
web_account="${WEB_ACCOUNT:-universos-web}"
account="$web_account@$project.iam.gserviceaccount.com"
role=universosJobMonitor
gcloud projects describe "$project" --format='value(projectId)' >/dev/null
gcloud iam service-accounts describe "$account" --project="$project" --format='value(email)' >/dev/null
gcloud projects add-iam-policy-binding "$project" --member="serviceAccount:$account" --role=roles/aiplatform.user --condition=None --quiet >/dev/null
if gcloud iam roles describe "$role" --project="$project" --format='value(name)' >/dev/null 2>&1; then
  gcloud iam roles update "$role" --project="$project" --permissions=run.operations.get,run.executions.get --quiet >/dev/null
else
  gcloud iam roles create "$role" --project="$project" --title='Universos IA job monitor' --permissions=run.operations.get,run.executions.get --quiet >/dev/null
fi
gcloud projects add-iam-policy-binding "$project" --member="serviceAccount:$account" --role="projects/$project/roles/$role" --condition=None --quiet >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://$bucket" --member="serviceAccount:$account" --role="projects/$project/roles/universosObjectLister" --condition=None --quiet >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://$bucket" --member="serviceAccount:$account" --role=roles/storage.objectUser --condition="expression=resource.name.startsWith('projects/_/buckets/$bucket/objects/$prefix/'),title=universos-prefix-delete" --quiet >/dev/null
echo 'Universos IA ya puede llamar directamente a los generadores. Actualiza la aplicación en el navegador.'
