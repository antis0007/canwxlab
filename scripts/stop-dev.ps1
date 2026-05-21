param(
  [int[]]$Ports = @(8787, 5173)
)

$ErrorActionPreference = "Continue"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$logsDir = Join-Path $repoRoot ".canwxlab/dev-logs"
$pidFile = Join-Path $logsDir "dev-pids.json"

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
    [string]$Reason = "dev process"
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
      Write-Warning "Failed stopping PID ${id}: $_"
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
      Write-Warning "Could not read PID manifest ${pidFile}: $_"
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

function Test-CanWxLabDevProcess {
  param([CimInstance]$Process)

  if (-not $Process.CommandLine) { return $false }
  if ([int]$Process.ProcessId -eq $PID) { return $false }

  $commandLine = $Process.CommandLine
  if ($commandLine -like "*dev-api.ps1*" -or $commandLine -like "*dev-web.ps1*") { return $true }
  if ($commandLine -like "*canwxlab_api.main:app*") { return $true }
  if ($commandLine -like "*@canwxlab/web*") { return $true }
  if ($commandLine -like "*$repoRoot*" -and $commandLine -match "uvicorn|vite|pnpm|corepack") { return $true }

  return $false
}

$stoppedAny = $false

foreach ($trackedPid in Get-TrackedProcessIds) {
  $stoppedAny = $true
  Stop-ProcessTree -ProcessId $trackedPid -Reason "PID manifest"
}

foreach ($port in $Ports) {
  $listenerIds = @(Get-ListenerProcessIds -Port $port)
  if (-not $listenerIds.Count) {
    Write-Host "No listening process found on port $port"
    continue
  }

  foreach ($listenerPid in $listenerIds) {
    $stoppedAny = $true
    Stop-ProcessTree -ProcessId $listenerPid -Reason "port $port listener"
  }
}

try {
  $orphanedDevProcesses = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    Test-CanWxLabDevProcess -Process $_
  }
  foreach ($process in $orphanedDevProcesses) {
    $stoppedAny = $true
    Stop-ProcessTree -ProcessId ([int]$process.ProcessId) -Reason "orphaned CanWxLab dev process"
  }
} catch {
}

Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue

if (-not $stoppedAny) {
  Write-Host "No CanWxLab dev processes were found."
}
