# Start the existing local test installation without rebuilding or reloading its UI.
[CmdletBinding()]
param(
    [int]$Port = 8012,
    [switch]$Restart,
    [string]$TavernRoot = '',
    [string]$DataRoot = ''
)
$ErrorActionPreference = 'Stop'
if (-not $TavernRoot) { $TavernRoot = Join-Path $PSScriptRoot '..\..\_codex-tavern-e2e' }
if (-not $DataRoot) { $DataRoot = Join-Path $PSScriptRoot '..\..\_codex-tavern-data-tower-e2e' }
$taskTavernRoot = (Resolve-Path -LiteralPath $TavernRoot).Path
$taskDataRoot = (Resolve-Path -LiteralPath $DataRoot).Path
foreach ($taskRequired in @((Join-Path $taskTavernRoot 'server.js'), (Join-Path $taskDataRoot 'default-user\settings.json'))) {
    if (-not (Test-Path -LiteralPath $taskRequired -PathType Leaf)) { throw "Missing existing installation: $taskRequired" }
}
$taskUrl = "http://127.0.0.1:$Port/"
$taskListener = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
$taskStarted = $false
if ($taskListener.Count -gt 0) {
    $taskOwnerIds = @($taskListener.OwningProcess | Select-Object -Unique)
    if ($taskOwnerIds.Count -ne 1) { throw "Port $Port has multiple owners; no process was stopped." }
    $taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($taskOwnerIds[0])"
    if ($taskProcess.Name -ne 'node.exe' -or $taskProcess.CommandLine -notmatch 'server\.js' -or
        $taskProcess.CommandLine -notmatch [regex]::Escape($taskDataRoot)) {
        throw "Port $Port belongs to a different process; no process was stopped."
    }
    $taskProcessId = $taskProcess.ProcessId
    if ($Restart) {
        Stop-Process -Id $taskProcessId -ErrorAction Stop
        Wait-Process -Id $taskProcessId -Timeout 10 -ErrorAction SilentlyContinue
        $taskListener = @()
    }
}
if ($taskListener.Count -eq 0) {
    $taskLogRoot = Join-Path $PSScriptRoot '..\tmp'
    New-Item -ItemType Directory -Path $taskLogRoot -Force | Out-Null
    $taskStamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $taskStdout = Join-Path $taskLogRoot "tavern-start-$taskStamp.out.log"
    $taskStderr = Join-Path $taskLogRoot "tavern-start-$taskStamp.err.log"
    $taskNodePath = (Get-Command node.exe -ErrorAction Stop).Source
    $taskArguments = @('server.js', '--port', "$Port", '--dataRoot', ('"{0}"' -f $taskDataRoot))
    $taskChild = Start-Process -FilePath $taskNodePath -ArgumentList $taskArguments -WorkingDirectory $taskTavernRoot `
        -WindowStyle Hidden -RedirectStandardOutput $taskStdout -RedirectStandardError $taskStderr -PassThru
    $taskProcessId = $taskChild.Id
    $taskStarted = $true
}
$taskDeadline = (Get-Date).AddSeconds(45)
do {
    try {
        $taskResponse = Invoke-WebRequest -Uri $taskUrl -UseBasicParsing -TimeoutSec 3
        if ($taskResponse.StatusCode -eq 200) {
            [pscustomobject]@{ Url = $taskUrl; ProcessId = $taskProcessId; Started = $taskStarted; HttpStatus = 200 }
            return
        }
    } catch { }
    if (-not (Get-Process -Id $taskProcessId -ErrorAction SilentlyContinue)) {
        throw "Local server exited. Inspect its startup log in tmp; existing data was retained."
    }
    Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $taskDeadline)
throw "Local server did not become ready at $taskUrl. Inspect its startup log in tmp."
