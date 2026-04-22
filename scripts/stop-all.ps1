$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "stop-demo.ps1")
& (Join-Path $PSScriptRoot "stop-voicebot.ps1")
