#!/usr/bin/env bash
# Cadastra as variáveis do Google Cloud Storage no projeto "dbiapp" da Vercel (production e preview).
# A chave é lida de secrets/gcs-key.json e enviada direto ao CLI (não é impressa).
# Usa printf '%s' de propósito: o valor NÃO pode ter quebra de linha no fim — com "gcs\n" o app
# recusava DBI_STORAGE_DRIVER e produção caiu (2026-11-06). Pipes do PowerShell adicionam "\r\n".
# Uso (na pasta web, depois de "npx vercel@latest login"):  bash scripts/vercel-gcs-env.sh
set -euo pipefail
cd "$(dirname "$0")/../.."   # raiz do repo, onde está .vercel/project.json
SCOPE=team_Hci6d3vgnYg7yI9VFCvwQfp7
KEY_FILE=web/secrets/gcs-key.json
[ -f "$KEY_FILE" ] || { echo "Chave não encontrada em $KEY_FILE" >&2; exit 1; }

set_env() { # nome valor alvo [flags]
  printf '%s' "$2" | npx --yes vercel@latest env add "$1" "$3" --scope "$SCOPE" --force ${4:-} >/dev/null
  echo "ok $1 ($3)"
}

for target in production preview; do
  set_env DBI_STORAGE_DRIVER gcs "$target"
  set_env GCS_BUCKET dbi-app-br-arquivos "$target"
  set_env GCS_PROJECT_ID dbi-app-br "$target"
  set_env GCS_CREDENTIALS_BASE64 "$(base64 -w0 "$KEY_FILE")" "$target" --sensitive
done
echo "Pronto. Faça um novo deploy para as variáveis valerem."
