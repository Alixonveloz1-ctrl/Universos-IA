#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
# Shortcut for install.sh. install.sh asks for the project, region, bucket
# and Vercel team when they are not already set as environment variables.
# No real project, bucket or team name belongs in this file.
exec bash install.sh
