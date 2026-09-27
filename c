#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
export GCP_PROJECT_ID="${GCP_PROJECT_ID:-alixon-jhan}"
export GCP_REGION="${GCP_REGION:-us-central1}"
exec bash install.sh
