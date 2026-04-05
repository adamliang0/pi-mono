#!/usr/bin/env python3
"""Fetch optional native npm packages (sharp, clipboard) for all target platforms.

Uses only the Python standard library: parallel registry + tarball downloads,
extract into repo-root node_modules for Bun cross-compilation. No pip deps.
"""

from __future__ import annotations

import json
import shutil
import sys
import tarfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.client import IncompleteRead
from io import BytesIO
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

# Keep in sync with scripts/build-binaries.sh (historical npm install list).
PACKAGES: tuple[str, ...] = (
    "@mariozechner/clipboard-darwin-arm64@0.3.0",
    "@mariozechner/clipboard-darwin-x64@0.3.0",
    "@mariozechner/clipboard-linux-x64-gnu@0.3.0",
    "@mariozechner/clipboard-linux-arm64-gnu@0.3.0",
    "@mariozechner/clipboard-win32-x64-msvc@0.3.0",
    "@img/sharp-darwin-arm64@0.34.5",
    "@img/sharp-darwin-x64@0.34.5",
    "@img/sharp-linux-x64@0.34.5",
    "@img/sharp-linux-arm64@0.34.5",
    "@img/sharp-win32-x64@0.34.5",
    "@img/sharp-libvips-darwin-arm64@1.2.4",
    "@img/sharp-libvips-darwin-x64@1.2.4",
    "@img/sharp-libvips-linux-x64@1.2.4",
    "@img/sharp-libvips-linux-arm64@1.2.4",
)


def _node_modules_dest(root: Path, package_name: str) -> Path:
    if package_name.startswith("@"):
        rest = package_name[1:]
        scope, slash, pkg = rest.partition("/")
        if not slash:
            raise ValueError(f"invalid scoped name: {package_name!r}")
        return root / "node_modules" / f"@{scope}" / pkg
    return root / "node_modules" / package_name


def _extract_npm_tgz(data: bytes, dest: Path) -> None:
    """Unpack npm pack tarball (top-level ``package/``) into dest."""
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True, exist_ok=True)
    bio = BytesIO(data)
    with tarfile.open(fileobj=bio, mode="r:gz") as tf:
        prefix = "package/"
        for member in tf.getmembers():
            name = member.name
            if not name.startswith(prefix):
                continue
            rel = name[len(prefix) :].lstrip("/")
            if not rel:
                continue
            if ".." in Path(rel).parts:
                raise ValueError(f"unsafe path in archive: {name!r}")
            out = dest / rel
            if member.isdir():
                out.mkdir(parents=True, exist_ok=True)
                continue
            if not member.isfile():
                continue
            out.parent.mkdir(parents=True, exist_ok=True)
            with tf.extractfile(member) as fh:
                if fh is None:
                    continue
                out.write_bytes(fh.read())


def _fetch_json(url: str) -> object:
    req = Request(url, headers={"Accept": "application/json"})
    with urlopen(req, timeout=120) as resp:
        return json.load(resp)


def _read_http_body_fully(resp) -> bytes:
    """Read the full body; raise IncompleteRead if fewer bytes than Content-Length."""
    length_hdr = resp.headers.get("Content-Length")
    expected: int | None = None
    if length_hdr is not None and length_hdr.isdigit():
        expected = int(length_hdr)

    chunk_size = 256 * 1024
    parts: list[bytes] = []
    total = 0
    while True:
        chunk = resp.read(chunk_size)
        if not chunk:
            break
        parts.append(chunk)
        total += len(chunk)

    body = b"".join(parts)
    if expected is not None and total != expected:
        raise IncompleteRead(body, expected - total)
    return body


def _fetch_bytes(url: str) -> bytes:
    """Large registry tarballs sometimes truncate under parallel load; retry with backoff."""
    req = Request(url)
    backoff_s = 1.5
    last_err: BaseException | None = None
    for attempt in range(6):
        try:
            with urlopen(req, timeout=600) as resp:
                return _read_http_body_fully(resp)
        except IncompleteRead as e:
            last_err = e
        except HTTPError as e:
            if e.code < 500 or attempt >= 5:
                raise
            last_err = e
        except (URLError, OSError) as e:
            last_err = e

        if attempt < 5:
            time.sleep(min(backoff_s, 45.0))
            backoff_s = min(backoff_s * 1.6, 45.0)

    if last_err is not None:
        raise last_err
    raise RuntimeError("fetch failed with no error")


def _install_one(repo_root: Path, spec: str) -> str:
    package_name, version = spec.rsplit("@", 1)
    enc = quote(package_name, safe="")
    meta_url = f"https://registry.npmjs.org/{enc}/{version}"
    try:
        meta = _fetch_json(meta_url)
    except HTTPError as e:
        raise RuntimeError(f"{spec}: registry {meta_url} -> HTTP {e.code}") from e
    except URLError as e:
        raise RuntimeError(f"{spec}: registry {meta_url} -> {e.reason}") from e

    if not isinstance(meta, dict):
        raise RuntimeError(f"{spec}: unexpected registry response")
    dist = meta.get("dist")
    if not isinstance(dist, dict):
        raise RuntimeError(f"{spec}: missing dist in registry JSON")
    tarball = dist.get("tarball")
    if not isinstance(tarball, str):
        raise RuntimeError(f"{spec}: missing dist.tarball")

    try:
        tgz = _fetch_bytes(tarball)
    except HTTPError as e:
        raise RuntimeError(f"{spec}: tarball HTTP {e.code}") from e
    except URLError as e:
        raise RuntimeError(f"{spec}: tarball {e.reason}") from e

    dest = _node_modules_dest(repo_root, package_name)
    _extract_npm_tgz(tgz, dest)
    return spec


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    # Fewer concurrent large tarball pulls reduces IncompleteRead from CDN/registry.
    workers = min(6, max(1, len(PACKAGES)))
    failed: list[str] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(_install_one, repo_root, spec): spec for spec in PACKAGES
        }
        for fut in as_completed(futures):
            spec = futures[fut]
            try:
                fut.result()
            except Exception as e:
                print(f"error: {spec}: {e}", file=sys.stderr)
                failed.append(spec)

    if failed:
        print(f"failed {len(failed)} package(s)", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
