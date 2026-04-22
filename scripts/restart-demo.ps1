$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot

& (Join-Path $PSScriptRoot "stop-demo.ps1")
Start-Sleep -Seconds 1
& (Join-Path $PSScriptRoot "start-demo.ps1")
