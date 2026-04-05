#!/usr/bin/env bash
#
# Build pi binaries for all platforms locally.
# Mirrors .github/workflows/build-binaries.yml
#
# Usage:
#   bash scripts/build-binaries.sh [--skip-deps] [--platform <platform>]
#   (Do not run with `bun ./scripts/build-binaries.sh` — Bun treats .sh as JS and fails.)
#   Or: chmod +x scripts/build-binaries.sh && ./scripts/build-binaries.sh ...
#
# Options:
#   --skip-deps         Skip installing cross-platform dependencies
#   --platform <name>   Build only for specified platform (darwin-arm64, darwin-x64, linux-x64, linux-arm64, windows-x64)
#
# Output:
#   packages/coding-agent/binaries/
#     pi-darwin-arm64.tar.gz
#     pi-darwin-x64.tar.gz
#     pi-linux-x64.tar.gz
#     pi-linux-arm64.tar.gz
#     pi-windows-x64.zip
#   bin/pi (repo root, gitignored)
#     Copy of the built binary for the current host OS/arch when that platform
#     was included in this run (skipped on unsupported hosts or mismatched --platform).

set -euo pipefail

cd "$(dirname "$0")/.."

SKIP_DEPS=false
PLATFORM=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-deps)
            SKIP_DEPS=true
            shift
            ;;
        --platform)
            PLATFORM="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Validate platform if specified
if [[ -n "$PLATFORM" ]]; then
    case "$PLATFORM" in
        darwin-arm64|darwin-x64|linux-x64|linux-arm64|windows-x64)
            ;;
        *)
            echo "Invalid platform: $PLATFORM"
            echo "Valid platforms: darwin-arm64, darwin-x64, linux-x64, linux-arm64, windows-x64"
            exit 1
            ;;
    esac
fi

echo "==> Installing dependencies..."
bun install --frozen-lockfile

if [[ "$SKIP_DEPS" == "false" ]]; then
    echo "==> Installing cross-platform native bindings..."
    # Bun only resolves optional native packages for the host OS; the binary build
    # embeds all targets. Fetch registry tarballs in parallel (stdlib Python only;
    # avoids npm/arborist on Bun's node_modules) and unpack into root node_modules.
    PYTHON="${PYTHON:-python3}"
    if ! command -v "${PYTHON}" >/dev/null 2>&1; then
        echo "error: ${PYTHON} not found (needed for fetch-native-bindings.py)" >&2
        exit 1
    fi
    "${PYTHON}" scripts/fetch-native-bindings.py
else
    echo "==> Skipping cross-platform native bindings (--skip-deps)"
fi

echo "==> Building all packages..."
bun run build

echo "==> Building binaries..."
cd packages/coding-agent

# Clean previous builds
rm -rf binaries
mkdir -p binaries/{darwin-arm64,darwin-x64,linux-x64,linux-arm64,windows-x64}

# Determine which platforms to build
if [[ -n "$PLATFORM" ]]; then
    PLATFORMS=("$PLATFORM")
else
    PLATFORMS=(darwin-arm64 darwin-x64 linux-x64 linux-arm64 windows-x64)
fi

for platform in "${PLATFORMS[@]}"; do
    echo "Building for $platform..."
    # Externalize koffi to avoid embedding all 18 platform .node files (~74MB)
    # into every binary. Koffi is only used on Windows for VT input and the
    # call site has a try/catch fallback. For Windows builds, we copy the
    # appropriate .node file alongside the binary below.
    if [[ "$platform" == "windows-x64" ]]; then
        bun build --compile --external koffi --target=bun-$platform ./dist/bun/cli.js --outfile binaries/$platform/pi.exe
    else
        bun build --compile --external koffi --target=bun-$platform ./dist/bun/cli.js --outfile binaries/$platform/pi
    fi
done

echo "==> Creating release archives..."

REPO_ROOT="$(cd ../.. && pwd)"
PHOTON_WASM="$(find "$REPO_ROOT/node_modules" -name photon_rs_bg.wasm -path '*photon-node*' -print -quit)"
if [[ -z "$PHOTON_WASM" || ! -f "$PHOTON_WASM" ]]; then
    echo "Could not find photon_rs_bg.wasm under $REPO_ROOT/node_modules (bun/npm layout)."
    exit 1
fi
KOFFI_PKG="$(find "$REPO_ROOT/node_modules" -path '*/node_modules/koffi/package.json' -print -quit)"
if [[ -z "$KOFFI_PKG" || ! -f "$KOFFI_PKG" ]]; then
    echo "Could not find koffi under $REPO_ROOT/node_modules."
    exit 1
fi
KOFFI_ROOT="$(dirname "$KOFFI_PKG")"

# Copy shared files to each platform directory
for platform in "${PLATFORMS[@]}"; do
    cp package.json binaries/$platform/
    cp README.md binaries/$platform/
    cp CHANGELOG.md binaries/$platform/
    cp "$PHOTON_WASM" binaries/$platform/
    mkdir -p binaries/$platform/theme
    cp dist/modes/interactive/theme/*.json binaries/$platform/theme/
    cp -r dist/core/export-html binaries/$platform/
    cp -r docs binaries/$platform/
    cp -r examples binaries/$platform/

    # Copy koffi native module for Windows (needed for VT input support)
    if [[ "$platform" == "windows-x64" ]]; then
        mkdir -p binaries/$platform/node_modules/koffi/build/koffi/win32_x64
        cp "$KOFFI_ROOT/index.js" binaries/$platform/node_modules/koffi/
        cp "$KOFFI_ROOT/package.json" binaries/$platform/node_modules/koffi/
        cp "$KOFFI_ROOT/build/koffi/win32_x64/koffi.node" binaries/$platform/node_modules/koffi/build/koffi/win32_x64/
    fi
done

# Create archives
cd binaries

for platform in "${PLATFORMS[@]}"; do
    if [[ "$platform" == "windows-x64" ]]; then
        # Windows (zip)
        echo "Creating pi-$platform.zip..."
        (cd $platform && zip -r ../pi-$platform.zip .)
    else
        # Unix (tar.gz): flat root (pi, docs, …) so GitHub/mise extract into the version dir
        # without strip_components; same shape as the Windows zip.
        echo "Creating pi-$platform.tar.gz..."
        tar -czf pi-$platform.tar.gz -C "$platform" .
    fi
done

# Extract archives for easy local testing
echo "==> Extracting archives for testing..."
for platform in "${PLATFORMS[@]}"; do
    rm -rf $platform
    if [[ "$platform" == "windows-x64" ]]; then
        mkdir -p $platform && (cd $platform && unzip -q ../pi-$platform.zip)
    else
        mkdir -p $platform && tar -xzf pi-$platform.tar.gz -C $platform
    fi
done

echo ""
echo "==> Build complete!"
echo "Archives available in packages/coding-agent/binaries/"
ls -lh *.tar.gz *.zip 2>/dev/null || true
echo ""
echo "Extracted directories for testing:"
for platform in "${PLATFORMS[@]}"; do
    echo "  binaries/$platform/pi"
done

# Install host binary to repo-root bin/ (copy; leaves binaries/<platform> intact)
REPO_ROOT="$(cd ../../.. && pwd)"
HOST_OS="$(uname -s)"
HOST_ARCH="$(uname -m)"
HOST_PLATFORM=""
case "$HOST_OS" in
    Darwin)
        case "$HOST_ARCH" in
            arm64) HOST_PLATFORM="darwin-arm64" ;;
            x86_64) HOST_PLATFORM="darwin-x64" ;;
        esac
        ;;
    Linux)
        case "$HOST_ARCH" in
            aarch64|arm64) HOST_PLATFORM="linux-arm64" ;;
            x86_64|amd64) HOST_PLATFORM="linux-x64" ;;
        esac
        ;;
esac

if [[ -z "$HOST_PLATFORM" ]]; then
    echo ""
    echo "==> Skipping bin/: host OS/arch not mapped ($HOST_OS / $HOST_ARCH)"
else
    HOST_BUILT=false
    for platform in "${PLATFORMS[@]}"; do
        if [[ "$platform" == "$HOST_PLATFORM" ]]; then
            HOST_BUILT=true
            break
        fi
    done
    if [[ "$HOST_BUILT" == "false" ]]; then
        echo ""
        echo "==> Skipping bin/: this run did not build $HOST_PLATFORM (current host)"
    else
        mkdir -p "$REPO_ROOT/bin"
        if [[ "$HOST_PLATFORM" == "windows-x64" ]]; then
            cp "$HOST_PLATFORM/pi.exe" "$REPO_ROOT/bin/pi.exe"
            echo ""
            echo "==> Installed $REPO_ROOT/bin/pi.exe"
        else
            cp "$HOST_PLATFORM/pi" "$REPO_ROOT/bin/pi"
            chmod +x "$REPO_ROOT/bin/pi"
            echo ""
            echo "==> Installed $REPO_ROOT/bin/pi"
        fi
    fi
fi
