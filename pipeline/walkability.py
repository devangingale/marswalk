"""Walkability model: learn from where a rover drove, test on another site.

Written with AI assistance (Claude), directed and reviewed by the team.

    python pipeline/walkability.py train gale            # fits on Gale only
    python pipeline/walkability.py eval  jezero          # scores an unseen site
    python pipeline/walkability.py apply gale --area area  # writes walk.tif

Setup is positive-versus-background: positives are cells the rover drove
over; background is random cells in a corridor around the path. Nobody
labelled unsafe ground, so scores mean "looks like ground a rover chose",
not "probability of being safe".
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import lightgbm as lgb
import numpy as np
import rasterio
from scipy import ndimage as ndi
from sklearn.metrics import roc_auc_score

from common import ROOT, load_poses, load_site

MODEL_DIR = ROOT / "data" / "models"
PATH_RADIUS_M = 1.5      # cells this close to a pose count as driven
CORRIDOR_M = 100.0       # background is drawn from within this distance
EXCLUDE_M = 5.0          # ...but not this close to the path
MAX_GAP_M = 30.0         # do not join poses further apart than this
FEATURES = ["slope1", "slope5", "slope15", "slope_max5", "rough5", "rough15", "curv", "curv_abs15", "tpi15"]


def read(path: Path) -> np.ndarray:
    with rasterio.open(path) as src:
        return src.read(1)


def load_layers(cfg: dict, area: str):
    d = Path(cfg["out"]) / area
    with rasterio.open(d / "slope.tif") as src:
        tf, crs = src.transform, src.crs
    dem, slope, rough, curv = (read(d / f"{n}.tif") for n in ("dem", "slope", "rough", "curv"))
    # Gaps in the DEM: fill from the nearest valid cell so window filters do not
    # spread NaN, then mark everything within 8 m of a gap as unusable.
    hole = ~(np.isfinite(dem) & np.isfinite(slope) & np.isfinite(rough) & np.isfinite(curv))
    if hole.any():
        idx = ndi.distance_transform_edt(hole, return_distances=False, return_indices=True)
        dem, slope, rough, curv = (a[tuple(idx)] for a in (dem, slope, rough, curv))
        slope = slope.copy()
        slope[ndi.binary_dilation(hole, iterations=8)] = np.nan
    return dem, slope, rough, curv, tf, crs


def feature_stack(dem, slope, rough, curv) -> dict[str, np.ndarray]:
    """Terrain-only features, none tied to absolute elevation or position."""
    slope = np.nan_to_num(slope, nan=0.0)  # NaN only marks unusable cells; callers mask them
    f = {"slope1": slope, "rough5": rough, "curv": curv}
    f["slope5"] = ndi.uniform_filter(slope, 5)
    f["slope15"] = ndi.uniform_filter(slope, 15)
    f["slope_max5"] = ndi.maximum_filter(slope, 5)
    m15 = ndi.uniform_filter(dem, 15)
    f["rough15"] = np.sqrt(np.maximum(ndi.uniform_filter((dem - m15) ** 2, 15), 0))
    f["curv_abs15"] = ndi.uniform_filter(np.abs(curv), 15)
    f["tpi15"] = dem - m15  # height above/below the local 15 m mean
    return {k: v.astype("float32") for k, v in f.items()}


def path_mask(poses, tf, shape) -> np.ndarray:
    """Rasterise the driven path (poses joined where close) and widen it."""
    col = (poses["x"].to_numpy() - tf.c) / tf.a
    row = (poses["y"].to_numpy() - tf.f) / tf.e
    m = np.zeros(shape, bool)
    for i in range(len(col) - 1):
        gap = np.hypot(col[i + 1] - col[i], row[i + 1] - row[i])
        n = int(gap) + 1 if gap <= MAX_GAP_M else 1
        cs = np.linspace(col[i], col[i + 1] if n > 1 else col[i], n + 1)
        rs = np.linspace(row[i], row[i + 1] if n > 1 else row[i], n + 1)
        c, r = cs.astype(int), rs.astype(int)
        ok = (c >= 0) & (c < shape[1]) & (r >= 0) & (r < shape[0])
        m[r[ok], c[ok]] = True
    return m


def samples(cfg: dict, area: str, rng, n_bg_per_pos: int = 3):
    """Return features, labels, a sol for each sample (for splitting), and the corridor mask."""
    dem, slope, rough, curv, tf, _ = load_layers(cfg, area)
    feats = feature_stack(dem, slope, rough, curv)
    poses = load_poses(cfg)
    line = path_mask(poses, tf, slope.shape)
    dist, idx = ndi.distance_transform_edt(~line, return_indices=True)
    pos = dist <= PATH_RADIUS_M
    corridor = (dist > EXCLUDE_M) & (dist <= CORRIDOR_M)
    valid = np.isfinite(slope)
    pos &= valid
    corridor &= valid

    # Sol of the nearest path cell, so train/validation can split along the path.
    sol_grid = np.full(slope.shape, -1, np.int32)
    col = ((poses["x"].to_numpy() - tf.c) / tf.a).astype(int)
    row = ((poses["y"].to_numpy() - tf.f) / tf.e).astype(int)
    ok = (col >= 0) & (col < slope.shape[1]) & (row >= 0) & (row < slope.shape[0])
    sol_grid[row[ok], col[ok]] = poses["sol"].to_numpy()[ok]
    known = sol_grid >= 0
    near = ndi.distance_transform_edt(~known, return_distances=False, return_indices=True)
    sol_near = sol_grid[tuple(near)]

    pr, pc = np.nonzero(pos)
    br, bc = np.nonzero(corridor)
    take = rng.choice(len(br), size=min(len(br), n_bg_per_pos * len(pr)), replace=False)
    br, bc = br[take], bc[take]
    rr, cc = np.concatenate([pr, br]), np.concatenate([pc, bc])
    X = np.column_stack([feats[k][rr, cc] for k in FEATURES])
    y = np.concatenate([np.ones(len(pr), np.int8), np.zeros(len(br), np.int8)])
    sol = sol_near[rr, cc]
    print(f"{cfg['name']}/{area}: {len(pr):,} driven cells, {len(br):,} background cells "
          f"(corridor holds {int(corridor.sum()):,}); path length in grid ~{int(line.sum()) / 1000:.1f} km")
    return X, y, sol


def lift_at(y, score, share=0.2) -> float:
    """How over-represented driven cells are in the top `share` of scores (1.0 = chance)."""
    cut = np.quantile(score, 1 - share)
    top = score >= cut
    return float((y[top].mean()) / y.mean())


def capture_at(y, score, share=0.5) -> float:
    """Share of driven cells that fall in the top `share` of corridor ground by score."""
    bg = score[y == 0]
    cut = np.quantile(bg, 1 - share)
    return float((score[y == 1] >= cut).mean())


def report(name, y, model_score, slope5) -> dict:
    base = -slope5  # baseline: flatter is better
    out = {
        "n_driven": int(y.sum()), "n_background": int((y == 0).sum()),
        "model_auc": float(roc_auc_score(y, model_score)),
        "slope_auc": float(roc_auc_score(y, base)),
        "model_lift_top20": lift_at(y, model_score), "slope_lift_top20": lift_at(y, base),
        "model_capture_top50": capture_at(y, model_score), "slope_capture_top50": capture_at(y, base),
    }
    print(f"\n{name}")
    for k, v in out.items():
        print(f"  {k:22s} {v:,.3f}" if isinstance(v, float) else f"  {k:22s} {v:,}")
    return out


def cmd_train(args):
    cfg = load_site(args.site)
    rng = np.random.default_rng(0)
    X, y, sol = samples(cfg, "train_area", rng)
    cut = int(np.quantile(sol[y == 1], 0.75))  # last quarter of the drive held out
    tr, va = sol < cut, sol >= cut
    print(f"split at sol {cut}: train {int(tr.sum()):,}, validation {int(va.sum()):,}")
    model = lgb.LGBMClassifier(
        n_estimators=400, learning_rate=0.05, num_leaves=31, min_child_samples=200,
        subsample=0.8, subsample_freq=1, colsample_bytree=0.8, reg_lambda=5.0, verbose=-1, random_state=0,
    )
    model.fit(X[tr], y[tr], eval_X=X[va], eval_y=y[va], eval_metric="auc",
              callbacks=[lgb.early_stopping(40, verbose=False)])
    s5 = X[:, FEATURES.index("slope5")]
    res = {
        "trained_on": cfg["name"], "features": FEATURES, "split_sol": cut,
        "best_iteration": int(model.best_iteration_ or model.n_estimators),
        "train": report(f"{cfg['name']} train", y[tr], model.predict_proba(X[tr])[:, 1], s5[tr]),
        "validation": report(f"{cfg['name']} held-out path (sol >= {cut})", y[va], model.predict_proba(X[va])[:, 1], s5[va]),
    }
    imp = sorted(zip(FEATURES, model.booster_.feature_importance("gain")), key=lambda t: -t[1])
    tot = sum(v for _, v in imp)
    res["importance"] = {k: round(float(v / tot), 3) for k, v in imp}
    print("\nfeature importance (share of gain):", res["importance"])
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, MODEL_DIR / f"walkability_{int(CORRIDOR_M)}m.joblib")
    res["corridor_m"] = CORRIDOR_M
    (MODEL_DIR / f"train_report_{int(CORRIDOR_M)}m.json").write_text(json.dumps(res, indent=2))


def cmd_eval(args):
    cfg = load_site(args.site)
    model = joblib.load(MODEL_DIR / f"walkability_{int(CORRIDOR_M)}m.joblib")
    rng = np.random.default_rng(1)
    X, y, _ = samples(cfg, "train_area", rng)
    res = report(f"{cfg['name']} (never seen in training)", y, model.predict_proba(X)[:, 1], X[:, FEATURES.index("slope5")])
    res["corridor_m"] = CORRIDOR_M
    (MODEL_DIR / f"eval_{cfg['name']}_{int(CORRIDOR_M)}m.json").write_text(json.dumps(res, indent=2))


def cmd_apply(args):
    cfg = load_site(args.site)
    model = joblib.load(MODEL_DIR / f"walkability_{int(CORRIDOR_M)}m.joblib")
    dem, slope, rough, curv, tf, crs = load_layers(cfg, args.area)
    feats = feature_stack(dem, slope, rough, curv)
    h, w = slope.shape
    out = np.full((h, w), np.nan, "float32")
    for r0 in range(0, h, 500):
        sl = slice(r0, min(r0 + 500, h))
        X = np.column_stack([feats[k][sl].ravel() for k in FEATURES])
        out[sl] = model.predict_proba(X)[:, 1].reshape(-1, w)
    out[~np.isfinite(slope)] = np.nan
    from common import write_tif
    write_tif(Path(cfg["out"]) / args.area / "walk.tif", out, tf, crs, nodata=np.nan)
    print(f"walk.tif written: mean {np.nanmean(out):.3f}, p10 {np.nanpercentile(out, 10):.3f}, p90 {np.nanpercentile(out, 90):.3f}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name, fn in (("train", cmd_train), ("eval", cmd_eval), ("apply", cmd_apply)):
        p = sub.add_parser(name)
        p.add_argument("site")
        p.add_argument("--area", default="area")
        p.add_argument("--corridor", type=float, default=CORRIDOR_M, help="background corridor half-width in metres")
        p.set_defaults(fn=fn)
    a = ap.parse_args()
    CORRIDOR_M = a.corridor
    a.fn(a)
