#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
export GCP_PROJECT_ID="${GCP_PROJECT_ID:-alixon-jhan}"
export GCP_REGION="${GCP_REGION:-us-central1}"
export VERCEL_TEAM_SLUG="${VERCEL_TEAM_SLUG:-alixonveloz1-3809s-projects}"
exec bash install.sh
