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
    $processId = $connection.OwningProcess
    if ($processId -and $processId -ne 0) {
      try {
        $process = Get-Process -Id $processId -ErrorAction Stop
        Stop-Process -Id $processId -Force
        Write-Host "Stopped $($process.ProcessName) (PID $processId) on port $port"
      } catch {
        Write-Warning "Failed stopping PID $processId on port ${port}: $_"
      }
    }
  }
}
