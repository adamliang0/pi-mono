#!/usr/bin/env bash
#
# Push pi binary artifacts to GitHub releases.
# Creates a release and uploads all platform binaries.
#
# Usage:
#   bash scripts/release-binaries.sh <version>
#   Example: bash scripts/release-binaries.sh v0.67.1
#
# Prerequisites:
#   - Binaries must be built (run build-binaries.sh first)
#   - Must be authenticated with gh CLI (gh auth status)
#
# Output:
#   Creates/updates GitHub release at https://github.com/adamliang0/pi-mono/releases/tag/<version>
#   Uploads: *.tar.gz (macOS/Linux), *.zip (Windows)

set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="${1:-}"

if [[ -z "$VERSION" ]]; then
    echo "Usage: bash scripts/release-binaries.sh <version>"
    echo "Example: bash scripts/release-binaries.sh v0.67.1"
    exit 1
fi

# Validate version format
if [[ ! "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9]+)?$ ]]; then
    echo "Invalid version format: $VERSION"
    echo "Expected format: v0.0.0 or v0.0.0-beta"
    exit 1
fi

BINARIES_DIR="packages/coding-agent/binaries"

if [[ ! -d "$BINARIES_DIR" ]]; then
    echo "Error: Binaries directory not found: $BINARIES_DIR"
    echo "Run 'bash scripts/build-binaries.sh' first."
    exit 1
fi

cd "$BINARIES_DIR"

# Collect artifact files
ARTIFACTS=()
for f in *.tar.gz *.zip; do
    if [[ -f "$f" && "$f" != "*.tar.gz" && "$f" != "*.zip" ]]; then
        ARTIFACTS+=("$f")
    fi
done

if [[ ${#ARTIFACTS[@]} -eq 0 ]]; then
    echo "Error: No binary artifacts found in $BINARIES_DIR"
    echo "Expected: *.tar.gz, *.zip files"
    exit 1
fi

echo "==> Found ${#ARTIFACTS[@]} artifact(s):"
for f in "${ARTIFACTS[@]}"; do
    ls -lh "$f"
done

# Check if tag exists locally
LOCAL_TAG=$(git tag -l "$VERSION" 2>/dev/null || true)
REMOTE_TAG=$(git ls-remote --tags origin "$VERSION" 2>/dev/null | cut -f1 || true)

if [[ -n "$LOCAL_TAG" && -z "$REMOTE_TAG" ]]; then
    echo ""
    echo "==> Tag $VERSION exists locally but not on remote. Pushing..."
    git push origin "$VERSION"
elif [[ -z "$LOCAL_TAG" ]]; then
    echo "Error: Tag $VERSION does not exist locally"
    echo "Create it first with: git tag $VERSION && git push origin $VERSION"
    exit 1
else
    echo "==> Tag $VERSION already exists on remote"
fi

# Create or update release
echo ""
echo "==> Creating GitHub release $VERSION..."

# Check if release already exists
EXISTING=$(gh release view "$VERSION" --json url --jq .url 2>/dev/null || true)

if [[ -n "$EXISTING" ]]; then
    echo "Release already exists: $EXISTING"
    echo "==> Uploading artifacts..."
    gh release upload "$VERSION" "${ARTIFACTS[@]}" --clobber
else
    echo "==> Creating new release..."
    gh release create "$VERSION" "${ARTIFACTS[@]}" \
        --title "$VERSION" \
        --notes "Binary release for $VERSION" \
        --draft=false \
        --prerelease=false
fi

echo ""
echo "==> Release complete!"
echo "URL: https://github.com/adamliang0/pi-mono/releases/tag/$VERSION"
