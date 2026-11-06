# Cadastra as variáveis do Google Cloud Storage no projeto "dbiapp" da Vercel.
# A chave é lida de secrets/gcs-key.json e enviada direto ao CLI (não é impressa).
# Não altera DBI_STORAGE_DRIVER: trocar o driver em produção é um passo separado,
# depois que o código com suporte a "gcs" estiver no ar e os arquivos migrados.
# Uso (na pasta web, depois de "npx vercel@latest login"):  .\scripts\vercel-gcs-env.ps1
# 'Continue': o CLI escreve avisos em stderr, que o PowerShell 5.1 trataria como erro fatal.
# As falhas reais são detectadas por $LASTEXITCODE.
$ErrorActionPreference = 'Continue'
$scope = 'team_Hci6d3vgnYg7yI9VFCvwQfp7'
$keyFile = Join-Path $PSScriptRoot '..\secrets\gcs-key.json'
if (-not (Test-Path $keyFile)) { throw "Chave não encontrada em $keyFile" }

Push-Location (Join-Path $PSScriptRoot '..\..')   # raiz do repo, onde está .vercel/project.json
try {
  $plain = @{ GCS_BUCKET = 'dbi-app-br-arquivos'; GCS_PROJECT_ID = 'dbi-app-br' }
  $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path $keyFile)))

  foreach ($target in 'production', 'preview') {
    foreach ($name in $plain.Keys) {
      $plain[$name] | npx --yes vercel@latest env add $name $target --scope $scope --force
      if ($LASTEXITCODE -ne 0) { throw "falhou: $name ($target)" }
    }
    $b64 | npx --yes vercel@latest env add GCS_CREDENTIALS_BASE64 $target --sensitive --scope $scope --force
    if ($LASTEXITCODE -ne 0) { throw "falhou: GCS_CREDENTIALS_BASE64 ($target)" }
  }
  Write-Host "`nPronto. Variáveis GCS cadastradas em production e preview." -ForegroundColor Green
} finally {
  Pop-Location
}
