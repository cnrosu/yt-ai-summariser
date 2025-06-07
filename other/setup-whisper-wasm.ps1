# Check if Chocolatey is installed
if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
    Write-Output "Installing Chocolatey..."
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://chocolatey.org/install.ps1'))
}

# Install dependencies
choco install git python cmake wget 7zip -y

# Clone and install Emscripten SDK
Write-Output "`nCloning Emscripten SDK..."
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
.\emsdk install latest
.\emsdk activate latest
$env:PATH += ";$PWD;${PWD}\upstream\emscripten"

# Load Emscripten into session
.\emsdk_env.ps1
cd ..

# Clone whisper.cpp
Write-Output "`nCloning whisper.cpp..."
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp

# Build with Emscripten
Write-Output "`nRunning emcmake cmake..."
emcmake cmake .
Write-Output "`nRunning emmake make..."
emmake make -j

# Download model (base.en)
Write-Output "`nDownloading ggml-base.en.bin..."
cd models
bash download-ggml-model.sh base.en

Write-Output "`nDone! Files should be in whisper.cpp\build and models\"
