param(
  [int]$Steps = 24,
  [int]$Width = 64,
  [int]$Height = 64,
  [string]$Output = "data/sample/canwxsim_sample.json"
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

Push-Location $repoRoot
try {
  & cargo run -p canwxsim-cli -- run-sample --steps $Steps --width $Width --height $Height --output $Output
} finally {
  Pop-Location
}
