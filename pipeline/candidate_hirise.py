"""HiRISE browse images for the top-ranked candidate sites and the known sites with detail.

Written with AI assistance (Claude), directed and reviewed by the team.

For each target site this asks the PDS Geosciences ODE REST API for MRO HiRISE RDR V1.1
products around the site point, keeps those whose footprint contains the point, picks one
observation, and downloads its map-projected RED browse JPEG (a few MB, not the JP2).

Targets: the 10 best non-vetoed new candidates by file score, ties in file order (the same
rule as topCandidates in app/src/globe/annotations/ranking.ts), plus every known site with
detail_available.

Outputs (git-ignored):
  data/globe/hirise/<site_id>.jpg   browse image per covered site
  data/globe/hirise/index.json      per-site observation, footprint, credit and site pixel
  data/raw/candidate_hirise/        cached ODE answers, labels, browse images, manifest.json

Run:  .venv/Scripts/python -I pipeline/candidate_hirise.py
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import shutil
import sys
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITES_JSON = ROOT / "data" / "globe" / "sites.json"
OUT_DIR = ROOT / "data" / "globe" / "hirise"
CACHE = ROOT / "data" / "raw" / "candidate_hirise"

ODE_URL = "https://oderest.rsl.wustl.edu/live2/"
USER_AGENT = "Marswalk/1.0 data pipeline"
TOP_N = 10
# Half-width of the query box around a site, degrees; containment is then tested exactly.
QUERY_HALF_DEG = 0.001
# Observations at or below this emission angle count as near-nadir.
NADIR_DEG = 10.0
MAX_TOTAL_BYTES = 60 * 1024 * 1024

CREDIT = "NASA/JPL/University of Arizona"
LICENCE = "Public domain: no copyright restriction on HiRISE images; credit requested"
LICENCE_URL = "https://www.uahirise.org/media/usage.php"
SOURCE = "MRO HiRISE RDR V1.1 (MRO-M-HIRISE-3-RDR-V1.1) via PDS Geosciences ODE REST"
SELECTION_RULE = (
    "Among RED products whose footprint contains the site point (COLOR only when no RED "
    f"covers it): the newest near-nadir one (emission <= {NADIR_DEG:g} deg); if none is "
    "near-nadir, the smallest emission angle, newest on ties. RED is preferred because its "
    "browse covers the full 6 km swath; COLOR covers only the central strip."
)


# --- Targets -------------------------------------------------------------------------


def target_sites(sites: list[dict], n: int = TOP_N) -> list[dict]:
    """Top n non-vetoed new candidates by score (file order on ties), then detail sites."""
    ranked = sorted(
        ((i, s) for i, s in enumerate(sites) if s["kind"] == "new" and not s["vetoed"]),
        key=lambda t: (-t[1]["score"], t[0]),
    )
    top = [s for _, s in ranked[:n]]
    known = [s for s in sites if s["kind"] != "new" and s["detail_available"]]
    return top + known


# --- Geometry ------------------------------------------------------------------------


def lon_360(lon: float) -> float:
    """East-positive longitude in [0, 360)."""
    return lon % 360.0


def wrap_180(lon: float) -> float:
    """Longitude in [-180, 180)."""
    return (lon + 180.0) % 360.0 - 180.0


def parse_wkt_rings(wkt: str) -> list[list[tuple[float, float]]]:
    """Outer and inner rings of a WKT POLYGON or MULTIPOLYGON as (lon, lat) lists."""
    rings = []
    for body in re.findall(r"\(([^()]+)\)", wkt):
        pts = []
        for pair in body.split(","):
            x, y = pair.split()
            pts.append((float(x), float(y)))
        rings.append(pts)
    return rings


def point_in_ring(lon: float, lat: float, ring: list[tuple[float, float]]) -> bool:
    """Even-odd ray test in plain lon/lat (footprints are a few km, far from the poles)."""
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > lat) != (y2 > lat):
            x_cross = x1 + (lat - y1) * (x2 - x1) / (y2 - y1)
            if lon < x_cross:
                inside = not inside
    return inside


def footprint_contains(wkt: str, lon360: float, lat: float) -> bool:
    """True when the footprint polygon (east-positive 0-360) contains the point."""
    return any(point_in_ring(lon360, lat, ring) for ring in parse_wkt_rings(wkt))


def footprint_lonlat(wkt: str, site_lon: float) -> list[list[float]]:
    """First ring as [lon, lat] pairs, each longitude taken within 180 deg of the site's.

    Keeps a footprint that straddles the antimeridian continuous; elsewhere the values
    are in -180..180.
    """
    ring = parse_wkt_rings(wkt)[0]
    return [[round(site_lon + wrap_180(x - site_lon), 5), round(y, 5)] for x, y in ring]


# --- ODE products --------------------------------------------------------------------


def ode_query_url(lon: float, lat: float, half: float = QUERY_HALF_DEG) -> str:
    """ODE product query for HiRISE RDR V1.1 products overlapping a small box at the point."""
    x = lon_360(lon)
    params = {
        "query": "product",
        "results": "fmp",
        "output": "JSON",
        "target": "mars",
        "ihid": "MRO",
        "iid": "HIRISE",
        "pt": "RDRV11",
        "westlon": f"{max(x - half, 0.0):.4f}",
        "eastlon": f"{min(x + half, 360.0):.4f}",
        "minlat": f"{lat - half:.4f}",
        "maxlat": f"{lat + half:.4f}",
    }
    return ODE_URL + "?" + urllib.parse.urlencode(params)


def ode_products(doc: dict) -> list[dict]:
    """The product list of an ODE JSON answer; an empty list when none was found."""
    products = doc["ODEResults"].get("Products")
    if not isinstance(products, dict):
        return []
    items = products["Product"]
    return items if isinstance(items, list) else [items]


def colour_of(product: dict) -> str:
    """'RED' or 'COLOR' from the product id suffix."""
    return product["pdsid"].rsplit("_", 1)[-1]


def browse_url(product: dict) -> str:
    """URL of the plain map-projected browse JPEG of a product."""
    want = f"{product['pdsid']}.BROWSE.JPG"
    for f in product["Product_files"]["Product_file"]:
        if f["FileName"].upper() == want:
            return f["URL"]
    raise KeyError(f"no {want} listed for {product['pdsid']}")


def label_url(product: dict) -> str:
    return product["LabelURL"]


def choose_observation(
    products: list[dict], lon: float, lat: float, skip: frozenset[str] = frozenset()
) -> tuple[dict, str, int] | None:
    """Best product covering the point, with the reason and the count of covering observations.

    skip holds product ids already found blank at the site (a CCD gap or the image edge).
    """
    x = lon_360(lon)
    covering = [p for p in products if footprint_contains(p["Footprint_geometry"], x, lat)]
    observations = len({p["Observation_id"] for p in covering})
    usable = [p for p in covering if p["pdsid"] not in skip]
    if not usable:
        return None
    pool = [p for p in usable if colour_of(p) == "RED"] or usable
    kind = colour_of(pool[0])
    nadir = [p for p in pool if float(p["Emission_angle"]) <= NADIR_DEG]
    if nadir:
        best = max(nadir, key=lambda p: p["Observation_time"])
        reason = (
            f"Newest of {len(nadir)} near-nadir {kind} products (emission <= {NADIR_DEG:g} deg) "
            f"among {observations} observations covering the site"
        )
    else:
        best = min(pool, key=lambda p: (float(p["Emission_angle"]), _neg_time(p["Observation_time"])))
        reason = (
            f"Smallest emission angle ({float(best['Emission_angle']):.1f} deg) of {len(pool)} {kind} "
            f"products covering the site; none within {NADIR_DEG:g} deg"
        )
    if skip:
        reason += f"; skipped {len(skip)} with no image data at the site ({', '.join(sorted(skip))})"
    return best, reason, observations


def _neg_time(iso: str) -> tuple[int, ...]:
    """Sort key that orders ISO times newest first."""
    return tuple(-int(v) for v in re.findall(r"\d+", iso))


# --- Label and site pixel ------------------------------------------------------------


def parse_label(text: str) -> dict:
    """Projection and size keywords of a HiRISE RDR PDS3 label."""
    def value(key: str) -> str:
        m = re.search(rf"^\s*{key}\s*=\s*\"?([^\"<\r\n]+)", text, re.MULTILINE)
        if not m:
            raise KeyError(key)
        return m.group(1).strip()

    return {
        "projection": value("MAP_PROJECTION_TYPE"),
        "radius_m": float(value("A_AXIS_RADIUS")) * 1000.0,
        "center_lat": float(value("CENTER_LATITUDE")),
        "center_lon": float(value("CENTER_LONGITUDE")),
        "map_scale": float(value("MAP_SCALE")),
        "line_offset": float(value("LINE_PROJECTION_OFFSET")),
        "sample_offset": float(value("SAMPLE_PROJECTION_OFFSET")),
        "lines": int(value("LINES")),
        "samples": int(value("LINE_SAMPLES")),
    }


def site_pixel(label: dict, lon: float, lat: float, width: int, height: int) -> list[float] | None:
    """Pixel (x right, y down, from the top-left corner) of a point in the browse image.

    Equirectangular only (HiRISE uses it below 65 deg latitude); None for polar stereographic.
    Full-resolution pixel from the label (ISIS convention: upper-left x = -(sample_offset
    + 0.5) * scale, upper-left y = (line_offset + 0.5) * scale), then scaled to the browse size.
    """
    if label["projection"] != "EQUIRECTANGULAR":
        return None
    r = label["radius_m"]
    x = r * math.radians(wrap_180(lon - label["center_lon"])) * math.cos(math.radians(label["center_lat"]))
    y = r * math.radians(lat)
    sample = x / label["map_scale"] + label["sample_offset"] + 0.5
    line = label["line_offset"] + 0.5 - y / label["map_scale"]
    return [
        round(sample * width / label["samples"], 1),
        round(line * height / label["lines"], 1),
    ]


def has_data_at(gray: list[list[int]], px: list[float], radius: int = 4, floor: int = 8) -> bool:
    """True when most pixels in a small square around px are brighter than the black fill.

    gray is a row-major greyscale image (rows of 0-255 values).
    """
    cx, cy = int(px[0]), int(px[1])
    values = [
        row[x]
        for row in gray[max(cy - radius, 0) : cy + radius + 1]
        for x in range(max(cx - radius, 0), min(cx + radius + 1, len(row)))
    ]
    return bool(values) and sum(v > floor for v in values) * 2 > len(values)


# --- Index ---------------------------------------------------------------------------


def covered_entry(
    site: dict,
    product: dict,
    reason: str,
    observations: int,
    label: dict,
    size: tuple[int, int],
    nbytes: int,
) -> dict:
    """index.json record for a site with a HiRISE image."""
    width, height = size
    obs = product["Observation_id"]
    return {
        "covered": True,
        "name": site["name"],
        "observation_id": obs,
        "product_id": product["pdsid"],
        "acquired": product["Observation_time"][:10],
        "resolution_m_px": float(product["Map_scale"]),
        "browse_m_px": round(float(product["Map_scale"]) * label["samples"] / width, 2),
        "emission_deg": round(float(product["Emission_angle"]), 2),
        "footprint": footprint_lonlat(product["Footprint_geometry"], site["lon"]),
        "page_url": f"https://www.uahirise.org/{obs}",
        "image": f"hirise/{site['id']}.jpg",
        "image_px": [width, height],
        "image_bytes": nbytes,
        "site_px": site_pixel(label, site["lon"], site["lat"], width, height),
        "observations_covering": observations,
        "reason": reason,
        "credit": CREDIT,
    }


def uncovered_entry(site: dict, blank: int = 0) -> dict:
    """index.json record for a site without a usable HiRISE image.

    blank counts products whose footprint contains the point but whose image is empty there.
    """
    reason = (
        f"{blank} HiRISE products cover the site point but none has image data there"
        if blank
        else "No HiRISE RDR V1.1 footprint in ODE contains the site point"
    )
    return {"covered": False, "name": site["name"], "reason": reason}


def build_index(entries: dict[str, dict], queried: str) -> dict:
    return {
        "version": 1,
        "source": SOURCE,
        "credit": CREDIT,
        "licence": LICENCE,
        "licence_url": LICENCE_URL,
        "queried": queried,
        "selection_rule": SELECTION_RULE,
        "sites": entries,
    }


# --- Downloads -----------------------------------------------------------------------


def fetch(url: str, dest: Path) -> Path:
    """Download url to dest unless it is cached already."""
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=180) as response, tmp.open("wb") as out:
        shutil.copyfileobj(response, out)
    tmp.replace(dest)
    return dest


def read_gray(path: Path) -> tuple[list[list[int]], tuple[int, int]]:
    """Greyscale rows and (width, height) of a JPEG."""
    from PIL import Image

    with Image.open(path) as im:
        g = im.convert("L")
        w, h = g.size
        flat = list(g.tobytes())
    return [flat[i * w : (i + 1) * w] for i in range(h)], (w, h)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    sites = json.loads(SITES_JSON.read_text(encoding="utf-8"))["sites"]
    targets = target_sites(sites)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    entries: dict[str, dict] = {}
    cached_files = []
    total = 0
    for site in targets:
        sid = site["id"]
        ode_path = fetch(ode_query_url(site["lon"], site["lat"]), CACHE / "ode" / f"{sid}.json")
        cached_files.append(ode_path)
        products = ode_products(json.loads(ode_path.read_text(encoding="utf-8")))
        skip: set[str] = set()
        while True:
            choice = choose_observation(products, site["lon"], site["lat"], frozenset(skip))
            if choice is None:
                break
            product, reason, observations = choice
            pid = product["pdsid"]
            lbl = fetch(label_url(product), CACHE / "labels" / f"{pid}.LBL")
            jpg = fetch(browse_url(product), CACHE / "browse" / f"{pid}.browse.jpg")
            cached_files += [lbl, jpg]
            label = parse_label(lbl.read_text(encoding="latin-1"))
            gray, size = read_gray(jpg)
            px = site_pixel(label, site["lon"], site["lat"], *size)
            if px is None or has_data_at(gray, px):
                break
            skip.add(pid)
        if choice is None:
            entries[sid] = uncovered_entry(site, len(skip))
            print(f"{sid}: no HiRISE coverage")
            continue
        out = OUT_DIR / f"{sid}.jpg"
        shutil.copyfile(jpg, out)
        nbytes = out.stat().st_size
        total += nbytes
        entries[sid] = covered_entry(site, product, reason, observations, label, size, nbytes)
        print(f"{sid}: {pid} {product['Observation_time'][:10]} {nbytes / 1e6:.2f} MB  {reason}")

    if total > MAX_TOTAL_BYTES:
        print(f"Images total {total / 1e6:.1f} MB, over the {MAX_TOTAL_BYTES / 1e6:.0f} MB budget", file=sys.stderr)
        return 1

    queried = date.today().isoformat()
    manifest = {
        "dataset": "candidate_hirise",
        "source": SOURCE,
        "source_url": ODE_URL,
        "licence": LICENCE,
        "licence_url": LICENCE_URL,
        "credit": CREDIT,
        "queried": queried,
        "files": [
            {"path": p.relative_to(CACHE).as_posix(), "sha256": sha256(p), "bytes": p.stat().st_size}
            for p in cached_files
        ],
    }
    (CACHE / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (OUT_DIR / "index.json").write_text(json.dumps(build_index(entries, queried), indent=2), encoding="utf-8")
    covered = sum(e["covered"] for e in entries.values())
    print(f"{covered}/{len(entries)} sites covered; images {total / 1e6:.1f} MB -> {OUT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
