#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
project=alixon-jhan
account="universos-web@$project.iam.gserviceaccount.com"
role=universosJobMonitor
gcloud projects describe "$project" --format='value(projectId)' >/dev/null
gcloud iam service-accounts describe "$account" --project="$project" --format='value(email)' >/dev/null
if gcloud iam roles describe "$role" --project="$project" --format='value(name)' >/dev/null 2>&1; then
  gcloud iam roles update "$role" --project="$project" --permissions=run.operations.get,run.executions.get --quiet >/dev/null
else
  gcloud iam roles create "$role" --project="$project" --title='Universos IA job monitor' --permissions=run.operations.get,run.executions.get --quiet >/dev/null
fi
gcloud projects add-iam-policy-binding "$project" --member="serviceAccount:$account" --role="projects/$project/roles/$role" --condition=None --quiet >/dev/null
echo 'Universos IA ya puede comprobar el estado de sus ejecuciones. Actualiza la aplicación en el navegador.'
