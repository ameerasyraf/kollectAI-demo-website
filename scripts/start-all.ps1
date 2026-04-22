$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "start-voicebot.ps1")
& (Join-Path $PSScriptRoot "start-demo.ps1")

Write-Host ""
Write-Host "Open: http://localhost:5177/voicebot"
