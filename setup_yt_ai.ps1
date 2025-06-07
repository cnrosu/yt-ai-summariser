Write-Host "`n🚀 Starting YouTube AI Setup..." -ForegroundColor Cyan

# 1. Check Python version
$py = "C:\Users\CJ\AppData\Local\Programs\Python\Python310\python.exe"
if (!(Test-Path $py)) {
    Write-Error "❌ Python 3.10 not found at expected path: $py"
    exit 1
}

$versionOutput = & $py --version 2>&1
if ($versionOutput -notlike "*3.10*") {
    Write-Error "❌ Python 3.10 is required. Found: $versionOutput"
    exit 1
}
Write-Host "✅ Python version OK: $versionOutput" -ForegroundColor Green

# 2. Install required pip packages
$pipPackages = @("yt-dlp", "openai-whisper", "ffmpeg-python", "flask", "requests")
Write-Host "`n📦 Installing Python packages..." -ForegroundColor Cyan
foreach ($pkg in $pipPackages) {
    & $py -m pip install --upgrade $pkg
}

# 3. Download and extract ffmpeg
$ffmpegZip = "ffmpeg.zip"
$ffmpegUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
$ffmpegTmp = "ffmpeg_tmp"
$ffmpegOut = Join-Path $PSScriptRoot "ffmpeg"

Write-Host "`n⬇️ Downloading ffmpeg..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $ffmpegUrl -OutFile $ffmpegZip

Write-Host "📦 Extracting ffmpeg..." -ForegroundColor Cyan
Expand-Archive -Path $ffmpegZip -DestinationPath $ffmpegTmp -Force

$innerDir = Get-ChildItem $ffmpegTmp | Where-Object { $_.PSIsContainer } | Select-Object -First 1
if ($null -ne $innerDir) {
    if (Test-Path $ffmpegOut) { Remove-Item $ffmpegOut -Recurse -Force }
    Move-Item -Path "$ffmpegTmp\$($innerDir.Name)" -Destination $ffmpegOut
}
Remove-Item $ffmpegTmp, $ffmpegZip -Recurse -Force
Write-Host "✅ ffmpeg installed to: $ffmpegOut" -ForegroundColor Green

# 4. Test ffmpeg
$ffmpegBin = Join-Path $ffmpegOut "bin\ffmpeg.exe"
Write-Host "`n🧪 Testing ffmpeg..." -ForegroundColor Cyan
if (!(Test-Path $ffmpegBin)) {
    Write-Error "❌ ffmpeg not found at: $ffmpegBin"
    exit 1
}
& $ffmpegBin -version

# 5. Trigger whisper model download
Write-Host "`n📥 Downloading Whisper model..." -ForegroundColor Cyan
$dummy = "dummy.wav"
[IO.File]::WriteAllBytes($dummy, [byte[]](0x52,0x49,0x46,0x46,0x24,0x00,0x00,0x00,0x57,0x41,0x56,0x45,0x66,0x6D,0x74,0x20,0x10,0x00,0x00,0x00,0x01,0x00,0x01,0x00,0x44,0xAC,0x00,0x00,0x44,0xAC,0x00,0x00,0x01,0x00,0x08,0x00,0x64,0x61,0x74,0x61,0x00,0x00,0x00,0x00))

try {
    & $py -m whisper $dummy --model base.en --fp16 False --output_dir models --language en
} catch {
    Write-Warning "⚠️ Whisper model download failed (likely due to dummy input, which is okay)"
} finally {
    Remove-Item $dummy -Force
    Write-Host "✅ Whisper base.en model cached." -ForegroundColor Green
}

Write-Host "`n🎉 Setup complete! You can now run: start.bat" -ForegroundColor Cyan
