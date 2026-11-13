# Shared small data

Small files cut from the datasets on the coordinator machine, so work that does not need the raw data can proceed.

- `poses/gale_poses.csv`, `poses/jezero_poses.csv`: one row per rover (site, drive) position. `lon` is east longitude, `lat` is planetocentric latitude, both in degrees; `heading_deg` is rover yaw. Join rover raw-image records to these on `site` and `drive` to place each photo. Source: NASA PDS rover localization tables (PLACES).
