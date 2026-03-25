#!/usr/bin/env bash
#
# Build pi binary for current platform and prepare for mise tool stub
# Usage: mise run install-pi
#
set -euo pipefail

cd "$(dirname "$0")/.."

# Detect platform only
if [[ "${1:-}" == "--detect-only" ]]; then
    case "$(uname -s)/$(uname -m)" in
        Darwin/arm64)  echo "darwin-arm64" ;;
        Darwin/x86_64) echo "darwin-x64" ;;
        Linux/x86_64)  echo "linux-x64" ;;
        Linux/aarch64) echo "linux-arm64" ;;
        CYGWIN*|MINGW*|MSYS*) echo "windows-x64" ;;
        *) echo "Unsupported platform: $(uname -s)/$(uname -m)"; exit 1 ;;
    esac
    exit 0
fi

# Determine platform
case "$(uname -s)/$(uname -m)" in
    Darwin/arm64)  PLATFORM=darwin-arm64 ;;
    Darwin/x86_64) PLATFORM=darwin-x64 ;;
    Linux/x86_64)  PLATFORM=linux-x64 ;;
    Linux/aarch64) PLATFORM=linux-arm64 ;;
    CYGWIN*|MINGW*|MSYS*) PLATFORM=windows-x64 ;;
    *) echo "Unsupported platform: $(uname -s)/$(uname -m)"; exit 1 ;;
esac

echo "==> Building for $PLATFORM..."

# Create output directory
mkdir -p "packages/coding-agent/binaries/$PLATFORM"

# Build packages if needed
if [ ! -d "packages/coding-agent/dist" ]; then
    echo "==> Building packages..."
    bun run build
fi

# Build binary
if [[ "$PLATFORM" == windows-x64 ]]; then
    bun build --compile --external koffi --target=bun-$PLATFORM \
        packages/coding-agent/dist/bun/cli.js \
        --outfile "packages/coding-agent/binaries/$PLATFORM/pi.exe"
else
    bun build --compile --external koffi --target=bun-$PLATFORM \
        packages/coding-agent/dist/bun/cli.js \
        --outfile "packages/coding-agent/binaries/$PLATFORM/pi"
    chmod +x "packages/coding-agent/binaries/$PLATFORM/pi"
fi

# Copy assets
echo "==> Copying assets..."
cd packages/coding-agent

cp package.json README.md CHANGELOG.md "binaries/$PLATFORM/" 2>/dev/null || true

mkdir -p "binaries/$PLATFORM/theme"
cp dist/modes/interactive/theme/*.json "binaries/$PLATFORM/theme/" 2>/dev/null || true

mkdir -p "binaries/$PLATFORM/export-html/vendor"
cp -r dist/core/export-html "binaries/$PLATFORM/" 2>/dev/null || true
cp dist/core/export-html/vendor/*.js "binaries/$PLATFORM/export-html/vendor/" 2>/dev/null || true

cp -r docs examples "binaries/$PLATFORM/" 2>/dev/null || true

# Copy wasm and koffi if present
cp ../../node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm "binaries/$PLATFORM/" 2>/dev/null || true

if [[ "$PLATFORM" == windows-x64 ]]; then
    mkdir -p "binaries/$PLATFORM/node_modules/koffi/build/koffi/win32_x64"
    cp ../../node_modules/koffi/index.js "binaries/$PLATFORM/node_modules/koffi/" 2>/dev/null || true
    cp ../../node_modules/koffi/package.json "binaries/$PLATFORM/node_modules/koffi/" 2>/dev/null || true
    cp ../../node_modules/koffi/build/koffi/win32_x64/koffi.node "binaries/$PLATFORM/node_modules/koffi/build/koffi/win32_x64/" 2>/dev/null || true
fi

echo ""
echo "==> Done! Binary at: packages/coding-agent/binaries/$PLATFORM/pi"
echo "    Run with: pi"
