param(
  [int]$ApiPort = 8787,
  [int]$WebPort = 5173
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$logsDir = Join-Path $repoRoot ".canwxlab/dev-logs"
$pidFile = Join-Path $logsDir "dev-pids.json"
New-Item -ItemType Directory -Path $logsDir -Force | Out-Null

# Default to live ECCC unless explicitly overridden (e.g. by dev-mock.ps1).
if (-not $env:CANWXLAB_DATA_MODE)        { $env:CANWXLAB_DATA_MODE = "hybrid" }
if (-not $env:CANWXLAB_ENABLE_LIVE_ECCC) { $env:CANWXLAB_ENABLE_LIVE_ECCC = "true" }

function Get-DescendantProcessIds {
  param([int]$ParentProcessId)

  $ids = @()
  try {
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ParentProcessId" -ErrorAction SilentlyContinue
    foreach ($child in $children) {
      $ids += [int]$child.ProcessId
      $ids += Get-DescendantProcessIds -ParentProcessId ([int]$child.ProcessId)
    }
  } catch {
  }
  $ids | Select-Object -Unique
}

function Stop-ProcessTree {
  param(
    [int]$ProcessId,
    [string]$Reason = "tracked dev process"
  )

  if ($ProcessId -le 0 -or $ProcessId -eq $PID) { return }

  $allIds = @((Get-DescendantProcessIds -ParentProcessId $ProcessId)) + @($ProcessId)
  foreach ($id in ($allIds | Select-Object -Unique)) {
    if ($id -eq $PID) { continue }
    try {
      $process = Get-Process -Id $id -ErrorAction SilentlyContinue
      if ($process) {
        Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
        Write-Host "Stopped $($process.ProcessName) (PID $id) for $Reason"
      }
    } catch {
    }
  }
}

function Get-ListenerProcessIds {
  param([int]$Port)

  $ids = @()
  try {
    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop
    foreach ($connection in $connections) {
      if ($connection.OwningProcess -and $connection.OwningProcess -ne 0) {
        $ids += [int]$connection.OwningProcess
      }
    }
  } catch {
  }

  try {
    $lines = netstat -ano -p tcp 2>$null | Select-String -Pattern "LISTENING" | Where-Object {
      $_.Line -match "[:.]$Port\s+.*LISTENING\s+(\d+)\s*$"
    }
    foreach ($line in $lines) {
      if ($line.Line -match "(\d+)\s*$") {
        $ids += [int]$Matches[1]
      }
    }
  } catch {
  }

  $ids | Select-Object -Unique
}

function Get-TrackedProcessIds {
  $ids = @()

  if (Test-Path $pidFile) {
    try {
      $manifest = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
      foreach ($process in @($manifest.processes)) {
        if ($process.pid) { $ids += [int]$process.pid }
      }
      foreach ($processId in @($manifest)) {
        if ($processId -is [int] -or $processId -is [long]) { $ids += [int]$processId }
      }
    } catch {
    }
  }

  try {
    foreach ($legacyPidFile in Get-ChildItem -LiteralPath $logsDir -Filter "*.pid" -ErrorAction SilentlyContinue) {
      $value = Get-Content -LiteralPath $legacyPidFile.FullName -Raw -ErrorAction SilentlyContinue
      if ($value -match "^\s*(\d+)\s*$") { $ids += [int]$Matches[1] }
    }
  } catch {
  }

  $ids | Select-Object -Unique
}

function Stop-PreviousDevProcesses {
  Write-Host "Cleaning up previous CanWxLab dev processes..."

  foreach ($trackedPid in Get-TrackedProcessIds) {
    Stop-ProcessTree -ProcessId $trackedPid -Reason "previous PID manifest"
  }

  foreach ($port in @($ApiPort, $WebPort)) {
    foreach ($listenerPid in Get-ListenerProcessIds -Port $port) {
      Stop-ProcessTree -ProcessId $listenerPid -Reason "port $port listener"
    }
  }

  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

function Start-ApiService {
  param(
    [int]$Port
  )

  $pythonExe = Join-Path $repoRoot "services/api/.venv/Scripts/python.exe"
  if (-not (Test-Path $pythonExe)) {
    Write-Error "Missing API virtualenv python: $pythonExe. Create it first with 'python -m venv services/api/.venv' and install deps."
  }

  $stdout = Join-Path $logsDir "api.out.log"
  $stderr = Join-Path $logsDir "api.err.log"
  $process = Start-Process -FilePath $pythonExe -ArgumentList @(
      "-m",
      "uvicorn",
      "canwxlab_api.main:app",
      "--host",
      "127.0.0.1",
      "--port",
      "$Port",
      "--reload",
      "--app-dir",
      "services/api"
    ) -WorkingDirectory $repoRoot -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden

  Write-Host "Started API (PID $($process.Id))"
  Write-Host "  stdout: $stdout"
  Write-Host "  stderr: $stderr"

  [pscustomobject]@{
    name = "API"
    pid = $process.Id
    port = $Port
    command = $pythonExe
    startedAt = (Get-Date).ToString("o")
  }
}

function Start-WebService {
  param(
    [int]$Port
  )

  $nodeModules = Join-Path $repoRoot "node_modules"
  if (-not (Get-Command corepack -ErrorAction SilentlyContinue)) {
    Write-Error "corepack is unavailable. Please install Node.js and enable corepack."
  }
  if (-not (Test-Path $nodeModules)) {
    Write-Error "Missing node_modules at repo root. Run 'corepack pnpm install' first."
  }

  $stdout = Join-Path $logsDir "web.out.log"
  $stderr = Join-Path $logsDir "web.err.log"
  $webCommand = "corepack pnpm --filter @canwxlab/web dev --host 127.0.0.1 --port $Port"
  $process = Start-Process -FilePath "cmd.exe" -ArgumentList @("/d", "/s", "/c", $webCommand) `
    -WorkingDirectory $repoRoot -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden

  Write-Host "Started Web (PID $($process.Id))"
  Write-Host "  stdout: $stdout"
  Write-Host "  stderr: $stderr"

  [pscustomobject]@{
    name = "Web"
    pid = $process.Id
    port = $Port
    command = $webCommand
    startedAt = (Get-Date).ToString("o")
  }
}

Stop-PreviousDevProcesses

$startedProcesses = @()
$startedProcesses += Start-ApiService -Port $ApiPort
$startedProcesses += Start-WebService -Port $WebPort

$manifest = [pscustomobject]@{
  repoRoot = $repoRoot
  apiPort = $ApiPort
  webPort = $WebPort
  processes = $startedProcesses
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $pidFile -Encoding utf8

Write-Host ""
Write-Host "CanWxLab development URLs:"
Write-Host "  API:      http://127.0.0.1:$ApiPort"
Write-Host "  API docs: http://127.0.0.1:$ApiPort/docs"
Write-Host "  Web:      http://127.0.0.1:$WebPort"
Write-Host ""
Write-Host "Use scripts/stop-dev.ps1 to stop local dev servers."
