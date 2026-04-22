$ErrorActionPreference = "Stop"

$demoRoot = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $demoRoot "logs"
$outFile = Join-Path $logs "voicebot-8010.log"
$errFile = Join-Path $logs "voicebot-8010.err.log"

function Test-VoiceBotRepoRoot {
  param([string] $Path)

  if ([string]::IsNullOrWhiteSpace($Path)) {
    return $false
  }

  $backendMain = Join-Path $Path "backend\main.py"
  return (Test-Path $backendMain)
}

function Resolve-VoiceBotRepoRoot {
  $candidates = @()

  if ($env:VOICEBOT_REPO_ROOT) {
    $candidates += $env:VOICEBOT_REPO_ROOT
  }

  $workspaceRoot = Split-Path -Parent $demoRoot
  $candidates += $workspaceRoot
  $candidates += (Join-Path $workspaceRoot "kollect-ai-voicebot")
  $candidates += (Join-Path $workspaceRoot "voicebot")

  foreach ($candidate in $candidates) {
    if (Test-VoiceBotRepoRoot -Path $candidate) {
      return (Resolve-Path $candidate).Path
    }
  }

  throw "Could not find the VoiceBot repo. Set VOICEBOT_REPO_ROOT to the folder that contains backend\main.py."
}

$repoRoot = Resolve-VoiceBotRepoRoot
$venvPython = Join-Path $repoRoot ".venv\Scripts\python.exe"
$python = if (Test-Path $venvPython) { $venvPython } else { "python" }

New-Item -ItemType Directory -Force -Path $logs | Out-Null

$existing = Get-NetTCPConnection -LocalPort 8010 -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "VoiceBot backend already appears to be listening on http://localhost:8010"
  return
}

if (Test-Path $outFile) {
  Remove-Item -LiteralPath $outFile -Force
}
if (Test-Path $errFile) {
  Remove-Item -LiteralPath $errFile -Force
}

$command = @"
`$env:PORT = '8010'
`$env:PYTHONUTF8 = '1'
`$env:PYTHONIOENCODING = 'utf-8'
`$OutputEncoding = [System.Text.UTF8Encoding]::new(`$false)
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new(`$false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(`$false)
Set-Location "$repoRoot"
& "$python" -m backend.main
"@

$process = Start-Process `
  -FilePath "powershell.exe" `
  -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $command) `
  -WorkingDirectory $repoRoot `
  -RedirectStandardOutput $outFile `
  -RedirectStandardError $errFile `
  -PassThru

Write-Host "VoiceBot backend starting on http://localhost:8010 (PID $($process.Id))"
Write-Host "VoiceBot repo: $repoRoot"
Write-Host "Logs: $outFile"
