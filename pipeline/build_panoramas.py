"""Discover, download and build the 360-degree surface panoramas from NASA/JPL Photojournal.

Written with AI assistance (Claude), directed and reviewed by the team.

Sources, all real:

  - Which panoramas: the NASA Images API (images-api.nasa.gov), every page of each discovery
    query in pipeline/panoramas.sources.json ("360" + rover name), merged with the curated
    entries there (which win, and may carry caption-verified sols, orientation and a cited
    position). Entries under "exclude" are skipped, with the reason recorded.
  - Caption, credit and full-resolution image: each PIA's Photojournal page
    (photojournal.jpl.nasa.gov/catalog/<PIA>), falling back to the Images API's own asset.
  - Sol: parsed from the official caption (the first sentence that names sols; the end sol of a
    multi-sol mosaic is kept as sol_end). Orientation from the caption where NASA states it
    ("north is at the center", "south is in the center", ...).
  - Position: the rover's last localized pose on or before the end sol, from
    shared/poses/<site>_poses.csv (PDS PLACES for Curiosity and Perseverance; the PDS
    Geosciences corrected traverse for Spirit, via pipeline/mer_poses.py), or a curated,
    cited position for a rover without a pose table. Elevation and yaw where the table has them.
  - Drive distance to the next stop: summed pose-to-pose segments on the Mars IAU ellipsoid.
  - Walkability, slope: a grids.py route grid covering the stop, else carried from --previous,
    else null. Relay passes: the passes.py SPICE bundle for the site, else null.

Filters: an image narrower than 2.2:1 is rejected (a single frame, not a 360-degree mosaic)
unless its source is tagged equirectangular; it is measured from the first bytes of the file,
before any full download. Variants taken on the same sol (false colour, annotated, anaglyph)
are reduced to one natural-colour panorama per rover stop.

Output: app/public/panos/<site>_<sol>.jpg at 2048 x 1024 (2:1, JPEG quality 85), missing-data
gaps filled with a sky or regolith gradient, and app/public/panoramas.json. Downloads are
cached in .cache/nasa_panos/ (git-ignored), so re-runs only fetch what is new.

    python pipeline/build_panoramas.py

Only Pillow is needed beyond the standard library.
"""
from __future__ import annotations

import argparse
import csv
import html
import json
import math
import re
import struct
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFile, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / "pipeline" / "panoramas.sources.json"
CACHE = ROOT / ".cache" / "nasa_panos"
APP_PUBLIC = ROOT / "app" / "public"
OUT_JSON = APP_PUBLIC / "panoramas.json"
OUT_DIR = APP_PUBLIC / "panos"
PASSES_DIR = APP_PUBLIC / "passes"
POSES = ROOT / "shared" / "poses"
# Where grids.py / passes.py bundles live: the coordinator's full bundles first, then the sample.
BUNDLE_DIRS = (ROOT / "data" / "sites" / "{site}" / "bundle", APP_PUBLIC / "sample" / "{site}")

IMAGES_API = "https://images-api.nasa.gov"
PHOTOJOURNAL = "https://photojournal.jpl.nasa.gov/catalog/"
USER_AGENT = "marswalk-pipeline"
OUT_WIDTH = 2048
JPEG_QUALITY = 85
MIN_ASPECT = 2.2
# Larger originals are fetched as the Images API's ~large rendition instead.
MAX_DOWNLOAD_BYTES = 160_000_000

ROVERS = {
    "Perseverance": {"site": "jezero", "mission": "Mars 2020", "credit": "NASA/JPL-Caltech/ASU/MSSS", "instrument": "Mastcam-Z"},
    "Curiosity": {"site": "gale", "mission": "Mars Science Laboratory", "credit": "NASA/JPL-Caltech/MSSS", "instrument": "Mastcam"},
    "Spirit": {"site": "gusev", "mission": "Mars Exploration Rover", "credit": "NASA/JPL-Caltech/Cornell", "instrument": "Pancam"},
    "Opportunity": {"site": "meridiani", "mission": "Mars Exploration Rover", "credit": "NASA/JPL-Caltech/Cornell", "instrument": "Pancam"},
}

# Mars IAU 2000 ellipsoid, as Cesium's Ellipsoid.MARS.
MARS_A = 3396190.0
MARS_B = 3376200.0
RELAY_ORBITERS = ("MRO", "ODY")
# Walkability classes from the grids.py cost value (score = 6*slope_deg + 40*roughness_m):
# 255 is impassable (over 20 degrees or nodata) -> hazard; score >= 100 -> caution; else safe.
CAUTION_SCORE = 100

# Mosaics are large; these are trusted NASA sources, so lift Pillow's decompression-bomb guard.
Image.MAX_IMAGE_PIXELS = 2_000_000_000

# Fill colours: dusty ochre sky at the horizon fading to dark space overhead, dark rust regolith below.
SKY_TOP = (0x12, 0x0D, 0x0A)
SKY_HORIZON = (0x7A, 0x52, 0x38)
GROUND_HORIZON = (74, 40, 25)
GROUND_BOTTOM = (20, 11, 8)
FEATHER_PX = 12
# Mosaics leave missing-data gaps where no frame was taken: near-white (Mastcam-Z, along the
# sky edge) or near-black (Mastcam, ragged blocks at the top and bottom). Daylight Mars
# scenes have no true pure black or white, so both are treated as gaps.
WHITE_THRESHOLD = 235
BLACK_THRESHOLD = 8


# ---------------------------------------------------------------- network and cache

def fetch(url: str, timeout: int = 120, headers: dict | None = None) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def cached(name: str, produce, cache: Path) -> bytes:
    """A cached text/bytes artefact in the cache folder, produced once."""
    path = cache / name
    if path.exists():
        return path.read_bytes()
    data = produce()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return data


def download_to(url: str, target: Path) -> None:
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


def content_length(url: str) -> int | None:
    request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return int(response.headers.get("Content-Length") or 0) or None
    except Exception:
        return None


def probe_size(url: str) -> tuple[int, int] | None:
    """Image width and height from the first bytes of the file, without downloading it."""
    for span in (262_144, 2_097_152):
        try:
            head = fetch(url, 60, {"Range": f"bytes=0-{span - 1}"})
        except Exception:
            return None
        parser = ImageFile.Parser()
        try:
            parser.feed(head)
        except Exception:
            pass
        if parser.image is not None:
            return parser.image.size
    return None


# ---------------------------------------------------------------- discovery and metadata

def search_api(query: str, cache: Path) -> list[dict]:
    """Every result of an Images API search, following the 'next' links page by page."""
    items: list[dict] = []
    url = f"{IMAGES_API}/search?{urllib.parse.urlencode({'q': query, 'media_type': 'image'})}"
    page = 1
    while url:
        body = json.loads(cached(f"api/search_{re.sub(r'[^a-z0-9]+', '_', query.lower())}_{page}.json", lambda: fetch(url), cache))
        collection = body["collection"]
        items += [it["data"][0] for it in collection.get("items", []) if it.get("data")]
        url = next((link["href"] for link in collection.get("links", []) if link.get("rel") == "next"), None)
        page += 1
    return items


def api_record(pia: str, cache: Path) -> dict | None:
    body = json.loads(cached(f"api/{pia}.json", lambda: fetch(f"{IMAGES_API}/search?nasa_id={pia}"), cache))
    items = body["collection"].get("items", [])
    return items[0]["data"][0] if items else None


def paragraphs(page_html: str) -> list[str]:
    text = re.sub(r"(?is)<(script|style).*?</\1>", "", page_html)
    out = []
    for raw in re.findall(r"(?is)<p[^>]*>(.*?)</p>", text):
        para = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", raw))).strip()
        out.append(re.sub(r"^Description\s+", "", para))
    return out


def caption_from_page(page_html: str) -> str | None:
    """The official caption: the first descriptive paragraph on a Photojournal page."""
    for para in paragraphs(page_html):
        if 100 <= len(para) <= 2000 and not para.startswith(("Explore", "Photojournal Note", "Click on the image")):
            return para
    return None


def photojournal(pia: str, cache: Path) -> dict:
    """Caption, full caption text and full-resolution JPEG URL from the PIA's Photojournal page."""
    try:
        page = cached(f"pages/{pia}.html", lambda: fetch(PHOTOJOURNAL + pia, 60), cache).decode("utf-8", "replace")
    except Exception as error:
        print(f"  {pia}: Photojournal page unavailable ({error})", file=sys.stderr)
        return {}
    jpgs = sorted(set(re.findall(rf"https://assets\.science\.nasa\.gov/content/dam/science/psd/photojournal/pia/pia\d+/{pia.lower()}/{pia}\.jpg", page)))
    text = " ".join(p for p in paragraphs(page) if len(p) > 60 and not p.startswith("Explore"))
    og = re.search(r'<meta[^>]+property="og:title"[^>]+content="([^"]+)"', page) or re.search(r"<title>([^<]+)</title>", page)
    title = re.sub(r"\s*[-|]\s*NASA Science\s*$", "", html.unescape(og.group(1))).strip() if og else None
    return {"caption": caption_from_page(page), "text": text, "jpg": jpgs[0] if jpgs else None, "title": title}


def api_asset(pia: str, cache: Path) -> str | None:
    try:
        body = json.loads(cached(f"api/asset_{pia}.json", lambda: fetch(f"{IMAGES_API}/asset/{pia}"), cache))
    except Exception:
        return None
    hrefs = [it["href"].replace("http://", "https://") for it in body.get("collection", {}).get("items", [])]
    for suffix in ("~orig.jpg", "~large.jpg"):
        for href in hrefs:
            if href.endswith(suffix):
                return href
    return None


# ---------------------------------------------------------------- caption parsing

NUM = r"(\d{1,2},\d{3}|\d+)"
_ORD = NUM + r"(?:st|nd|rd|th)"
# "the 3,481st Martian day", and lists such as "the 53rd and 64th Martian days".
_ORDINAL_SOL = re.compile(_ORD + r"(?:\s*(?:,|and|to|through|-|–)\s*" + _ORD + r")*\s+(?:Martian\s+days?|sols?)", re.I)
_ORD_NUM = re.compile(_ORD, re.I)
_SOL_WORD = re.compile(r"\bsols?\s+" + NUM, re.I)
_SOL_AND = re.compile(r"\bsols?\s+" + NUM + r"\s*(?:to|through|and|-|–)\s*(?:sol\s+)?" + NUM, re.I)
ORIENTATIONS = [
    (re.compile(r"north\s+is\s+(?:at|in)\s+the\s+cent(?:er|re)", re.I), 0.0),
    (re.compile(r"east\s+is\s+(?:at|in)\s+the\s+cent(?:er|re)", re.I), 90.0),
    (re.compile(r"south\s+is\s+(?:at|in)\s+the\s+cent(?:er|re)|north\s+is\s+at\s+both\s+ends", re.I), 180.0),
    (re.compile(r"west\s+is\s+(?:at|in)\s+the\s+cent(?:er|re)", re.I), 270.0),
]


def _int(text: str) -> int:
    return int(text.replace(",", ""))


def parse_sols(text: str) -> tuple[int, int | None] | None:
    """(sol, sol_end) from the first sentence of a caption that names sols; sol_end for a range."""
    for sentence in re.split(r"(?<=[.!?])\s+", text):
        numbers = [_int(n.group(1)) for m in _ORDINAL_SOL.finditer(sentence) for n in _ORD_NUM.finditer(m.group(0))]
        for m in _SOL_AND.finditer(sentence):
            numbers += [_int(m.group(1)), _int(m.group(2))]
        numbers += [_int(m.group(1)) for m in _SOL_WORD.finditer(sentence)]
        if numbers:
            lo, hi = min(numbers), max(numbers)
            return lo, (hi if hi != lo else None)
    return None


def caption_orientation(text: str) -> float | None:
    for pattern, heading in ORIENTATIONS:
        if pattern.search(text):
            return heading
    return None


# A rover named as a rover, not a place: "Perseverance Valley" is where Opportunity ended its mission.
ROVER_PATTERNS = {
    "Perseverance": re.compile(r"\bPerseverance\b(?!\s+Valley)|\bMars 2020\b"),
    "Curiosity": re.compile(r"\bCuriosity\b"),
    "Spirit": re.compile(r"\bSpirit\b"),
    "Opportunity": re.compile(r"\bOpportunity\b"),
}


def rover_of(text: str, title: str = "") -> str | None:
    """The rover a caption is about: the one its title names, else the one its text names most."""
    named = [r for r, pattern in ROVER_PATTERNS.items() if pattern.search(title)]
    if len(named) == 1:
        return named[0]
    counts = {r: len(pattern.findall(text)) for r, pattern in ROVER_PATTERNS.items()}
    best = max(counts, key=counts.get)
    return best if counts[best] else None


def instrument_of(text: str, rover: str) -> str:
    for name in ("Mastcam-Z", "Navcam", "Mastcam", "Pancam"):
        if re.search(rf"\b{re.escape(name)}\b", text, re.I):
            return name
    return ROVERS[rover]["instrument"]


VARIANT_PENALTIES = [
    (re.compile(r"false[- ]colou?r|enhanced[- ]colou?r", re.I), 30),
    (re.compile(r"annotated|labeled|labelled|anaglyph|stereo|3-D|figure", re.I), 30),
    (re.compile(r"\bhow\b.*\btaken\b", re.I), 100),
    (re.compile(r"\bnavcam", re.I), 10),
]


def variant_penalty(title: str) -> int:
    """Lower is better: a natural-colour camera panorama beats false colour, annotated or Navcam variants."""
    return sum(points for pattern, points in VARIANT_PENALTIES if pattern.search(title))


# ---------------------------------------------------------------- poses

def load_poses(site: str) -> list[dict] | None:
    """Every localized pose for a site, in drive order; None for a rover without a pose table."""
    path = POSES / f"{site}_poses.csv"
    if not path.exists():
        return None
    with open(path, newline="", encoding="utf-8") as f:
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


def _num(value: str | None) -> float | None:
    return float(value) if value not in (None, "") else None


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


def load_previous(location: str | None) -> dict[str, dict]:
    """Stops of an already-published panoramas.json (path or URL), by id; empty if unavailable."""
    if not location:
        return {}
    try:
        if re.match(r"^https?://", location):
            body = fetch(location, 60).decode("utf-8")
        else:
            body = Path(location).read_text(encoding="utf-8")
        return {stop["id"]: stop for stop in json.loads(body)["stops"]}
    except Exception as error:  # a missing or malformed previous manifest just means nothing to carry
        print(f"previous manifest unavailable ({error}); nothing carried forward", file=sys.stderr)
        return {}


def carried_walkability(previous: dict[str, dict], stop_id: str, lat: float, lon: float) -> dict | None:
    """
    The walkability a coordinator run published for this stop, if the stop has not moved. Lets a
    run without DEM grids (CI) keep values computed where the grids exist, instead of nulling them.
    """
    old = previous.get(stop_id)
    if not old or old.get("walkability") is None:
        return None
    if abs(old["lat"] - lat) > 1e-7 or abs(old["lon_east"] - lon) > 1e-7:
        return None
    return {k: old.get(k) for k in ("walkability", "slope_deg", "walkability_source")}


# ---------------------------------------------------------------- candidates

def candidates(config: dict, cache: Path) -> tuple[list[dict], list[str]]:
    """Discovered and curated entries, merged by PIA id (curated wins), minus exclusions."""
    excluded = {e["pia_id"]: e["reason"] for e in config.get("exclude", [])}
    found: dict[str, dict] = {}
    for query in config.get("discovery", {}).get("queries", []):
        hits = search_api(query["q"], cache)
        kept = 0
        for record in hits:
            pia = record.get("nasa_id", "")
            text = f"{record.get('title', '')} {record.get('description', '')}"
            if not re.fullmatch(r"PIA\d{5}", pia) or not re.search(r"360|full[- ]circle", text, re.I):
                continue
            if rover_of(text, record.get("title", "")) != query["rover"]:
                continue
            found.setdefault(pia, {"pia_id": pia, "rover": query["rover"], "discovered": True})
            kept += 1
        print(f"discovery '{query['q']}': {len(hits)} results, {kept} 360-degree {query['rover']} entries")
    for entry in config.get("curated", []):
        found[entry["pia_id"]] = {**found.get(entry["pia_id"], {}), **entry, "curated": True}
    notes = [f"{pia}: excluded ({reason})" for pia, reason in excluded.items() if pia in found]
    return [c for pia, c in sorted(found.items()) if pia not in excluded], notes


def describe(candidate: dict, cache: Path, notes: list[str]) -> dict | None:
    """Fill in caption, title, sols, orientation and image URL; None (with a note) if unusable."""
    pia = candidate["pia_id"]
    record = api_record(pia, cache) or {}
    page = photojournal(pia, cache)
    title = record.get("title") or page.get("title") or candidate.get("title") or pia
    caption = page.get("caption") or record.get("description_508") or record.get("description")
    text = " ".join(filter(None, [page.get("text"), record.get("description"), record.get("description_508")]))
    if not caption:
        notes.append(f"{pia}: skipped (no caption on the Photojournal page or in the Images API)")
        return None
    if variant_penalty(title) >= 100:
        notes.append(f"{pia}: skipped ('{title}' is not a panorama)")
        return None
    detected = rover_of(text, title)
    rover = candidate.get("rover") or detected
    if not candidate.get("curated") and detected != rover:
        notes.append(f"{pia}: skipped ('{title}' is about {detected}, not {rover})")
        return None
    if rover not in ROVERS:
        notes.append(f"{pia}: skipped (rover not identified)")
        return None
    sols = (candidate["sol"], candidate.get("sol_end")) if "sol" in candidate else parse_sols(text)
    if not sols:
        notes.append(f"{pia}: skipped (no sol stated in the caption)")
        return None
    url = page.get("jpg")
    if url and (content_length(url) or 0) > MAX_DOWNLOAD_BYTES:
        url = api_asset(pia, cache) or url
    url = url or api_asset(pia, cache)
    if not url:
        notes.append(f"{pia}: skipped (no JPEG on the Photojournal page or in the Images API)")
        return None
    stated = candidate.get("center_heading_deg")
    if stated is None:
        stated = caption_orientation(text)
    return {
        **candidate,
        "rover": rover,
        "title": title,
        "caption": caption,
        "credit": record.get("secondary_creator") or ROVERS[rover]["credit"],
        "instrument": instrument_of(f"{title} {text}", rover),
        "sol": sols[0],
        "sol_end": sols[1],
        "orientation": stated,
        "image_url": url,
        "penalty": variant_penalty(title),
    }


def admit(entry: dict, cache: Path, notes: list[str]) -> Path | None:
    """Check the image is a 360-degree mosaic by its aspect ratio, then download it (cached)."""
    pia = entry["pia_id"]
    target = cache / "images" / f"{pia}.jpg"
    if target.exists():
        with Image.open(target) as im:
            size = im.size
    else:
        size = probe_size(entry["image_url"])
        if size is None:
            notes.append(f"{pia}: skipped (image size could not be read)")
            return None
    aspect = size[0] / size[1]
    entry["source_size"] = size
    if aspect < MIN_ASPECT and not entry.get("equirectangular"):
        notes.append(f"{pia}: skipped (aspect {aspect:.2f}:1 is under {MIN_ASPECT}:1, not a 360-degree mosaic)")
        return None
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        print(f"  downloading {pia} ({size[0]}x{size[1]}) from {entry['image_url']}", flush=True)
        download_to(entry["image_url"], target)
    return target


def dedupe(entries: list[dict], notes: list[str]) -> list[dict]:
    """One panorama per rover stop: the same rover and end sol keep the best natural-colour variant."""
    best: dict[tuple, dict] = {}
    for e in entries:
        key = (e["rover"], e["sol_end"] or e["sol"])
        rank = (0 if e.get("curated") else 1, e["penalty"], -e["source_size"][0])
        if key not in best or rank < best[key]["_rank"]:
            if key in best:
                notes.append(f"{best[key]['pia_id']}: replaced by {e['pia_id']} for {e['rover']} sol {key[1]}")
            best[key] = {**e, "_rank": rank}
        else:
            notes.append(f"{e['pia_id']}: duplicate of {best[key]['pia_id']} for {e['rover']} sol {key[1]}")
    return list(best.values())


# ---------------------------------------------------------------- build

def build(
    config: dict, cache: Path, out_dir: Path, out_json: Path, passes_dir: Path,
    width: int = OUT_WIDTH, quality: int = JPEG_QUALITY, previous: dict[str, dict] | None = None,
) -> tuple[list[dict], list[str]]:
    found, notes = candidates(config, cache)
    described = [d for d in (describe(c, cache, notes) for c in found) if d]
    admitted = []
    for entry in described:
        path = admit(entry, cache, notes)
        if path:
            admitted.append({**entry, "_path": path})
    kept = dedupe(admitted, notes)

    poses_by_site: dict[str, list[dict] | None] = {}
    grids: dict[str, GridBundle | None] = {}
    passes: dict[str, str | None] = {}
    stops = []
    out_dir.mkdir(parents=True, exist_ok=True)
    for e in sorted(kept, key=lambda e: (e["rover"], e["sol"])):
        rover = ROVERS[e["rover"]]
        site = rover["site"]
        end_sol = e["sol_end"] or e["sol"]
        poses = poses_by_site.setdefault(site, load_poses(site))
        index = None
        if e.get("position"):
            pos = e["position"]
            lat, lon, height, yaw = pos["lat"], pos["lon_east"], pos.get("height"), None
            pose_sol, position_source = None, pos["source"]
        elif poses:
            last_sol = max(int(p["sol"]) for p in poses)
            if end_sol > last_sol:
                notes.append(f"{e['pia_id']}: skipped (sol {end_sol} is after the last localized {e['rover']} pose, sol {last_sol})")
                continue
            index = pose_index_for_sol(poses, end_sol)
            pose = poses[index]
            lat, lon, height, yaw = float(pose["lat"]), float(pose["lon"]), _num(pose["elev_m"]), _num(pose["heading_deg"])
            pose_sol = int(pose["sol"])
            position_source = f"{site}_poses.csv, last localized pose on or before sol {end_sol} (sol {pose_sol})"
        else:
            notes.append(f"{e['pia_id']}: skipped ({e['rover']} has no pose table and no cited position)")
            continue
        if e["orientation"] is not None:
            heading, heading_source = e["orientation"] % 360, "caption"
        elif yaw is not None:
            heading, heading_source = yaw % 360, f"rover yaw, sol {pose_sol}"
        else:
            heading, heading_source = 0.0, "not published; image centre placed at north"
        if site not in grids:
            grids[site] = GridBundle.find(site)
        lat7, lon7 = round(lat, 7), round(lon, 7)
        stop_id = f"{site}_{e['sol']}"
        sampled = grids[site].sample(lat, lon) if grids[site] else None
        if sampled is None:
            sampled = carried_walkability(previous or {}, stop_id, lat7, lon7)
        if site not in passes:
            passes[site] = copy_relay_passes(site, passes_dir)

        with Image.open(e["_path"]) as strip:
            frame = to_equirectangular(strip, width, e.get("hfov_deg", 360), e.get("center_pitch_deg", 0))
        image_path = out_dir / f"{stop_id}.jpg"
        frame.save(image_path, "JPEG", quality=quality, optimize=True, progressive=True)
        stops.append({
            "id": stop_id,
            "name": e["title"],
            "rover": e["rover"],
            "mission": rover["mission"],
            "sol": e["sol"],
            "sol_end": e["sol_end"],
            "pose_sol": pose_sol,
            "position_source": position_source,
            "lat": lat7,
            "lon_east": lon7,
            "height": round(height, 3) if height is not None else None,
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
            "pia_id": e["pia_id"],
            "instrument": e["instrument"],
            "caption": e["caption"],
            "credit": e["credit"],
            "source_url": PHOTOJOURNAL + e["pia_id"],
            "_site": site,
            "_pose_index": index,
        })

    # Link each rover's stops in sol order, with the drive between their poses where both have one.
    for site in sorted({s["_site"] for s in stops}):
        chain = sorted((s for s in stops if s["_site"] == site), key=lambda s: (s["sol"], s["id"]))
        for a, b in zip(chain, chain[1:]):
            a["next_id"], b["prev_id"] = b["id"], a["id"]
            if a["_pose_index"] is not None and b["_pose_index"] is not None:
                a["drive_m_to_next"] = round(drive_distance_m(poses_by_site[site], a["_pose_index"], b["_pose_index"]), 1)
    for s in stops:
        del s["_site"], s["_pose_index"]

    # Remove textures of stops that no longer exist.
    current = {Path(s["image_url"]).name for s in stops}
    for old in out_dir.glob("*.jpg"):
        if old.name not in current:
            old.unlink()

    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps({"stops": stops}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return stops, notes


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--sources", type=Path, default=SOURCES)
    parser.add_argument("--cache", type=Path, default=CACHE)
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    parser.add_argument("--out-json", type=Path, default=OUT_JSON)
    parser.add_argument("--passes-dir", type=Path, default=PASSES_DIR)
    parser.add_argument("--width", type=int, default=OUT_WIDTH, help="output width; height is half")
    parser.add_argument("--quality", type=int, default=JPEG_QUALITY)
    parser.add_argument(
        "--previous",
        help="published panoramas.json (path or URL): keep its walkability for stops no local grid covers",
    )
    parser.add_argument("--download", action="store_true", help="accepted for compatibility; downloads are automatic")
    args = parser.parse_args(argv)
    if args.width % 2:
        parser.error("--width must be even for a 2:1 frame")
    config = json.loads(args.sources.read_text(encoding="utf-8"))
    stops, notes = build(
        config, args.cache, args.out_dir, args.out_json, args.passes_dir, args.width, args.quality,
        previous=load_previous(args.previous),
    )
    for note in notes:
        print(note)
    counts: dict[str, int] = {}
    for s in stops:
        counts[s["rover"]] = counts.get(s["rover"], 0) + 1
    print(f"wrote {args.out_json} with {len(stops)} stops: " + ", ".join(f"{r} {n}" for r, n in sorted(counts.items())))
    return 0 if stops else 1


if __name__ == "__main__":
    sys.exit(main())
