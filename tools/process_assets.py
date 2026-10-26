#!/usr/bin/env python3
"""art-src/raw の生成画像を、ゲームで使う形（public/assets と src/game/rigs.json）に加工する。

  python3 tools/process_assets.py           # 全部
  python3 tools/process_assets.py --preview # リグの組み立て確認画像も出す（art-src/preview）
"""

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from segment import components, crop_part  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "art-src" / "raw"


def raw(name):
    """生成した元画像。art-src/raw の PNG が無ければ drafts の WebP を使う。"""
    png = RAW / f"{name}.png"
    return png if png.exists() else RAW.parent / "drafts" / f"{name}.webp"
OUT = ROOT / "public" / "assets"
PREVIEW = ROOT / "art-src" / "preview"

# 画面上の背丈（ワールド座標 px）。保存は 1.5 倍の解像度で持つ
MECH_HEIGHT = {"assault": 200, "striker": 185, "scout": 175, "support": 185, "enemy": 180}
STORE = 1.5

# 自動推定がずれる所の手直し（パーツ画像内の正規化座標 0..1）
# くっついて生成されたパーツを横線で切り分ける: {機体: (塊の番号, 切る y 座標)}
SPLITS = {"striker": (3, 732)}

OVERRIDES = {
    # "scout": {"torso_shoulder": [0.55, 0.32]},
}


def trim(im, pad=2):
    a = np.array(im)[:, :, 3]
    ys, xs = np.nonzero(a > 8)
    return im.crop((max(xs.min() - pad, 0), max(ys.min() - pad, 0),
                    min(xs.max() + 1 + pad, im.width), min(ys.max() + 1 + pad, im.height)))


def save_webp(im, path, q=88):
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "WEBP", quality=q, method=6)


def alpha(im):
    return np.array(im)[:, :, 3] > 40


def rows_centroid_x(a, y0, y1):
    ys, xs = np.nonzero(a[y0:y1])
    return float(xs.mean()) if len(xs) else a.shape[1] / 2


def cols_centroid_y(a, x0, x1):
    ys, xs = np.nonzero(a[:, x0:x1])
    return float(ys.mean()) if len(ys) else a.shape[0] / 2


def auto_rig(parts):
    """パーツ画像から関節位置を推定する。座標はパーツ画像内の px。"""
    r = {}
    t = alpha(parts["torso"]); h, w = t.shape
    r["torso_hip"] = [rows_centroid_x(t, int(h * 0.85), h), h * 0.86]
    r["torso_shoulder"] = [rows_centroid_x(t, int(h * 0.22), int(h * 0.38)), h * 0.30]
    a = alpha(parts["arm"]); h, w = a.shape
    sx = int(w * 0.16)
    r["arm_shoulder"] = [w * 0.09, cols_centroid_y(a, 0, sx)]
    mx = int(w * 0.97)
    r["arm_muzzle"] = [w * 0.99, cols_centroid_y(a, mx, w)]
    for name, top, bot in (("thigh", 0.12, 0.88), ("shin", 0.1, 0.93)):
        p = alpha(parts[name]); h, w = p.shape
        r[f"{name}_top"] = [rows_centroid_x(p, 0, int(h * 0.25)), h * top]
        r[f"{name}_bot"] = [rows_centroid_x(p, int(h * 0.75), h), h * bot]
    f = alpha(parts["foot"]); h, w = f.shape
    r["foot_ankle"] = [rows_centroid_x(f, 0, int(h * 0.4)), h * 0.3]
    return r


def process_mech(key):
    im, comps = components(raw(f"mech_{key}_sheet"))
    if key in SPLITS:
        idx, cut = SPLITS[key]
        bbox, m = comps.pop(idx)
        top, bot = m.copy(), m.copy()
        top[cut:] = False
        bot[:cut] = False
        for mm in (top, bot):
            ys, xs = np.nonzero(mm)
            comps.insert(idx, ((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1), mm))
            idx += 1
    names = ["torso", "arm", "thigh", "shin", "foot"]
    if len(comps) != len(names):
        raise SystemExit(f"{key}: パーツ数が {len(comps)} 個（想定 {len(names)}）。シートを作り直してください。")
    parts = {n: trim(crop_part(im, b, m)) for n, (b, m) in zip(names, comps)}
    shield = raw(f"mech_{key}_shield")
    if shield.exists():
        parts["shield"] = trim(Image.open(shield).convert("RGBA"))
    rig = auto_rig(parts)
    # 正規化座標の手直しを px に戻して適用
    for k, v in OVERRIDES.get(key, {}).items():
        part = parts[k.split("_")[0]]
        rig[k] = [v[0] * part.width, v[1] * part.height]

    # 立ったときの高さ（足裏〜胴体の上端）から縮尺を決める
    def seg(n):
        return float(np.hypot(rig[f"{n}_bot"][0] - rig[f"{n}_top"][0], rig[f"{n}_bot"][1] - rig[f"{n}_top"][1]))
    foot_h = parts["foot"].height - rig["foot_ankle"][1]
    stand = seg("thigh") + seg("shin") + foot_h + rig["torso_hip"][1]
    scale = MECH_HEIGHT[key] * STORE / stand

    out = {"parts": {}, "store": STORE}
    for n, p in parts.items():
        # 盾だけは別に生成したので縮尺が違う。背丈の 0.7 倍に合わせる
        k = MECH_HEIGHT[key] * STORE * 0.7 / p.height if n == "shield" else scale
        p2 = p.resize((max(1, round(p.width * k)), max(1, round(p.height * k))), Image.LANCZOS)
        save_webp(p2, OUT / "mechs" / f"{key}_{n}.webp")
        out["parts"][n] = {"w": p2.width, "h": p2.height}
    out["rig"] = {k: [round(v[0] * scale / STORE, 1), round(v[1] * scale / STORE, 1)] for k, v in rig.items()}
    out["thigh"] = round(seg("thigh") * scale / STORE, 1)
    out["shin"] = round(seg("shin") * scale / STORE, 1)
    out["footH"] = round(foot_h * scale / STORE, 1)
    out["height"] = MECH_HEIGHT[key]
    # 格納庫・選択画面用の全身画
    ref = trim(Image.open(raw(f"mech_{key}_ref")).convert("RGBA"))
    ref.thumbnail((700, 700), Image.LANCZOS)
    save_webp(ref, OUT / "mechs" / f"{key}_full.webp")
    return out, parts


def preview_mech(key, rig, parts_dir):
    """直立ポーズを PIL で組み立てて確認用に保存する（ワールド px を 2 倍で描く）。"""
    S = 2.0
    canvas = Image.new("RGBA", (500, 520), (110, 130, 110, 255))
    gx, gy = 220, 480  # 足元
    r = rig["rig"]

    def place(name, anchor, at, angle=0.0):
        img = Image.open(parts_dir / f"{key}_{name}.webp").convert("RGBA")
        k = S / rig["store"]
        img = img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)
        ax, ay = anchor[0] * S, anchor[1] * S
        if angle:
            img2 = img.rotate(-angle, center=(ax, ay), expand=False, resample=Image.BICUBIC)
        else:
            img2 = img
        canvas.alpha_composite(img2, (round(at[0] - ax), round(at[1] - ay)))

    foot_y = gy
    ankle = (gx, foot_y - rig["footH"] * S)
    knee = (gx, ankle[1] - rig["shin"] * S)
    hip = (gx, knee[1] - rig["thigh"] * S)
    place("foot", r["foot_ankle"], ankle)
    place("shin", r["shin_top"], knee)
    place("thigh", r["thigh_top"], hip)
    place("torso", r["torso_hip"], hip)
    sh = (hip[0] + (r["torso_shoulder"][0] - r["torso_hip"][0]) * S,
          hip[1] + (r["torso_shoulder"][1] - r["torso_hip"][1]) * S)
    place("arm", r["arm_shoulder"], sh)
    d = ImageDraw.Draw(canvas)
    for p in (hip, knee, ankle, sh):
        d.ellipse((p[0] - 4, p[1] - 4, p[0] + 4, p[1] + 4), outline=(255, 0, 0))
    mz = (sh[0] + (r["arm_muzzle"][0] - r["arm_shoulder"][0]) * S, sh[1] + (r["arm_muzzle"][1] - r["arm_shoulder"][1]) * S)
    d.ellipse((mz[0] - 4, mz[1] - 4, mz[0] + 4, mz[1] + 4), outline=(255, 255, 0))
    PREVIEW.mkdir(parents=True, exist_ok=True)
    canvas.save(PREVIEW / f"rig_{key}.png")


def seamless(im, band=320):
    """左右の端を重ねてぼかし、横にループしても継ぎ目が出ないようにする。"""
    a = np.array(im.convert("RGBA")).astype(np.float32)
    period = a.shape[1] - band
    t = np.linspace(0, 1, band)[None, :, None]
    out = a[:, :period].copy()
    # 左端の帯を「右端の続き」から「元の左端」へ徐々に切り替える
    out[:, :band] = a[:, period:] * (1 - t) + a[:, :band] * t
    return Image.fromarray(out.clip(0, 255).astype(np.uint8))


def process_simple():
    # 背景
    save_webp(Image.open(raw("bg_far")).convert("RGB"), OUT / "bg" / "far.webp", 85)
    for n in ("mid", "near"):
        save_webp(seamless(Image.open(raw(f"bg_{n}"))), OUT / "bg" / f"{n}.webp", 85)
    tex = Image.open(raw("tex_ground")).convert("RGB").resize((512, 512), Image.LANCZOS)
    save_webp(tex, OUT / "bg" / "ground.webp", 85)

    # 敵（右向きで保存、ゲーム内で反転）
    for n, wpx in (("tank", 260), ("heli", 300)):
        im = trim(Image.open(raw(f"{n}")).convert("RGBA"))
        im = im.resize((round(wpx * STORE), round(im.height * wpx * STORE / im.width)), Image.LANCZOS)
        save_webp(im, OUT / "enemies" / f"{n}.webp")
    im, comps = components(raw("turret"))
    for n, wpx, (b, m) in zip(("turret_base", "turret_head"), (150, 120), comps):
        p = trim(crop_part(im, b, m))
        p = p.resize((round(wpx * STORE), round(p.height * wpx * STORE / p.width)), Image.LANCZOS)
        save_webp(p, OUT / "enemies" / f"{n}.webp")

    # ボス（胴体・上脚・下脚）
    im, comps = components(raw("boss_sheet"))
    hull_w = 620
    hb = comps[0]
    k = hull_w * STORE / (hb[0][2] - hb[0][0])
    for n, (b, m) in zip(("hull", "leg_upper", "leg_lower"), comps):
        p = trim(crop_part(im, b, m))
        p = p.resize((round(p.width * k), round(p.height * k)), Image.LANCZOS)
        save_webp(p, OUT / "enemies" / f"boss_{n}.webp")

    # UI
    for n in ("assault", "striker", "scout", "support"):
        p = Image.open(raw(f"portrait_{n}")).convert("RGB").resize((512, 512), Image.LANCZOS)
        save_webp(p, OUT / "ui" / f"portrait_{n}.webp", 86)
    key = Image.open(raw("keyart")).convert("RGB").resize((1920, 1080), Image.LANCZOS)
    save_webp(key, OUT / "ui" / "keyart.webp", 88)
    logo = trim(Image.open(raw("logo")).convert("RGBA"))
    logo.thumbnail((1200, 400), Image.LANCZOS)
    save_webp(logo, OUT / "ui" / "logo.webp", 90)


def main():
    rigs = {}
    for key in MECH_HEIGHT:
        rig, _ = process_mech(key)
        rigs[key] = rig
        if "--preview" in sys.argv:
            preview_mech(key, rig, OUT / "mechs")
    (ROOT / "src" / "game" / "rigs.json").write_text(json.dumps(rigs, indent=1), encoding="utf-8")
    process_simple()
    print("done:", ", ".join(rigs))


if __name__ == "__main__":
    main()
