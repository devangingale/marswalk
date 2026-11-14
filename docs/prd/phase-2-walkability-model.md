# Phase 2 — Walkability model

> Read [`00-contracts.md`](00-contracts.md) first. File formats, coordinates and units are defined there and override anything below.

**Owner:** Dev's machine (needs `data/`). **Window:** hours 1–8, alongside phase 1. **Branch:** `dev/p2-walkability`.

## Goal

A per-cell walkability score learned from where Curiosity actually drove, tested honestly on a site it never saw (Jezero, against Perseverance's path).

## Inputs

- Phase 1 derived rasters for Gale (slope, roughness, curvature, image). Start on raw crops if phase 1 is not ready.
- `data/raw/pds_places/localized_interp.csv` — Curiosity poses (49k), with DEM pixel coordinates.
- `data/raw/pds_places/best_interp.csv` — Perseverance poses (33k), for testing only.
- Jezero rasters: `jezero_hirise_dtm/`, `jezero_hirise_ortho/`.

## Method

- **Positives:** cells within about 1.5 m of a Curiosity pose.
- **Background:** random cells inside a corridor (about 100 m) around the path. Nobody labelled unsafe ground, so this is positive-versus-background, and the write-up says so.
- **Features:** slope and roughness at several window sizes, curvature, image brightness and local texture. Nothing tied to absolute elevation or position.
- **Model:** gradient-boosted trees (LightGBM or scikit-learn). Split Gale train/validation by path segment, not by random cell.
- **Baseline:** slope alone.
- **Test:** apply unchanged to Jezero. Report, for the model and the baseline, how often Perseverance's path falls in the top walkable share of the corridor versus chance (lift), plus AUC against background.

## Deliverables

1. `pipeline/features.py`, `pipeline/train_walkability.py`, `pipeline/eval_walkability.py`.
2. Walkability raster for the Gale area; later for Jezero.
3. `docs/model-card.md`: data, method, both numbers, limits, and the ship decision.
4. Cost grid (2 m) combining the score with the human slope limit, in the phase 1 binary format.

## Gate (hour 8)

Ship the model only if it beats slope-only on Jezero by a clear margin. Otherwise ship the slope-and-roughness rule, record why, and the science-ranking stretch is dropped.

## Stated limits (must appear in the deck)

- A rover's route is a conservative stand-in for a suited human; rovers avoid things people could step over and vice versa.
- Hard human limit applied on top regardless of the model (default: no travel above 20° slope; steeper is impassable).
- 1 m data cannot see rocks smaller than about a metre.

## Done when

The evaluation script, which never reads Jezero during training, prints both numbers; the decision is written in the model card.

## Status and additions (contracts v1)

- First result (terrain features only, 100 m comparison corridor): unseen Jezero 0.573 for the model against 0.542 for slope alone (0.5 is chance). It transfers, but the margin is small. Code is on `dev/p2-walkability`.
- Training takes under a minute on the coordinator machine, so compute is not the limit; moving to a hosted notebook would not help. What is missing is signal.
- **Timebox: 3 hours** to try image texture features and a wider comparison area. Then the gate.
- **Gate:** the model replaces the rule in `cost.bin` only if it beats slope alone on Jezero by at least 0.05. Otherwise the rule stays as the route cost, and the model is published as a layer (`walkability`, labelled experimental) with its numbers in `site.json` `validation`.
- Output is only ever a raster layer and, if it passes, a replacement `cost.bin` (contracts section 6). Nothing in the app changes either way.

## Reviewer check

1. Run the evaluation script from a clean checkout; the printed numbers match `docs/model-card.md`.
2. Confirm by reading the script that no Jezero file is opened during training.
