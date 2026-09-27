#!/usr/bin/env bash
set -euo pipefail
set +x
cd "$(dirname "${BASH_SOURCE[0]}")/.."
read -r -s -p 'Clave personal (mínimo 14 caracteres): ' access_password
printf '\n'
read -r -s -p 'Repite la clave: ' access_confirmation
printf '\n'
[[ "$access_password" == "$access_confirmation" ]] || { echo 'Las claves no coinciden.' >&2; exit 1; }
printf '%s' "$access_password" | node scripts/access-secret.mjs
unset access_password access_confirmation
