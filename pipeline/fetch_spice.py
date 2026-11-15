"""Fetch the NAIF SPICE kernels that passes.py needs, refreshing only what NAIF has updated.

Written with AI assistance (Claude), directed and reviewed by the team.

Base kernels (leap seconds, planetary constants, planet and Mars-satellite ephemerides) rarely
change. The MRO and Mars Odyssey spacecraft ephemerides (mro_psp.bsp, m01_map.bsp) are NAIF's
ever-growing files, refreshed every few days with new reconstruction and a short prediction, so
the pass window can only extend as far as their latest release.

A file is downloaded again only when NAIF's Last-Modified or Content-Length differs from the copy
on disk (recorded in kernels.meta.json), so a scheduled job re-fetches only what changed.

    python pipeline/fetch_spice.py                     # into data/raw/naif_spice
    python pipeline/fetch_spice.py --orbiters MRO,ODY  # the default

TGO and Mars Express kernels are distributed by ESA, not NAIF's generic tree, and are not fetched;
passes.py skips an orbiter whose kernel is missing.

Standard library only.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

NAIF = "https://naif.jpl.nasa.gov/pub/naif/"
BASE = {
    "naif0012.tls": "generic_kernels/lsk/naif0012.tls",
    "pck00011.tpc": "generic_kernels/pck/pck00011.tpc",
    "de442s.bsp": "generic_kernels/spk/planets/de442s.bsp",
    "mar099s.bsp": "generic_kernels/spk/satellites/mar099s.bsp",
}
ORBITERS = {
    "MRO": {"mro_psp.bsp": "MRO/kernels/spk/mro_psp.bsp"},
    "ODY": {"m01_map.bsp": "M01/kernels/spk/m01_map.bsp"},
}
USER_AGENT = "marswalk-pipeline"
META = "kernels.meta.json"


def remote_stamp(url: str) -> dict:
    request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return {"last_modified": response.headers.get("Last-Modified"), "bytes": int(response.headers.get("Content-Length") or 0)}


def needs_download(path: Path, known: dict | None, remote: dict) -> bool:
    """True when the file is missing, its size differs, or NAIF reports a different Last-Modified."""
    if not path.exists() or not known:
        return True
    return path.stat().st_size != remote["bytes"] or known.get("last_modified") != remote["last_modified"]


def download(url: str, target: Path) -> None:
    partial = target.with_suffix(target.suffix + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=600) as response, open(partial, "wb") as out:
            while chunk := response.read(1 << 20):
                out.write(chunk)
    except Exception:
        partial.unlink(missing_ok=True)
        raise
    partial.replace(target)


def fetch(kernels_dir: Path, orbiters: list[str]) -> dict[str, dict]:
    kernels_dir.mkdir(parents=True, exist_ok=True)
    meta_path = kernels_dir / META
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    wanted = dict(BASE)
    for orbiter in orbiters:
        wanted.update(ORBITERS[orbiter])
    for name, rel in wanted.items():
        url = NAIF + rel
        remote = remote_stamp(url)
        target = kernels_dir / name
        if needs_download(target, meta.get(name), remote):
            print(f"downloading {name} ({remote['bytes'] / 1e6:.1f} MB, {remote['last_modified']})", flush=True)
            download(url, target)
            if target.stat().st_size != remote["bytes"]:
                raise RuntimeError(f"{name}: got {target.stat().st_size} bytes, NAIF reported {remote['bytes']}")
        else:
            print(f"up to date  {name} ({remote['last_modified']})")
        meta[name] = {"url": url, **remote}
        meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    return meta


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--kernels-dir", type=Path, default=Path("data/raw/naif_spice"))
    parser.add_argument("--orbiters", default="MRO,ODY", help=f"comma-separated, from {','.join(ORBITERS)}")
    args = parser.parse_args(argv)
    orbiters = [o.strip().upper() for o in args.orbiters.split(",") if o.strip()]
    unknown = [o for o in orbiters if o not in ORBITERS]
    if unknown:
        parser.error(f"cannot fetch {', '.join(unknown)} from NAIF")
    fetch(args.kernels_dir, orbiters)
    return 0


if __name__ == "__main__":
    sys.exit(main())
