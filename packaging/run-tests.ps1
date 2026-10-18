# All tests without a keyboard: standalone first, then end-to-end against the stub service. Exit code 1 on any failure.
# (ASCII only: Windows PowerShell 5.1 reads BOM-less files as ANSI.)
$ErrorActionPreference = "Stop"
$env:LUNACY_NO_UPDATE = "1"
$failed = @()

function Step($name, [scriptblock]$cmd) {
    Write-Host "== $name"
    & $cmd
    if ($LASTEXITCODE -ne 0) { $script:failed += $name }
}

Step "t7 claude hooks"   { python -I tests/t7_claude_hooks.py }
Step "t9 store"   { python -I tests/t9_store.py }
Step "t12 graphics"    { python -I tests/t12_graphics.py }
Step "t13 live screen"       { python -I tests/t13_live_screen.py }
Step "t15 combos"         { python -I tests/t15_combos.py }
Step "t8 ui drafts"          { node tests/t8_ui_drafts.mjs }
Step "t14 screen plan"       { node tests/t14_screen_plan.mjs }

$stub = Start-Process python -ArgumentList "-I", "tests/stub_studio.py", "--port", "47804", "--block-delay", "0.01" -PassThru -WindowStyle Hidden
try {
    for ($i = 0; $i -lt 40; $i++) {
        try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:47804/ -TimeoutSec 1 | Out-Null; break } catch { Start-Sleep -Milliseconds 250 }
    }
    $env:STUDIO_URL = "http://127.0.0.1:47804"
    Step "t5 api"            { python -I tests/t5_studio_api.py }
    Step "t16 library"    { python -I tests/t16_library.py }
} finally {
    Stop-Process -Id $stub.Id -Force -ErrorAction SilentlyContinue
}

if ($failed.Count) { Write-Host "FAILED: $($failed -join ', ')"; exit 1 }
Write-Host "all tests passed"
