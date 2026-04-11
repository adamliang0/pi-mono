---
description: Create and publish a GitHub release for pi-mono
---
Create a GitHub release for pi-mono following this workflow:

1. **Get version** from root `package.json`

2. **Build binaries** (if not already built):
   ```bash
   bash scripts/build-binaries.sh
   ```

3. **Release with the script**:
   ```bash
   bash scripts/release-binaries.sh <version>
   ```
   Example: `bash scripts/release-binaries.sh v0.67.1`

4. **Verify the release**: Confirm all assets are uploaded at https://github.com/adamliang0/pi-mono/releases

The script handles:
- Validating binary artifacts exist in `packages/coding-agent/binaries/`
- Pushing local tags that don't exist on remote
- Creating/updating the GitHub release
- Uploading all `*.tar.gz` and `*.zip` files

Notes:
- Binaries are: darwin-arm64, darwin-x64, linux-x64, linux-arm64, windows-x64
- If binaries need rebuilding: `bash scripts/build-binaries.sh`
- To skip builds and force re-upload: run the script anyway (it checks for artifacts)

Return:
1. The release URL
2. List of uploaded assets
3. Any issues encountered
