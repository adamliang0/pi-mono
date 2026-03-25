#!/usr/bin/env -S mise tool-stub
# Tool stub for local pi binary
#
# Usage:
#   mise use pi@local          # Register with mise
#   mise run install-pi        # Build and prepare binary first
#   pi -- ...                 # Then run via mise
#
# Or run directly:
#   ./pi-mise.sh -- ...

tool = "node"

[platforms.linux-x64]
bin = "packages/coding-agent/binaries/linux-x64/pi"

[platforms.linux-arm64]
bin = "packages/coding-agent/binaries/linux-arm64/pi"

[platforms.darwin-arm64]
bin = "packages/coding-agent/binaries/darwin-arm64/pi"

[platforms.darwin-x64]
bin = "packages/coding-agent/binaries/darwin-x64/pi"

[platforms.windows-x64]
bin = "packages/coding-agent/binaries/windows-x64/pi.exe"
