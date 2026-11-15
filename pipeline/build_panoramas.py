"""Build 2:1 equirectangular panoramas and panoramas.json for the 360-degree surface view.

Written with AI assistance (Claude), directed and reviewed by the team.

Takes wide rover panorama strips (a stitched Mastcam or Mastcam-Z mosaic covers 360 degrees
across but only a band of elevation), scales each so its angular resolution is the same
across and down, and pads it into a strict 2:1 frame (4096 x 2048 by default) with a dark
Martian sky above and regolith below. The image's centre column faces `center_heading_deg`,
which is the convention the app's panorama loader uses.

Each output is placed at a stop from shared/poses/<site>_poses.csv (nearest sol, last pose
of that sol), and stops on one site are chained by sol through prev_id / next_id.

Inputs:  pipeline/panoramas.sources.json, and images in data/raw/panos/
         (any <site>_sol<N>.jpg there that is not listed is added with defaults).
Outputs: app/public/panoramas.json and app/public/panos/<id>.jpg

    python pipeline/build_panoramas.py --download     # fetch missing sources, then build
    python pipeline/build_panoramas.py                # build from what is on disk

Only Pillow is needed beyond the standard library.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / "pipeline" / "panoramas.sources.json"
RAW = ROOT / "data" / "raw" / "panos"
OUT_JSON = ROOT / "app" / "public" / "panoramas.json"
OUT_DIR = ROOT / "app" / "public" / "panos"
POSES = ROOT / "shared" / "poses"

EXTENSIONS = (".jpg", ".jpeg", ".png", ".tif", ".tiff")
AUTO_NAME = re.compile(r"^(?P<site>[a-z]+)_sol(?P<sol>\d+)$", re.IGNORECASE)
WALKABILITY = {"safe", "caution", "hazard"}
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


def load_sources(path: Path, raw: Path) -> list[dict]:
    listed = json.loads(path.read_text(encoding="utf-8"))["sources"] if path.exists() else []
    known = {s["file"].lower() for s in listed}
    extra = []
    if raw.exists():
        for f in sorted(raw.iterdir()):
            m = AUTO_NAME.match(f.stem)
            if f.suffix.lower() in EXTENSIONS and f.name.lower() not in known and m:
                site, sol = m["site"].lower(), int(m["sol"])
                extra.append({
                    "id": f"{site}_{sol}", "file": f.name, "site": site, "sol": sol,
                    "name": f"{site.capitalize()} · sol {sol}", "hfov_deg": 360,
                    "center_heading_deg": None, "center_pitch_deg": 0,
                    "walkability": "caution", "next_orbiter_pass": "unscheduled",
                    "credit": "NASA/JPL-Caltech", "pois": [],
                })
    return listed + extra


def download(sources: list[dict], raw: Path) -> None:
    raw.mkdir(parents=True, exist_ok=True)
    for s in sources:
        target = raw / s["file"]
        if target.exists() or not s.get("url"):
            continue
        print(f"downloading {s['url']} -> {target.relative_to(ROOT)}")
        partial = target.with_suffix(target.suffix + ".part")
        request = urllib.request.Request(s["url"], headers={"User-Agent": "marswalk-pipeline"})
        try:
            with urllib.request.urlopen(request, timeout=300) as response, open(partial, "wb") as out:
                while chunk := response.read(1 << 20):
                    out.write(chunk)
        except Exception:
            partial.unlink(missing_ok=True)
            raise
        partial.rename(target)


def load_poses(site: str) -> dict[int, dict]:
    """Last pose of each sol for a site."""
    by_sol: dict[int, dict] = {}
    with open(POSES / f"{site}_poses.csv", newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            by_sol[int(row["sol"])] = row
    return by_sol


def nearest_pose(poses: dict[int, dict], sol: int) -> tuple[int, dict]:
    best = min(poses, key=lambda s: (abs(s - sol), s))
    return best, poses[best]


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


def build(sources: list[dict], raw: Path, out_dir: Path, out_json: Path, width: int, quality: int) -> list[dict]:
    out_dir.mkdir(parents=True, exist_ok=True)
    poses_by_site: dict[str, dict[int, dict]] = {}
    stops = []
    for s in sources:
        path = raw / s["file"]
        if not path.exists():
            print(f"skip {s['id']}: {path.relative_to(ROOT)} not found (run with --download)", file=sys.stderr)
            continue
        site = s["site"]
        poses = poses_by_site.setdefault(site, load_poses(site))
        pose_sol, pose = nearest_pose(poses, int(s["sol"]))
        walkability = s.get("walkability", "caution")
        if walkability not in WALKABILITY:
            raise ValueError(f"{s['id']}: walkability must be one of {sorted(WALKABILITY)}")
        heading = s.get("center_heading_deg")
        if heading is None:
            heading = float(pose["heading_deg"])
        heading %= 360

        with Image.open(path) as strip:
            frame = to_equirectangular(strip, width, s.get("hfov_deg", 360), s.get("center_pitch_deg", 0))
        image_path = out_dir / f"{s['id']}.jpg"
        frame.save(image_path, "JPEG", quality=quality, optimize=True, progressive=True)
        gap = abs(pose_sol - int(s["sol"]))
        match = "exact" if gap == 0 else f"{gap} sols off"
        print(
            f"{s['id']}: {path.name} -> {image_path.relative_to(ROOT)} {frame.size[0]}x{frame.size[1]}, "
            f"pose sol {pose_sol} ({match}), heading {heading:.1f}"
        )
        stops.append({
            "id": s["id"],
            "name": s["name"],
            "sol": int(s["sol"]),
            "lat": round(float(pose["lat"]), 7),
            "lon_east": round(float(pose["lon"]), 7),
            "height": round(float(pose["elev_m"]), 3),
            "heading": round(heading, 2),
            "pitch": 0.0,
            "roll": 0.0,
            "image_url": f"./{out_dir.name}/{image_path.name}",
            "walkability": walkability,
            "next_orbiter_pass": s.get("next_orbiter_pass", "unscheduled"),
            "next_id": None,
            "prev_id": None,
            "pois": s.get("pois", []),
            "_site": site,
        })

    # Chain each site's stops by sol.
    for site in {stop["_site"] for stop in stops}:
        chain = sorted((stop for stop in stops if stop["_site"] == site), key=lambda stop: stop["sol"])
        for a, b in zip(chain, chain[1:]):
            a["next_id"], b["prev_id"] = b["id"], a["id"]
    for stop in stops:
        del stop["_site"]

    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps({"stops": stops}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {out_json.relative_to(ROOT)} with {len(stops)} stops")
    return stops


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--sources", type=Path, default=SOURCES)
    parser.add_argument("--raw", type=Path, default=RAW)
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    parser.add_argument("--out-json", type=Path, default=OUT_JSON)
    parser.add_argument("--width", type=int, default=4096, help="output width; height is half")
    parser.add_argument("--quality", type=int, default=82)
    parser.add_argument("--download", action="store_true", help="fetch listed sources missing from --raw")
    args = parser.parse_args(argv)
    if args.width % 2:
        parser.error("--width must be even for a 2:1 frame")
    sources = load_sources(args.sources, args.raw)
    if args.download:
        download(sources, args.raw)
    stops = build(sources, args.raw, args.out_dir, args.out_json, args.width, args.quality)
    return 0 if stops else 1


if __name__ == "__main__":
    sys.exit(main())
