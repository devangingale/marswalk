# Gale sample bundle

This is a 500 by 500 m northwest corner of the Gale walk area, with image,
terrain, slope, route grids, and any derived raster layers present at bake time.
It was made locally from the cropped Gale rasters with one command:

```powershell
& "D:\NASA - Sol 48\.venv\Scripts\python.exe" pipeline\bake.py gale --sample
```
