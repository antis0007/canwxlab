param(
  [int[]]$Ports = @(8787, 5173)
)

$ErrorActionPreference = "Continue"

foreach ($port in $Ports) {
  try {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop
  } catch {
    Write-Host "No listening process found on port $port"
    continue
  }

  foreach ($connection in $connections) {
    $pid = $connection.OwningProcess
    if ($pid -and $pid -ne 0) {
      try {
        $process = Get-Process -Id $pid -ErrorAction Stop
        Stop-Process -Id $pid -Force
        Write-Host "Stopped $($process.ProcessName) (PID $pid) on port $port"
      } catch {
        Write-Warning "Failed stopping PID $pid on port $port: $_"
      }
    }
  }
}
