"""Train Gale walkability models with path-segment holdout validation.

Written with AI assistance, directed and reviewed by the team.

Usage: python pipeline/train_walkability.py [--corridors 100 200]
Only Gale data is opened here. Jezero is read by eval_walkability.py only.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import lightgbm as lgb
import numpy as np
import rasterio
from sklearn.metrics import roc_auc_score

from common import ROOT, describe, load_site, write_tif
from features import FEATURES, add_image_texture, gale_training_data, terrain_features

MODEL_DIR = ROOT / "data/models"


def write_gale_layer():
    """Apply the selected 100 m model to the shared 4 km Gale area layer."""
    cfg = load_site("gale")
    d = Path(cfg["out"]) / "area"
    with rasterio.open(d / "dem.tif") as src:
        dem = src.read(1, masked=True).filled(np.nan).astype(np.float32)
        transform, crs = src.transform, src.crs
    feats = terrain_features(dem, transform.a, transform.f + transform.e * dem.shape[0] / 2)
    add_image_texture(feats, Path(cfg["image"]), transform, crs, dem.shape)
    X = np.column_stack([feats[k].ravel() for k in FEATURES]).astype(np.float32)
    model = joblib.load(MODEL_DIR / "walkability_gale_100m.joblib")
    score = model.predict_proba(X)[:, 1].reshape(dem.shape).astype(np.float32)
    score[~np.isfinite(dem)] = np.nan
    out_dir = ROOT / "data/sites/gale/area/layers"
    write_tif(out_dir / "walkability.tif", score, transform, crs, nodata=np.nan)
    describe("Gale experimental walkability", score, transform)
    metadata = {
        "id": "walkability", "title": "Experimental walkability (rover-preference model)",
        "kind": "topographic", "resolution_m": float(transform.a),
        "source": "Gale Curiosity path-trained LightGBM; MRO HiRISE terrain and image texture",
        "agency": "NASA", "units": "relative rover-preference score (0-1; not a safety probability)",
        "legend": {"stops": [[0, "#a50026"], [0.5, "#ffffbf"], [1, "#006837"]]},
        "default_on": False,
    }
    (out_dir / "walkability.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(f"Wrote {out_dir / 'walkability.tif'} and walkability.json (experimental)")


def metrics(label, y, model_score, slope):
    out = {"auc": float(roc_auc_score(y, model_score)),
           "slope_auc": float(roc_auc_score(y, -slope)),
           "path_capture_top20": float((model_score[y == 1] >= np.quantile(model_score[y == 0], .8)).mean()),
           "slope_path_capture_top20": float((-slope[y == 1] >= np.quantile(-slope[y == 0], .8)).mean())}
    out["lift_top20"] = out["path_capture_top20"] / .2
    out["slope_lift_top20"] = out["slope_path_capture_top20"] / .2
    print(f"{label}: model AUC {out['auc']:.3f}, slope-only AUC {out['slope_auc']:.3f}; "
          f"model top-20% path share {out['path_capture_top20']:.3f} (lift {out['lift_top20']:.3f}), "
          f"slope-only {out['slope_path_capture_top20']:.3f} (lift {out['slope_lift_top20']:.3f})")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corridors", nargs="+", type=float, default=[100.0, 200.0],
                    help="background corridor half-widths in metres")
    ap.add_argument("--write-layer", action="store_true", help="apply the 100 m model to Gale's shared area layer")
    ap.add_argument("--apply-layer-only", action="store_true", help="write the Gale layer without retraining")
    args = ap.parse_args()
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    if args.apply_layer_only:
        write_gale_layer()
        return
    for width in args.corridors:
        X, y, segment, *_ = gale_training_data(width, seed=0)
        groups = np.sort(np.unique(segment[(y == 1) & (segment >= 0)]))
        if len(groups) < 5:
            raise RuntimeError(f"Need at least five Gale path segments; found {len(groups)}")
        holdout = groups[max(1, int(len(groups) * .8)):]
        va = np.isin(segment, holdout)
        tr = ~va
        if len(np.unique(y[tr])) < 2 or len(np.unique(y[va])) < 2:
            raise RuntimeError("Path-segment split did not leave both classes in train and validation")
        print(f"{width:g} m Gale split: {len(groups)} drive segments; validation holds out "
              f"{len(holdout)} final segments, {int(tr.sum()):,} train / {int(va.sum()):,} validation samples")
        model = lgb.LGBMClassifier(n_estimators=500, learning_rate=.04, num_leaves=31,
                                   min_child_samples=150, subsample=.8, subsample_freq=1,
                                   colsample_bytree=.85, reg_lambda=5.0, verbose=-1,
                                   random_state=0, n_jobs=-1)
        model.fit(X[tr], y[tr], eval_set=[(X[va], y[va])], eval_metric="auc",
                  callbacks=[lgb.early_stopping(40, verbose=False), lgb.log_evaluation(0)])
        pred = model.predict_proba(X[va])[:, 1]
        base = metrics(f"Gale {width:g} m held-out path", y[va], pred, X[va, FEATURES.index("slope5")])
        out = {"trained_on": "Gale", "corridor_m": width, "features": FEATURES,
               "validation": base, "best_iteration": int(model.best_iteration_ or model.n_estimators),
               "holdout_drive_segments": [int(v) for v in holdout]}
        joblib.dump(model, MODEL_DIR / f"walkability_gale_{int(width)}m.joblib")
        (MODEL_DIR / f"train_gale_{int(width)}m.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
        gain = model.booster_.feature_importance("gain")
        print("feature gain:", json.dumps({k: round(float(v / max(gain.sum(), 1)), 3)
                                            for k, v in zip(FEATURES, gain)}, sort_keys=True))
    if args.write_layer:
        write_gale_layer()


if __name__ == "__main__":
    main()
