param(
  [int]$ApiPort = 8787,
  [int]$WebPort = 5173
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$logsDir = Join-Path $repoRoot ".canwxlab/dev-logs"
New-Item -ItemType Directory -Path $logsDir -Force | Out-Null

function Get-ListenerProcess {
  param([int]$Port)
  try {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
    if (-not $conn) { return $null }
    return Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
  } catch {
    return $null
  }
}

function Start-ServiceScript {
  param(
    [string]$ScriptPath,
    [string]$Name,
    [string]$LogName
  )
  $stdout = Join-Path $logsDir "$LogName.out.log"
  $stderr = Join-Path $logsDir "$LogName.err.log"
  $process = Start-Process -FilePath "powershell.exe" -ArgumentList @(
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", $ScriptPath
    ) -WorkingDirectory $repoRoot -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  Write-Host "Started $Name (PID $($process.Id))"
  Write-Host "  stdout: $stdout"
  Write-Host "  stderr: $stderr"
}

$apiProcess = Get-ListenerProcess -Port $ApiPort
if ($apiProcess) {
  Write-Host "API already running on port $ApiPort ($($apiProcess.ProcessName) PID $($apiProcess.Id))."
} else {
  Start-ServiceScript -ScriptPath (Join-Path $PSScriptRoot "dev-api.ps1") -Name "API" -LogName "api"
}

$webProcess = Get-ListenerProcess -Port $WebPort
if ($webProcess) {
  Write-Host "Web already running on port $WebPort ($($webProcess.ProcessName) PID $($webProcess.Id))."
} else {
  Start-ServiceScript -ScriptPath (Join-Path $PSScriptRoot "dev-web.ps1") -Name "Web" -LogName "web"
}

Write-Host ""
Write-Host "CanWxLab development URLs:"
Write-Host "  API:      http://127.0.0.1:$ApiPort"
Write-Host "  API docs: http://127.0.0.1:$ApiPort/docs"
Write-Host "  Web:      http://127.0.0.1:$WebPort"
Write-Host ""
Write-Host "Use scripts/stop-dev.ps1 to stop local dev servers."
