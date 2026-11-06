# Copia o bucket do Mapa da Votação para a pasta da organização no DBI usando o
# Storage Transfer Service (roda na nuvem do Google, não depende desta máquina).
#
#   origem:  gs://mapadavotacao-parquet-storage          (só leitura — nada é alterado lá)
#   destino: gs://dbi-app-br-arquivos/orgs/mapa-da-votacao/acervo/
#
# O que já foi copiado não é copiado de novo. Uso:  .\scripts\gcs-transfer-acervo-mapa.ps1
$ErrorActionPreference = 'Continue'
$agent = 'serviceAccount:project-295866755499@storage-transfer-service.iam.gserviceaccount.com'

function Grant($bucket, $role) {
  $out = gcloud storage buckets add-iam-policy-binding "gs://$bucket" --member=$agent --role=$role --format=none 2>&1 | Out-String
  if ($out -match 'ERROR') { throw "Falhou ao dar $role em $bucket`n$out" }
  Write-Host "ok  $role em $bucket"
}

# 1. Agente do Storage Transfer: LEITURA na origem, ESCRITA no destino.
Grant 'mapadavotacao-parquet-storage' 'roles/storage.objectViewer'
Grant 'mapadavotacao-parquet-storage' 'roles/storage.legacyBucketReader'
Grant 'dbi-app-br-arquivos' 'roles/storage.objectAdmin'
Grant 'dbi-app-br-arquivos' 'roles/storage.legacyBucketWriter'

# 2. Trabalho de transferência (executa uma vez, agora).
gcloud transfer jobs create gs://mapadavotacao-parquet-storage gs://dbi-app-br-arquivos/orgs/mapa-da-votacao/acervo/ `
  --project=dbi-app-br --name=copia-acervo-mapa-da-votacao `
  --description="Copia do acervo do Mapa da Votacao para o DBI"

Write-Host "`nAcompanhe em: https://console.cloud.google.com/transfer/jobs?project=dbi-app-br" -ForegroundColor Green
