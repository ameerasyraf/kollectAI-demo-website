$ErrorActionPreference = "Stop"

$ports = @(5177, 8787)
$stopped = 0

foreach ($port in $ports) {
  $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($connection in $connections) {
    $process = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
    if (-not $process) {
      continue
    }

    Write-Host "Stopping demo process on port $port (PID $($process.Id), $($process.ProcessName))"
    Stop-Process -Id $process.Id -Force
    $stopped += 1
  }
}

foreach ($port in $ports) {
  $deadline = (Get-Date).AddSeconds(8)
  while ((Get-Date) -lt $deadline) {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $connections) {
      break
    }
    Start-Sleep -Milliseconds 250
  }
}

if ($stopped -eq 0) {
  Write-Host "No demo website processes were listening on ports 5177 or 8787."
} else {
  Write-Host "Stopped $stopped demo process(es)."
}
