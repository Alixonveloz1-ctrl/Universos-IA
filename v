#!/usr/bin/env bash
set -euo pipefail
set +x
cd "$(dirname "${BASH_SOURCE[0]}")"
export VERCEL_TELEMETRY_DISABLED=1
printf '\nUniversos IA: conectar Vercel, configurar y publicar.\n'
if ! npx --yes vercel@60.1.3 whoami >/dev/null 2>&1; then
 printf 'Abre el enlace que mostrará Vercel y autoriza tu cuenta. Luego vuelve aquí.\n'
 npx --yes vercel@60.1.3 login
fi
exec node scripts/configure-vercel.mjs
