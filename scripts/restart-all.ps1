$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "stop-all.ps1")
Start-Sleep -Seconds 1
& (Join-Path $PSScriptRoot "start-all.ps1")
