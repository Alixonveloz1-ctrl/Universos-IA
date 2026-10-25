#!/usr/bin/env bash
set -euo pipefail
set +x
cd "$(dirname "${BASH_SOURCE[0]}")"
# Si volviste después de cerrar la aplicación del celular, los exports de
# la sesión anterior ya no existen, pero el archivo guardado por install.sh
# en tu casa sí. Carga solo los valores que no estén ya puestos en esta
# terminal, para que ./v funcione sin volver a escribirlos.
if [[ -f "$HOME/universos-ia-env.sh" ]]; then
  while IFS= read -r line; do
    key="${line#export }"
    key="${key%%=*}"
    value="${line#*=}"
    if [[ -n "$key" && -z "${!key:-}" ]]; then export "$key=$value"; fi
  done < "$HOME/universos-ia-env.sh"
fi
export VERCEL_TELEMETRY_DISABLED=1
printf '\nUniversos IA: conectar Vercel, configurar y publicar.\n'
if ! npx --yes vercel@60.1.3 whoami >/dev/null 2>&1; then
 printf 'Abre el enlace que mostrará Vercel y autoriza tu cuenta. Luego vuelve aquí.\n'
 npx --yes vercel@60.1.3 login
fi
exec node scripts/configure-vercel.mjs
