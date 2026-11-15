# Shared small data

Small files cut from the datasets on the coordinator machine, so work that does not need the raw data can proceed.

- `poses/gale_poses.csv`, `poses/jezero_poses.csv`: one row per rover (site, drive) position. `lon` is east longitude, `lat` is planetocentric latitude, both in degrees; `heading_deg` is rover yaw. Join rover raw-image records to these on `site` and `drive` to place each photo. Source: NASA PDS rover localization tables (PLACES).
- `poses/gusev_poses.csv`: Spirit's corrected traverse in the same columns, converted by `pipeline/mer_poses.py` from the PDS Geosciences MER Analyst's Notebook `MERA_traverse.csv` (equirectangular projection centred at 175.5° E, 0° N). `sol` is the sol the rover arrived at each position. `elev_m` and `heading_deg` are empty because the source has neither. Opportunity has no table here: its published traverse does not state its coordinate frame.
