# Walkability model card

## Decision

**Do not replace the slope and roughness route cost.** The best Jezero AUC improvement is +0.047 (100 m comparison corridor), below the required +0.05 gate. The 200 m model improves AUC by +0.026. The Gale raster is published as an experimental topographic layer; no `cost.bin` was written.

## Data and method

- **Training:** Gale Curiosity `localized_interp.csv` positives and randomly sampled background cells 5–100 m or 5–200 m from the rover path. Positives are terrain cells within 1.5 m of the path. The 4 km Gale training crop uses MRO HiRISE elevation, image brightness texture, slope, roughness, curvature and local relief features.
- **Validation:** Gale train/validation split by drive segment, holding out the last 20% of distinct path segments. LightGBM gradient-boosted trees were trained separately for each background corridor width.
- **Evaluation:** Perseverance `best_interp.csv` and Jezero HiRISE DTM/ortho, with the same positive definition and matching 100 m or 200 m background corridor. The fitted Gale models and feature definitions were applied unchanged.
- **Baseline:** flatter is better, using 5 m mean slope alone.
- **AUC:** ROC AUC of rover path cells against sampled corridor background cells (0.5 is chance). **Lift:** share of rover path cells scoring in the top 20% of background scores divided by 20% chance capture. Background is unlabelled; these values measure rover-route preference, not safety.

## Jezero results

| Background corridor | Model AUC | Slope-only AUC | AUC gain | Model path share in top 20% | Model lift | Slope-only path share in top 20% | Slope-only lift |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 m | 0.551 | 0.504 | +0.047 | 0.255 | 1.276× | 0.197 | 0.985× |
| 200 m | 0.536 | 0.510 | +0.026 | 0.343 | 1.715× | 0.205 | 1.026× |

The 100 m model is the selected Gale display layer. Widening the comparison corridor increased top-20% lift but lowered AUC; neither model met the gate.

## Limits

- A rover's route is a conservative stand-in for a suited human; rovers avoid things people could step over and vice versa.
- The hard human limit remains in force regardless of model: no travel above 20° slope; steeper terrain is impassable.
- 1 m data cannot see rocks smaller than about a metre.
- This is positive-versus-background learning. No unsafe-ground labels exist, so the score is not a probability of human safety or walkability.
- Results depend on the selected corridor width and rover path coverage. They do not validate human walking performance.

## Reproduction

Run `python pipeline/train_walkability.py --corridors 100 200`, then `python pipeline/eval_walkability.py --corridors 100 200`. The evaluation prints these metrics for model and slope-only baseline. Add `--apply-layer-only` to the training script after training to write `data/sites/gale/area/layers/walkability.tif` and `walkability.json`.
