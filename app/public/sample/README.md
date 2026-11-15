# Gale sample bundle

This is a 500 by 500 m northwest corner of the Gale walk area, with image,
terrain, slope, route grids, and any derived raster layers present at bake time.
It was made locally from the cropped Gale rasters with one command:

```powershell
& "D:\NASA - Sol 48\.venv\Scripts\python.exe" pipeline\bake.py gale --sample
```

`passes.json` is the full Gale orbiter pass list (MRO, Mars Odyssey, TGO, Mars Express;
1 Nov to 31 Dec 2026, minimum elevation 10 deg) from `pipeline/passes.py` and NAIF SPICE
kernels, copied unchanged from the local full bundle.

`globe/temperature.json` and `globe/temperature/` are a sample of the MCS surface temperature layer from `pipeline/globe_temperature.py`: the default 6 deg grid for all 12 season bins (night low `t_min`, afternoon high `t_max`), tile levels 0-3 only (`max_level: 3` in the manifest; the full local set goes to level 4), with the value and count grids for hover readouts. The 3 deg detail variant is omitted.

`terrain3d/` is the site's 3D terrain mesh for the globe (`?globe=1`): a 3D Tiles quadtree of glb
meshes built from `terrain.pmtiles` by `pipeline/site_terrain3d.py`. Heights are the DEM plus the
Gale offset to Cesium Mars (+73.76 m). The sample is built at 2 m to keep it small (21 tiles, 2.5 MB);
full bundles use the DEM resolution (1 m), the default:

```sh
python pipeline/site_terrain3d.py app/public/sample/gale --height-offset-m 73.76 --resolution-m 2
python pipeline/site_terrain3d.py <bundle_dir> --height-offset-m 73.76   # Gale; Jezero -70.92
```

It needs only numpy, Pillow and pmtiles. Without `terrain3d/` the globe uses Cesium Mars alone.
