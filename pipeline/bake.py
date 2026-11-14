"""Bake a site's rasters and route grids into a PMTiles site bundle.

Written with AI assistance, directed and reviewed by the team.

Tiles use Web Mercator after converting the Mars equirectangular source x/y to
true longitude and planetocentric latitude. Zooms 11–18 are used: z18 is about
0.3 m per ground pixel at Gale, appropriate for the 0.25 m orbital image while
limiting an area tile set; coarser layers stop at the zoom matching their own
source resolution. This is a raster tile baker, not a distance calculator.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import mercantile
import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.transform import Affine
from rasterio.warp import reproject
from rasterio.windows import from_bounds
from scipy import ndimage as ndi
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import write as pmtiles_write

from common import MARS_R, load_site, xy_to_lonlat
from grids import build_grid

TILE_SIZE = 256
MIN_ZOOM, MAX_ZOOM = 13, 18
EARTH_R = 6378137.0


def describe_source(src, name: str) -> tuple[float,float]:
    minimum, maximum, valid_count, count = math.inf, -math.inf, 0, src.width*src.height
    for _, window in src.block_windows(1):
        block = src.read(1, window=window, masked=True)
        if block.count():
            minimum = min(minimum, float(block.min()))
            maximum = max(maximum, float(block.max()))
            valid_count += block.count()
    tf=src.transform
    print(f"{name}: {src.width}x{src.height} px, res {tf.a:g} m, x {tf.c:.0f}..{tf.c+src.width*tf.a:.0f}, y {tf.f+src.height*tf.e:.0f}..{tf.f:.0f}, range {minimum:.3f}..{maximum:.3f}, valid {100*valid_count/count:.1f}%")
    return minimum, maximum


def lonlat_source_transform(transform: Affine) -> Affine:
    k = 180.0 / (math.pi * MARS_R)
    return Affine(transform.a * k, transform.b * k, transform.c * k,
                  transform.d * k, transform.e * k, transform.f * k)


def tile_bytes(src, src_geo_tf, z: int, x: int, y: int, mode: str, name: str, ramp=None) -> bytes | None:
    b = mercantile.bounds(x, y, z)
    x0,y0 = mercantile.xy(b.west,b.south)
    x1,y1 = mercantile.xy(b.east,b.north)
    tile_tf = Affine((x1-x0)/TILE_SIZE, 0, x0,
                     0, -(y1-y0)/TILE_SIZE, y1)
    src_bounds = (MARS_R*math.radians(b.west), MARS_R*math.radians(b.south),
                  MARS_R*math.radians(b.east), MARS_R*math.radians(b.north))
    win = from_bounds(*src_bounds, transform=src.transform).round_offsets().round_lengths()
    try:
        win = win.intersection(rasterio.windows.Window(0, 0, src.width, src.height))
    except rasterio.errors.WindowError:
        return None
    if win.width <= 0 or win.height <= 0:
        raise ValueError(f"empty source window for z{z}/{x}/{y}")
    out_w, out_h = min(512, max(1, int(win.width))), min(512, max(1, int(win.height)))
    src_tf = lonlat_source_transform(src.window_transform(win) * Affine.scale(win.width/out_w, win.height/out_h))
    if mode == "rgb":
        count = min(src.count, 3)
        raw = np.zeros((count, TILE_SIZE, TILE_SIZE), dtype=np.uint8)
        source_data = src.read(list(range(1,count+1)), window=win,
                               out_shape=(count,out_h,out_w), resampling=Resampling.average)
        for band in range(count):
            source = source_data[band]
            reproject(source=source, destination=raw[band],
                      src_transform=src_tf, src_crs="EPSG:4326", src_nodata=src.nodata,
                      dst_transform=tile_tf, dst_crs="EPSG:3857", dst_nodata=0,
                      resampling=Resampling.bilinear)
        if count == 1:
            raw = np.repeat(raw, 3, axis=0)
        arr = np.moveaxis(raw[:3], 0, -1).astype(np.uint8)
        im = Image.fromarray(arr, "RGB")
        import io
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=78, optimize=True)
        return buf.getvalue()
    raw = np.full((TILE_SIZE, TILE_SIZE), np.nan, dtype=np.float32)
    source = src.read(1, window=win, out_shape=(out_h,out_w), resampling=Resampling.average)
    reproject(source=source, destination=raw,
              src_transform=src_tf, src_crs="EPSG:4326", src_nodata=src.nodata,
              dst_transform=tile_tf, dst_crs="EPSG:3857", dst_nodata=np.nan,
              resampling=Resampling.bilinear)
    valid = np.isfinite(raw)
    if name == "terrain":
        rgbint = np.zeros(raw.shape, dtype=np.uint32)
        enc = np.rint(np.where(valid, raw, 0) * 10 + 100000).astype(np.int32)
        enc = np.clip(enc, 0, 16777215).astype(np.uint32)
        rgbint[valid] = enc[valid]
        arr = np.stack(((rgbint >> 16) & 255, (rgbint >> 8) & 255, rgbint & 255), axis=-1).astype(np.uint8)
    else:
        # Slope has the contract ramp; other raster layers use their sidecar ramp.
        if ramp:
            values = np.array([float(item[0]) for item in ramp], dtype=np.float32)
            colors = np.array([[int(item[1][i:i+2],16) for i in (1,3,5)] for item in ramp], dtype=np.float32)
            arr = np.empty(raw.shape+(3,), dtype=np.uint8)
            for channel in range(3):
                arr[...,channel] = np.interp(np.where(valid,raw,values[0]),values,colors[:,channel]).astype(np.uint8)
        else:
            # Slope: green (0°), yellow (10°), red (20°), purple (30°).
            stops = np.array([[26,152,80],[254,224,139],[215,48,39],[77,0,75]], dtype=np.float32)
            t = np.clip(np.where(valid, raw, 0), 0, 30) / 10
            lo = np.minimum(t.astype(int), 2); frac = (t - lo)[..., None]
            arr = (stops[lo] * (1-frac) + stops[lo+1] * frac).astype(np.uint8)
        arr[~valid] = 0
    import io
    buf = io.BytesIO()
    Image.fromarray(arr, "RGB").save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def bake_raster(src_path: Path, target: Path, bounds_xy, mode: str, layer_name: str, minzoom=MIN_ZOOM, maxzoom=MAX_ZOOM, ramp=None):
    with rasterio.open(src_path) as src:
        src_geo_tf = lonlat_source_transform(src.transform)
        src_crs = "EPSG:4326"
        west, south = xy_to_lonlat(bounds_xy[0], bounds_xy[1])
        east, north = xy_to_lonlat(bounds_xy[2], bounds_xy[3])
        west, east, south, north = float(west), float(east), float(south), float(north)
        source_min, source_max = describe_source(src, layer_name)
        data = []
        for z in range(minzoom, maxzoom + 1):
            for tile in mercantile.tiles(west, south, east, north, [z]):
                data.append((zxy_to_tileid(z, tile.x, tile.y), (z,tile.x,tile.y)))
        data.sort(key=lambda x: x[0])
        header = {"tile_type": TileType.JPEG if mode == "rgb" else TileType.PNG,
                  "tile_compression": Compression.NONE, "min_zoom": minzoom,
                  "max_zoom": maxzoom, "min_lon_e7": int(west*1e7), "min_lat_e7": int(south*1e7),
                  "max_lon_e7": int(east*1e7), "max_lat_e7": int(north*1e7),
                  "center_zoom": maxzoom, "center_lon_e7": int((west+east)*5e6), "center_lat_e7": int((south+north)*5e6)}
        metadata = {"name": target.stem, "format": "jpg" if mode == "rgb" else "png",
                    "tilejson": "3.0.0", "bounds": [west,south,east,north],
                    "minzoom": minzoom, "maxzoom": maxzoom, "scheme": "xyz"}
        target.parent.mkdir(parents=True, exist_ok=True)
        written = 0
        with pmtiles_write(str(target)) as writer:
            for tid, (z,x,y) in data:
                payload=tile_bytes(src,src_geo_tf,z,x,y,mode,layer_name,ramp)
                if payload is not None:
                    writer.write_tile(tid,payload)
                    written += 1
            writer.finalize(header, metadata)
        print(f"{target.name}: zoom {minzoom}..{maxzoom}, {written} tiles, {target.stat().st_size} bytes")
        return source_min, source_max, src.transform.a


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("site")
    ap.add_argument("--sample", action="store_true", help="bake the 500 m NW corner to app/public/sample/<site>")
    ap.add_argument("--output", help="override the bundle output directory")
    args = ap.parse_args()
    cfg = load_site(args.site)
    area = Path(cfg["out"]) / "area"
    dem = area / "dem.tif"
    with rasterio.open(dem) as ds:
        left, bottom, right, top = ds.bounds
        dem_tf = ds.transform
    if args.sample:
        lat_c = (bottom+top)/(2*MARS_R)
        bounds = [left, top-500, left+500/math.cos(lat_c), top]
        out = Path(args.output) if args.output else Path("app/public/sample") / cfg["name"]
        size_w = 500.0; size_h = 500.0
    else:
        bounds = [left,bottom,right,top]
        out = Path(args.output) if args.output else Path(cfg["out"]) / "bundle"
        size_w = (right-left)*math.cos((bottom+top)/(2*MARS_R))
        size_h = top-bottom
    out.mkdir(parents=True, exist_ok=True)
    west,south = xy_to_lonlat(bounds[0],bounds[1]); east,north = xy_to_lonlat(bounds[2],bounds[3])
    lon0,lat0 = float(west),float(south)
    lat_c=(float(south)+float(north))/2
    print(f"site {cfg['name']} {'sample' if args.sample else 'full'} bounds x/y={bounds}, size={size_w:.3f}x{size_h:.3f} m, lon/lat={float(west):.7f},{float(south):.7f}..{float(east):.7f},{float(north):.7f}")

    image_path=area/"image.tif"; slope_path=area/"slope.tif"
    tile_max = 17 if args.sample else MAX_ZOOM
    _,_,image_res=bake_raster(image_path,out/"image.pmtiles",bounds,"rgb","image",MIN_ZOOM,tile_max)
    dem_min,dem_max,dem_res=bake_raster(dem,out/"terrain.pmtiles",bounds,"terrain","terrain",MIN_ZOOM,tile_max)
    _,_,slope_res=bake_raster(slope_path,out/"slope.pmtiles",bounds,"slope","slope",MIN_ZOOM,tile_max)
    layers=[
      {"id":"image","title":"Orbital image","kind":"optical","type":"raster","url":"image.pmtiles","resolution_m":image_res*math.cos(math.radians(lat_c)),"source":"MRO HiRISE colour mosaic","agency":"NASA","units":None,"legend":None,"default_on":True},
      {"id":"slope","title":"Slope","kind":"topographic","type":"raster","url":"slope.pmtiles","resolution_m":slope_res,"source":"MRO HiRISE stereo elevation","agency":"NASA","units":"degrees","legend":{"stops":[[0,"#1a9850"],[10,"#fee08b"],[20,"#d73027"],[30,"#4d004b"]]},"default_on":False},
    ]
    layer_dir=area/"layers"
    if layer_dir.exists():
        for tif in sorted(layer_dir.glob("*.tif")):
            meta_path=tif.with_suffix(".json")
            if not meta_path.exists():
                raise ValueError(f"layer sidecar missing: {meta_path}")
            meta=json.loads(meta_path.read_text(encoding="utf-8"))
            required={"id","title","kind","resolution_m","source","agency","units","legend","default_on"}
            if set(meta)!=required:
                raise ValueError(f"{meta_path} must contain exactly {sorted(required)}")
            maximum=min(MAX_ZOOM,max(MIN_ZOOM,round(math.log2(2*math.pi*MARS_R*math.cos(math.radians(lat_c))/(TILE_SIZE*meta["resolution_m"])))) )
            maximum=min(tile_max,maximum)
            legend=meta.get("legend") or {}
            bake_raster(tif,out/f"{meta['id']}.pmtiles",bounds,"slope",meta["id"],MIN_ZOOM,maximum,legend.get("stops"))
            if meta["id"] == "walkability" and "experimental" not in meta["title"].lower():
                meta["title"] = f"Experimental {meta['title']}"
            layers.append({**meta,"type":"raster","url":f"{meta['id']}.pmtiles"})

    origin={"lon0":lon0,"lat0":lat0,"lat_c":lat_c}
    site={"id":cfg["name"],"title":cfg["title"],"rover":cfg["rover"],"origin":origin,
          "size_m":{"width":size_w,"height":size_h},"bounds_lonlat":[float(west),float(south),float(east),float(north)],
          "default_start":{"lon":float((west+east)/2),"lat":float((south+north)/2),"label":"Rover drop-off"},
          "terrain":{"url":"terrain.pmtiles","encoding":"mapbox","min_m":math.floor(dem_min),"max_m":math.ceil(dem_max)},
          "layers":layers,"conditions_url":f"/data/{cfg['name']}/conditions.json","photos_url":f"/data/{cfg['name']}/photos.json",
          "chemistry_url":f"/data/{cfg['name']}/chemistry.geojson","stops_url":f"/data/{cfg['name']}/stops.json",
          "validation":{"text":"The walkability model did not clear the +0.05 gate, so routes use the slope-and-roughness rule and walkability is shown as an experimental layer.","model_auc":0.551,"baseline_auc":0.504}}
    (out/"site.json").write_bytes((json.dumps(site,indent=2)+"\n").encode("utf-8"))
    grid_bounds=bounds if args.sample else None
    build_grid(dem,out,grid_bounds)
    total=sum(p.stat().st_size for p in out.iterdir() if p.is_file())
    print(f"bundle total: {total} bytes ({total/1024/1024:.3f} MiB); site size {size_w:.3f}x{size_h:.3f} m")
    if args.sample and total>=5_000_000:
        raise ValueError(f"sample bundle exceeds 5 MB: {total} bytes")


if __name__ == "__main__":
    main()
