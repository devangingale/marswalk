"""Build 2:1 equirectangular panoramas and panoramas.json for the 360-degree surface view.

Written with AI assistance (Claude), directed and reviewed by the team.

Every value written comes from a NASA source or from this repository's own pipelines; nothing
is invented:

  - Image, PIA id, title, rover, instrument, credit: the NASA Photojournal entry
    (pipeline/panoramas.sources.json), with the official caption fetched from its page.
  - Position, elevation, heading: shared/poses/<site>_poses.csv (PDS PLACES rover
    localization), last pose of the panorama's sol, or the nearest localized sol.
  - Drive distance to the next stop: the sum of the localized pose-to-pose segments between
    the two stops' poses, on the Mars IAU ellipsoid.
  - Slope and walkability: sampled from a grids.py route-grid bundle (grid.json, elev.bin,
    cost.bin) that covers the stop. With no covering bundle they are null, never guessed.
  - Relay passes: the passes.py SPICE bundle for the site, filtered to MRO and Mars Odyssey
    and copied to app/public/passes/<site>.json. With no bundle, passes_url is null.

Each mosaic is scaled to the same angular resolution across and down and padded into a strict
2:1 frame (4096 x 2048 by default). Missing-data gaps (near-white or near-black) show a sky or
regolith gradient. The image's centre column faces the stop's heading.

    python pipeline/build_panoramas.py --download     # fetch images and captions, then build
    python pipeline/build_panoramas.py                # build from what is on disk

Only Pillow is needed beyond the standard library.
"""
from __future__ import annotations

import argparse
import csv
import html
import json
import math
import re
import shutil
import struct
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / "pipeline" / "panoramas.sources.json"
RAW = ROOT / "data" / "raw" / "panos"
APP_PUBLIC = ROOT / "app" / "public"
OUT_JSON = APP_PUBLIC / "panoramas.json"
OUT_DIR = APP_PUBLIC / "panos"
PASSES_DIR = APP_PUBLIC / "passes"
POSES = ROOT / "shared" / "poses"
# Where grids.py / passes.py bundles live: the coordinator's full bundles first, then the sample.
BUNDLE_DIRS = (ROOT / "data" / "sites" / "{site}" / "bundle", APP_PUBLIC / "sample" / "{site}")

# Mars IAU 2000 ellipsoid, as Cesium's Ellipsoid.MARS.
MARS_A = 3396190.0
MARS_B = 3376200.0
RELAY_ORBITERS = ("MRO", "ODY")
# Walkability classes from the grids.py cost value (score = 6*slope_deg + 40*roughness_m):
# 255 is impassable (over 20 degrees or nodata) -> hazard; score >= 100 -> caution; else safe.
CAUTION_SCORE = 100
USER_AGENT = "marswalk-pipeline"

# Mosaics are large; these are trusted NASA sources, so lift Pillow's decompression-bomb guard.
Image.MAX_IMAGE_PIXELS = 2_000_000_000

# Fill colours: dusty ochre sky at the horizon fading to dark space overhead, dark rust regolith below.
SKY_TOP = (0x12, 0x0D, 0x0A)
SKY_HORIZON = (0x7A, 0x52, 0x38)
GROUND_HORIZON = (74, 40, 25)
GROUND_BOTTOM = (20, 11, 8)
FEATHER_PX = 24
# Mosaics leave missing-data gaps where no frame was taken: near-white (Mastcam-Z, along the
# sky edge) or near-black (Mastcam, ragged blocks at the top and bottom). Daylight Mars
# scenes have no true pure black or white, so both are treated as gaps.
WHITE_THRESHOLD = 235
BLACK_THRESHOLD = 8


def fetch(url: str, timeout: int = 300) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def download_image(source: dict, raw: Path) -> None:
    target = raw / source["file"]
    if target.exists():
        return
    print(f"downloading {source['url']} -> {target}")
    partial = target.with_suffix(target.suffix + ".part")
    request = urllib.request.Request(source["url"], headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=300) as response, open(partial, "wb") as out:
            while chunk := response.read(1 << 20):
                out.write(chunk)
    except Exception:
        partial.unlink(missing_ok=True)
        raise
    partial.rename(target)


def caption_from_page(page_html: str) -> str | None:
    """The official caption: the first descriptive paragraph on a Photojournal page."""
    text = re.sub(r"(?is)<(script|style).*?</\1>", "", page_html)
    for raw in re.findall(r"(?is)<p[^>]*>(.*?)</p>", text):
        para = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", raw))).strip()
        para = re.sub(r"^Description\s+", "", para)
        if 100 <= len(para) <= 2000 and not para.startswith(("Explore", "Photojournal Note")):
            return para
    return None


def download_caption(source: dict, raw: Path) -> None:
    target = raw / f"{source['pia_id']}.caption.txt"
    if target.exists():
        return
    caption = caption_from_page(fetch(source["page"], 60).decode("utf-8", "replace"))
    if not caption:
        raise RuntimeError(f"no caption found on {source['page']}")
    target.write_text(caption + "\n", encoding="utf-8")
    print(f"caption {source['pia_id']}: {caption[:70]}...")


def load_poses(site: str) -> list[dict]:
    """Every localized pose for a site, in drive order (the CSV is chronological)."""
    with open(POSES / f"{site}_poses.csv", newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def pose_index_for_sol(poses: list[dict], sol: int) -> int:
    """
    Where the rover stood on a sol: its last localized pose on or before that sol, since it stays
    where a drive ended until the next one. Only with no earlier pose, the first pose after.
    """
    earlier = [i for i, p in enumerate(poses) if int(p["sol"]) <= sol]
    if earlier:
        return earlier[-1]
    return min(range(len(poses)), key=lambda i: (int(poses[i]["sol"]), i))


def segment_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Ground distance between two nearby points on the Mars ellipsoid (local radii of curvature)."""
    phi = math.radians((lat1 + lat2) / 2)
    e2 = 1 - (MARS_B / MARS_A) ** 2
    w = math.sqrt(1 - e2 * math.sin(phi) ** 2)
    meridional = MARS_A * (1 - e2) / w**3
    normal = MARS_A / w
    dlon = (lon2 - lon1 + 540) % 360 - 180
    dy = math.radians(lat2 - lat1) * meridional
    dx = math.radians(dlon) * normal * math.cos(phi)
    return math.hypot(dx, dy)


def drive_distance_m(poses: list[dict], i: int, j: int) -> float:
    """Distance the rover drove between pose i and pose j, summed segment by segment."""
    a, b = sorted((i, j))
    return sum(
        segment_m(float(p["lat"]), float(p["lon"]), float(q["lat"]), float(q["lon"]))
        for p, q in zip(poses[a:b], poses[a + 1 : b + 1])
    )


class GridBundle:
    """A grids.py route grid (grid.json + elev.bin + cost.bin) with its site.json origin."""

    def __init__(self, folder: Path):
        self.folder = folder
        self.header = json.loads((folder / "grid.json").read_text(encoding="utf-8"))
        self.origin = json.loads((folder / "site.json").read_text(encoding="utf-8"))["origin"]
        self.width, self.height = self.header["width"], self.header["height"]
        self.cell_x, self.cell_y = self.header["cell_x_m"], self.header["cell_y_m"]
        elev, cost = self.header["elev"], self.header["cost"]
        self.elev = struct.unpack(f"<{self.width * self.height}H", (folder / elev["file"]).read_bytes())
        self.cost = (folder / cost["file"]).read_bytes()
        self.scale, self.offset, self.nodata = elev["scale_m"], elev["offset_m"], elev["nodata"]
        self.impassable = cost["impassable"]
        self.max_slope = self.header.get("limits", {}).get("max_slope_deg")

    @classmethod
    def find(cls, site: str) -> "GridBundle | None":
        for pattern in BUNDLE_DIRS:
            folder = Path(str(pattern).format(site=site))
            if all((folder / f).exists() for f in ("grid.json", "site.json")):
                return cls(folder)
        return None

    def row_col(self, lat: float, lon: float) -> tuple[int, int]:
        """The same mapping as the app's lib/grid.ts lonlatToRowCol."""
        o = self.origin
        x = MARS_A * math.cos(math.radians(o["lat_c"])) * math.radians((lon - o["lon0"] + 540) % 360 - 180)
        y = MARS_A * math.radians(lat - o["lat0"])
        return math.floor((self.height * self.cell_y - y) / self.cell_y), math.floor(x / self.cell_x)

    def elevation(self, row: int, col: int) -> float | None:
        if not (0 <= row < self.height and 0 <= col < self.width):
            return None
        raw = self.elev[row * self.width + col]
        return None if raw == self.nodata else self.offset + raw * self.scale

    def sample(self, lat: float, lon: float) -> dict | None:
        """Slope (3x3 central difference) and walkability at a point; None outside the grid."""
        row, col = self.row_col(lat, lon)
        z = {(dr, dc): self.elevation(row + dr, col + dc) for dr in (-1, 0, 1) for dc in (-1, 0, 1)}
        if z[(0, 0)] is None:
            return None
        cost = self.cost[row * self.width + col]
        slope = None
        if all(v is not None for v in (z[(0, -1)], z[(0, 1)], z[(-1, 0)], z[(1, 0)])):
            dzdx = (z[(0, 1)] - z[(0, -1)]) / (2 * self.cell_x)
            dzdy = (z[(-1, 0)] - z[(1, 0)]) / (2 * self.cell_y)
            slope = round(math.degrees(math.atan(math.hypot(dzdx, dzdy))), 1)
        walkability = "hazard" if cost == self.impassable else "caution" if cost >= CAUTION_SCORE else "safe"
        return {
            "walkability": walkability,
            "slope_deg": slope,
            "walkability_source": f"grids.py cost grid ({self.header.get('cost_source', 'cost')}, "
            f"{self.cell_x:g} m cells) in {self.folder.relative_to(ROOT)}",
        }


def copy_relay_passes(site: str, out_dir: Path) -> str | None:
    """Copies the site's passes.py bundle, filtered to MRO and Odyssey; returns its app URL."""
    for pattern in BUNDLE_DIRS:
        source = Path(str(pattern).format(site=site)) / "passes.json"
        if source.exists():
            bundle = json.loads(source.read_text(encoding="utf-8"))
            bundle["passes"] = [p for p in bundle["passes"] if p["orbiter"] in RELAY_ORBITERS]
            bundle["orbiters"] = [o for o in bundle.get("orbiters", []) if o in RELAY_ORBITERS]
            bundle["copied_from"] = str(source.relative_to(ROOT))
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / f"{site}.json").write_text(json.dumps(bundle, indent=1) + "\n", encoding="utf-8")
            return f"./{out_dir.name}/{site}.json"
    return None


def vertical_gradient(width: int, height: int, top: tuple, bottom: tuple) -> Image.Image:
    column = Image.new("RGB", (1, height))
    for y in range(height):
        t = y / max(1, height - 1)
        column.putpixel((0, y), tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
    return column.resize((width, height))


def sky_gradient(width: int, height: int) -> Image.Image:
    """Dark space overhead easing into dusty ochre at the horizon (smoothstep, so no visible band)."""
    column = Image.new("RGB", (1, height))
    for y in range(height):
        t = y / max(1, height - 1)
        t = t * t * (3 - 2 * t)
        column.putpixel((0, y), tuple(round(a + (b - a) * t) for a, b in zip(SKY_TOP, SKY_HORIZON)))
    return column.resize((width, height))


def missing_data(image: Image.Image) -> Image.Image:
    """Mask (255 = gap) of near-white and near-black missing-data pixels, grown and softened so no fringe is left."""
    bands = image.split()
    r, g, b = (band.point(lambda v: 255 if v > WHITE_THRESHOLD else 0) for band in bands)
    white = ImageChops.multiply(ImageChops.multiply(r, g), b)
    r, g, b = (band.point(lambda v: 255 if v < BLACK_THRESHOLD else 0) for band in bands)
    black = ImageChops.multiply(ImageChops.multiply(r, g), b)
    gaps = ImageChops.lighter(white, black)
    return gaps.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(2))


def background(width: int, height: int) -> Image.Image:
    frame = Image.new("RGB", (width, height))
    half = height // 2
    frame.paste(sky_gradient(width, half), (0, 0))
    frame.paste(vertical_gradient(width, height - half, GROUND_HORIZON, GROUND_BOTTOM), (0, half))
    return frame


def to_equirectangular(strip: Image.Image, width: int, hfov_deg: float, center_pitch_deg: float) -> Image.Image:
    """Pads a panorama strip into a 2:1 frame. The strip's centre column lands on the frame's centre."""
    height = width // 2
    strip = strip.convert("RGB")
    hfov = max(1.0, min(360.0, float(hfov_deg)))
    target_w = round(width * hfov / 360)
    # Same angular resolution down as across.
    target_h = round(target_w * strip.height / strip.width)
    scaled = strip.resize((target_w, target_h), Image.Resampling.LANCZOS)
    centre_y = height / 2 - center_pitch_deg * height / 180
    top = round(centre_y - target_h / 2)
    # Anything above the zenith or below the nadir is cropped.
    if top < 0:
        scaled = scaled.crop((0, -top, target_w, target_h))
        top = 0
    if top + scaled.height > height:
        scaled = scaled.crop((0, 0, target_w, height - top))
    left = (width - target_w) // 2

    frame = background(width, height)
    # Feather the strip's edges into the fill so the seam is soft.
    mask = Image.new("L", scaled.size, 0)
    inset = FEATHER_PX // 2
    sides = (inset if hfov < 360 else -FEATHER_PX, inset, scaled.width - 1 - (inset if hfov < 360 else -FEATHER_PX), scaled.height - 1 - inset)
    ImageDraw.Draw(mask).rectangle(sides, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(FEATHER_PX / 3))
    # Missing-data cutouts show the sky (or regolith) gradient behind them instead.
    mask = ImageChops.subtract(mask, missing_data(scaled))
    frame.paste(scaled, (left, top), mask)
    return frame


def build(
    sources: list[dict], raw: Path, out_dir: Path, out_json: Path, passes_dir: Path, width: int, quality: int
) -> list[dict]:
    out_dir.mkdir(parents=True, exist_ok=True)
    poses_by_site: dict[str, list[dict]] = {}
    grids: dict[str, GridBundle | None] = {}
    passes: dict[str, str | None] = {}
    stops = []
    for s in sources:
        path = raw / s["file"]
        caption_path = raw / f"{s['pia_id']}.caption.txt"
        if not path.exists() or not caption_path.exists():
            print(f"skip {s['id']}: image or caption missing in {raw} (run with --download)", file=sys.stderr)
            continue
        site = s["site"]
        poses = poses_by_site.setdefault(site, load_poses(site))
        index = pose_index_for_sol(poses, int(s["sol"]))
        pose = poses[index]
        stated = s.get("center_heading_deg")
        heading = (float(pose["heading_deg"]) if stated is None else float(stated)) % 360
        heading_source = "caption" if stated is not None else f"rover yaw, sol {pose['sol']}"
        if site not in grids:
            grids[site] = GridBundle.find(site)
        sampled = grids[site].sample(float(pose["lat"]), float(pose["lon"])) if grids[site] else None
        if site not in passes:
            passes[site] = copy_relay_passes(site, passes_dir)

        with Image.open(path) as strip:
            frame = to_equirectangular(strip, width, s.get("hfov_deg", 360), s.get("center_pitch_deg", 0))
        image_path = out_dir / f"{s['id']}.jpg"
        frame.save(image_path, "JPEG", quality=quality, optimize=True, progressive=True)
        print(
            f"{s['id']}: {s['pia_id']} -> {image_path.name}, pose sol {pose['sol']}, heading {heading:.1f}, "
            f"heading from {heading_source}, walkability {sampled['walkability'] if sampled else 'no grid coverage'}, "
            f"passes {passes[site] or 'no bundle'}"
        )
        stops.append({
            "id": s["id"],
            "name": s["title"],
            "rover": s["rover"],
            "mission": s["mission"],
            "sol": int(s["sol"]),
            "sol_end": int(s["sol_end"]) if s.get("sol_end") is not None else None,
            "pose_sol": int(pose["sol"]),
            "lat": round(float(pose["lat"]), 7),
            "lon_east": round(float(pose["lon"]), 7),
            "height": round(float(pose["elev_m"]), 3),
            "heading": round(heading, 2),
            "heading_source": heading_source,
            "pitch": 0.0,
            "roll": 0.0,
            "image_url": f"./{out_dir.name}/{image_path.name}",
            "walkability": sampled["walkability"] if sampled else None,
            "slope_deg": sampled["slope_deg"] if sampled else None,
            "walkability_source": sampled["walkability_source"] if sampled else None,
            "passes_url": passes[site],
            "next_id": None,
            "prev_id": None,
            "drive_m_to_next": None,
            "pia_id": s["pia_id"],
            "instrument": s["instrument"],
            "caption": caption_path.read_text(encoding="utf-8").strip(),
            "credit": s["credit"],
            "source_url": s["page"],
            "_site": site,
            "_pose_index": index,
        })

    # Link only stops on the same rover traverse, in sol order, with the real drive between them.
    for site in sorted({stop["_site"] for stop in stops}):
        chain = sorted((stop for stop in stops if stop["_site"] == site), key=lambda stop: stop["sol"])
        for a, b in zip(chain, chain[1:]):
            a["next_id"], b["prev_id"] = b["id"], a["id"]
            a["drive_m_to_next"] = round(drive_distance_m(poses_by_site[site], a["_pose_index"], b["_pose_index"]), 1)
    for stop in stops:
        del stop["_site"], stop["_pose_index"]

    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps({"stops": stops}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {out_json} with {len(stops)} stops")
    return stops


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--sources", type=Path, default=SOURCES)
    parser.add_argument("--raw", type=Path, default=RAW)
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    parser.add_argument("--out-json", type=Path, default=OUT_JSON)
    parser.add_argument("--passes-dir", type=Path, default=PASSES_DIR)
    parser.add_argument("--width", type=int, default=4096, help="output width; height is half")
    parser.add_argument("--quality", type=int, default=82)
    parser.add_argument("--download", action="store_true", help="fetch missing images and captions")
    args = parser.parse_args(argv)
    if args.width % 2:
        parser.error("--width must be even for a 2:1 frame")
    sources = json.loads(args.sources.read_text(encoding="utf-8"))["sources"]
    if args.download:
        args.raw.mkdir(parents=True, exist_ok=True)
        for source in sources:
            download_image(source, args.raw)
            download_caption(source, args.raw)
    stops = build(sources, args.raw, args.out_dir, args.out_json, args.passes_dir, args.width, args.quality)
    return 0 if stops else 1


if __name__ == "__main__":
    sys.exit(main())
