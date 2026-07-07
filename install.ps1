$host.UI.RawUI.WindowTitle = "Impact Kit - Installer"
$host.UI.RawUI.BackgroundColor = "Black"
$host.UI.RawUI.ForegroundColor = "White"
Clear-Host

# Characters
$tl    = [string][char]0x2554  # ╔
$tr    = [string][char]0x2557  # ╗
$bl    = [string][char]0x255A  # ╚
$br    = [string][char]0x255D  # ╝
$dh    = [string][char]0x2550  # ═
$dv    = [string][char]0x2551  # ║
$block = [string][char]0x2588  # █
$shade = [string][char]0x2593  # ▓
$chk   = [string][char]0x2714  # ✔
$arr   = [string][char]0x203A  # ›
$dot   = [string][char]0x00B7  # ·

$W       = 34
$hBorder = $dh * ($W + 2)
$barLen  = $W

# ── Detect install state ─────────────────────────────
$extDir   = "$env:APPDATA\Adobe\CEP\extensions"
$dest     = "$extDir\com.sora.impactkit"
$newVer   = "v1.0.0"
$isUpdate = Test-Path $dest
$oldVer   = $null

if ($isUpdate) {
    $oldManifest = Join-Path $dest "CSXS\manifest.xml"
    if (Test-Path $oldManifest) {
        $xml    = [xml](Get-Content $oldManifest)
        $oldVer = "v" + $xml.ExtensionManifest.ExtensionBundleVersion
    }
}

# ── Box helpers ──────────────────────────────────────
function Box-Top    { Write-Host "  $tl$hBorder$tr" -ForegroundColor DarkGreen }
function Box-Bottom { Write-Host "  $bl$hBorder$br" -ForegroundColor DarkGreen }
function Box-Empty  {
    Write-Host "  $dv" -ForegroundColor DarkGreen -NoNewline
    Write-Host ("".PadRight($W + 2)) -NoNewline
    Write-Host "$dv" -ForegroundColor DarkGreen
}
function Box-Row([string]$text, [string]$fg = "Green") {
    Write-Host "  $dv" -ForegroundColor DarkGreen -NoNewline
    Write-Host $text.PadRight($W + 2) -ForegroundColor $fg -NoNewline
    Write-Host "$dv" -ForegroundColor DarkGreen
}

function Finalize-Install {
    foreach ($f in @("install.bat","install.ps1")) {
        $p = Join-Path $dest $f
        if (Test-Path $p) { Remove-Item $p -Force }
    }
    $gitDir = Join-Path $dest ".git"
    if (Test-Path $gitDir) { Remove-Item $gitDir -Recurse -Force }

    $commit = $null
    try {
        Push-Location $PSScriptRoot
        $commit = (git rev-parse HEAD 2>$null)
        Pop-Location
    } catch { $commit = $null }

    if ($commit) {
        $versionJson = "{`"commit`": `"$commit`", `"installedAt`": `"$(Get-Date -Format o)`"}"
        Set-Content -Path (Join-Path $dest "version.json") -Value $versionJson -Encoding UTF8 -NoNewline
    }
}

function Progress-Step([string]$label, [scriptblock]$action) {
    Write-Host ""
    $dots = "." * ([math]::Max(1, 28 - $label.Length))
    Write-Host "  $arr " -ForegroundColor DarkGreen -NoNewline
    Write-Host $label.ToUpper() -ForegroundColor Cyan -NoNewline
    Write-Host " $dots " -ForegroundColor DarkGreen -NoNewline
    Write-Host "[  0%]" -ForegroundColor DarkGreen

    $labelY = $host.UI.RawUI.CursorPosition.Y - 1
    $pctX   = 4 + $label.Length + $dots.Length + 2 + 1

    Box-Top
    Write-Host "  $dv " -ForegroundColor DarkGreen -NoNewline
    Write-Host ($shade * $barLen) -ForegroundColor DarkGreen -NoNewline
    Write-Host " $dv" -ForegroundColor DarkGreen

    $barLineY = $host.UI.RawUI.CursorPosition.Y - 1
    $barX     = 4

    & $action

    $barPos = New-Object System.Management.Automation.Host.Coordinates $barX, $barLineY
    $host.UI.RawUI.CursorPosition = $barPos

    for ($i = 0; $i -lt $barLen; $i++) {
        Start-Sleep -Milliseconds 25
        Write-Host $block -ForegroundColor Green -NoNewline
        $pct    = [math]::Round(($i + 1) * 100 / $barLen)
        $curPos = $host.UI.RawUI.CursorPosition
        $pctPos = New-Object System.Management.Automation.Host.Coordinates $pctX, $labelY
        $host.UI.RawUI.CursorPosition = $pctPos
        Write-Host $pct.ToString().PadLeft(3) -ForegroundColor Green -NoNewline
        $host.UI.RawUI.CursorPosition = $curPos
    }

    $nextLine = New-Object System.Management.Automation.Host.Coordinates 0, ($barLineY + 1)
    $host.UI.RawUI.CursorPosition = $nextLine
    Box-Bottom
}

# ── Header ───────────────────────────────────────────
Write-Host ""
Box-Top
Box-Empty

if ($isUpdate) {
    Box-Row "   IMPACT KIT" "White"
    if ($oldVer -and $oldVer -ne $newVer) {
        Box-Row "   $oldVer  $arr  $newVer" "Cyan"
    } else {
        Box-Row "   Reinstalling $newVer" "Cyan"
    }
} else {
    Box-Row "   IMPACT KIT" "White"
    Box-Row "   After Effects Extension  $dot  $newVer" "Cyan"
}

Box-Empty
Box-Bottom

Write-Host ""
Write-Host "  " -NoNewline
Write-Host " INITIALIZING " -BackgroundColor DarkGreen -ForegroundColor Black -NoNewline
Write-Host ""
Start-Sleep -Milliseconds 600

# ── Steps ────────────────────────────────────────────
if ($isUpdate) {

    Progress-Step "Removing old version" {
        Start-Sleep -Milliseconds 300
    }

    Progress-Step "Installing new version" {
        if (-not (Test-Path $extDir)) { $null = New-Item -ItemType Directory -Path $extDir }
        if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
        Copy-Item $PSScriptRoot $dest -Recurse -Force
        Finalize-Install
    }

    Progress-Step "Verifying files" {
        Start-Sleep -Milliseconds 200
    }

} else {

    Progress-Step "Enabling CEP debug mode" {
        foreach ($ver in @("11","12")) {
            $null = reg add "HKEY_CURRENT_USER\SOFTWARE\Adobe\CSXS.$ver" /v PlayerDebugMode /t REG_STRING /d 1 /f 2>&1
        }
    }

    Progress-Step "Preparing directory" {
        if (-not (Test-Path $extDir)) { $null = New-Item -ItemType Directory -Path $extDir }
    }

    Progress-Step "Installing extension" {
        if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
        Copy-Item $PSScriptRoot $dest -Recurse -Force
        Finalize-Install
    }

}

# ── Dependency check ─────────────────────────────────
$requiredFiles = @(
    "index.html",
    "css\style.css",
    "js\main.js",
    "js\presets.js",
    "js\CSInterface.js",
    "jsx\main.jsx",
    "CSXS\manifest.xml",
    "presets\DS1.ffx"
)

$missing = @()
foreach ($f in $requiredFiles) {
    if (-not (Test-Path (Join-Path $dest $f))) { $missing += $f }
}

if ($missing.Count -gt 0) {
    Write-Host ""
    Write-Host "  " -NoNewline
    Write-Host " MISSING FILES DETECTED " -BackgroundColor DarkRed -ForegroundColor White
    Write-Host ""
    foreach ($f in $missing) {
        Write-Host "  ! " -ForegroundColor Red -NoNewline
        Write-Host $f -ForegroundColor Yellow
    }

    # Auto-fix: CSInterface.js
    if ($missing -contains "js\CSInterface.js") {
        Progress-Step "Fetching CSInterface.js" {
            $jsDest = Join-Path $dest "js"
            if (-not (Test-Path $jsDest)) { $null = New-Item -ItemType Directory -Path $jsDest }
            $url = "https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/CEP_12.x/CSInterface.js"
            try {
                Invoke-WebRequest -Uri $url -OutFile (Join-Path $jsDest "CSInterface.js") -UseBasicParsing -ErrorAction Stop
            } catch { }
        }
        $missing = $missing | Where-Object { $_ -ne "js\CSInterface.js" }
    }

    if ($missing.Count -gt 0) {
        Write-Host ""
        Write-Host "  ! " -ForegroundColor Red -NoNewline
        Write-Host "Could not auto-fix: " -ForegroundColor Yellow -NoNewline
        Write-Host ($missing -join ", ") -ForegroundColor Red
        Write-Host "  Try re-downloading the extension and running install again." -ForegroundColor DarkGray
        Write-Host ""
    }
} else {
    Write-Host ""
    Write-Host "  " -NoNewline
    Write-Host " ALL FILES VERIFIED " -BackgroundColor DarkGreen -ForegroundColor Black
    Write-Host ""
}

# ── Done ─────────────────────────────────────────────
Write-Host ""
Box-Top
Box-Empty

if ($isUpdate) {
    Box-Row "   $chk  UPDATE COMPLETE  $dot  $newVer" "Green"
} else {
    Box-Row "   $chk  INSTALLATION COMPLETE" "Green"
}

Box-Empty
Box-Row "   Restart AE to apply changes." "DarkGreen"
Box-Row "   Window $dot Extensions $dot Impact Kit" "DarkGreen"
Box-Empty
Box-Bottom

Write-Host ""
Write-Host "  " -NoNewline
Write-Host " ALL SYSTEMS GO " -BackgroundColor Green -ForegroundColor Black
Write-Host ""
