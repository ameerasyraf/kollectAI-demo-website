$ErrorActionPreference = "Stop"

$connections = Get-NetTCPConnection -LocalPort 8010 -State Listen -ErrorAction SilentlyContinue
$stopped = 0

foreach ($connection in $connections) {
  $process = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
  if (-not $process) {
    continue
  }

  if ($process.ProcessName -notin @("python", "python3", "powershell", "pwsh")) {
    Write-Host "Port 8010 is owned by PID $($process.Id) ($($process.ProcessName)); leaving it alone."
    continue
  }

  Write-Host "Stopping VoiceBot backend on port 8010 (PID $($process.Id), $($process.ProcessName))"
  Stop-Process -Id $process.Id -Force
  $stopped += 1
}

if ($stopped -eq 0) {
  Write-Host "No VoiceBot backend process was stopped on port 8010."
} else {
  Write-Host "Stopped $stopped VoiceBot backend process(es)."
}
