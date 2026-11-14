# Gale sample bundle

This is a 500 by 500 m northwest corner of the Gale walk area, with image,
terrain, slope, route grids, and any derived raster layers present at bake time.
It was made locally from the cropped Gale rasters with one command:

```powershell
& "D:\NASA - Sol 48\.venv\Scripts\python.exe" pipeline\bake.py gale --sample
```

`globe/temperature.json` and `globe/temperature/` are a sample of the MCS surface temperature layer from `pipeline/globe_temperature.py`: the default 6 deg grid for all 12 season bins (night low `t_min`, afternoon high `t_max`), tile levels 0-3 only (`max_level: 3` in the manifest; the full local set goes to level 4), with the value and count grids for hover readouts. The 3 deg detail variant is omitted.
