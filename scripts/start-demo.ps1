$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $root "logs"
$frontendLog = Join-Path $logs "demo-frontend.log"
$backendLog = Join-Path $logs "demo-backend.log"

New-Item -ItemType Directory -Force -Path $logs | Out-Null

function Stop-PortProcess {
  param([int] $Port)

  $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  foreach ($connection in $connections) {
    $process = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
    if ($process -and $process.ProcessName -in @("node", "npm", "cmd", "powershell", "pwsh")) {
      Write-Host "Stopping existing process on port $Port (PID $($process.Id))"
      Stop-Process -Id $process.Id -Force
    }
  }
}

function Wait-PortFree {
  param(
    [int] $Port,
    [int] $TimeoutSeconds = 8
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $connections) {
      return
    }
    Start-Sleep -Milliseconds 250
  }
}

function Reset-LogFile {
  param([string] $Path)

  if (-not (Test-Path $Path)) {
    return
  }

  try {
    Remove-Item -LiteralPath $Path -Force -ErrorAction Stop
  } catch {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $archivePath = "$Path.$stamp"
    try {
      Rename-Item -LiteralPath $Path -NewName (Split-Path $archivePath -Leaf) -Force -ErrorAction Stop
    } catch {
      Write-Host "Log file is still locked, appending to existing log: $Path"
    }
  }
}

function Start-DemoProcess {
  param(
    [string] $Name,
    [string] $Command,
    [string] $OutFile
  )

  $errFile = [System.IO.Path]::ChangeExtension($OutFile, ".err.log")
  Reset-LogFile -Path $OutFile
  Reset-LogFile -Path $errFile

  $process = Start-Process `
    -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $Command) `
    -WorkingDirectory $root `
    -RedirectStandardOutput $OutFile `
    -RedirectStandardError $errFile `
    -PassThru

  Write-Host "$Name started (PID $($process.Id))"
}

Stop-PortProcess -Port 5177
Stop-PortProcess -Port 8787
Wait-PortFree -Port 5177
Wait-PortFree -Port 8787

Start-DemoProcess `
  -Name "Demo API server" `
  -Command "npm.cmd run dev:server" `
  -OutFile $backendLog

Start-DemoProcess `
  -Name "Demo frontend" `
  -Command "npm.cmd run dev" `
  -OutFile $frontendLog

Start-Sleep -Seconds 2

Write-Host ""
Write-Host "Demo website: http://localhost:5177"
Write-Host "Demo API:     http://localhost:8787"
Write-Host "Logs:         $logs"
