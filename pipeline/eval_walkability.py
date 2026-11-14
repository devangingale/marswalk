"""Apply Gale-trained models unchanged to Jezero and report transfer metrics.

Written with AI assistance, directed and reviewed by the team.

Usage: python pipeline/eval_walkability.py [--corridors 100 200]
This script reads Jezero inputs for evaluation only; training is a separate Gale-only script.
"""
from __future__ import annotations

import argparse
import json

import joblib
import numpy as np
from sklearn.metrics import roc_auc_score

from common import ROOT
from features import FEATURES, jezero_evaluation_data

MODEL_DIR = ROOT / "data/models"


def report(width, X, y, model):
    score = model.predict_proba(X)[:, 1]
    slope = -X[:, FEATURES.index("slope5")]
    def capture(s):
        return float((s[y == 1] >= np.quantile(s[y == 0], .8)).mean())
    model_auc = float(roc_auc_score(y, score))
    base_auc = float(roc_auc_score(y, slope))
    model_capture, base_capture = capture(score), capture(slope)
    result = {
        "site": "Jezero", "corridor_m": width, "n_path": int(y.sum()), "n_background": int((y == 0).sum()),
        "model_auc": model_auc, "slope_auc": base_auc,
        "model_path_share_top20": model_capture, "model_lift_top20": model_capture / .2,
        "slope_path_share_top20": base_capture, "slope_lift_top20": base_capture / .2,
    }
    print(f"\nJezero vs Perseverance ({width:g} m background corridor)")
    print(f"  model     AUC {model_auc:.3f}; top-20% path share {model_capture:.3f}; lift {model_capture/.2:.3f}x")
    print(f"  slope-only AUC {base_auc:.3f}; top-20% path share {base_capture:.3f}; lift {base_capture/.2:.3f}x")
    print(f"  samples: {int(y.sum()):,} path, {int((y == 0).sum()):,} background")
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corridors", nargs="+", type=float, default=[100.0, 200.0])
    args = ap.parse_args()
    for width in args.corridors:
        model_path = MODEL_DIR / f"walkability_gale_{int(width)}m.joblib"
        if not model_path.exists():
            raise FileNotFoundError(f"Missing Gale model {model_path}; run train_walkability.py first")
        model = joblib.load(model_path)
        X, y, *_ = jezero_evaluation_data(width, seed=1)
        result = report(width, X, y, model)
        (MODEL_DIR / f"eval_jezero_{int(width)}m.json").write_text(json.dumps(result, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
