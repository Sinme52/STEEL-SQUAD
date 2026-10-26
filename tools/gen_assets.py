#!/usr/bin/env python3
"""gpt-image-2.5 スキルでゲームの画像素材を生成する。

  python3 tools/gen_assets.py            # まだ無い素材だけ生成
  python3 tools/gen_assets.py tank heli  # 指定した素材だけ作り直す

生成物は art-src/raw/ に PNG と JSON（プロンプト記録）で保存される。
ゲームで使う形への加工は tools/process_assets.py が行う。
API キーはスキルと同じく OPENAI_IMAGE_API_KEY から読む（値は表示しない）。
"""

import glob
import importlib.util
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "art-src" / "raw"


def load_skill():
    path = os.environ.get("GPT_IMAGE_SCRIPT")
    if not path:
        hits = glob.glob("/root/.claude/skills/**/gpt-image-2-5/scripts/gpt_image.py", recursive=True)
        hits += glob.glob(os.path.expanduser("~/.claude/skills/**/gpt-image-2-5/scripts/gpt_image.py"), recursive=True)
        if not hits:
            sys.exit("gpt_image.py が見つかりません。GPT_IMAGE_SCRIPT にパスを指定してください。")
        path = hits[0]
    spec = importlib.util.spec_from_file_location("gpt_image", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


NO_MARKS = (" Absolutely no emblems, insignia, faction symbols, crests, flags or banners anywhere; "
            "keep armor surfaces plain apart from simple stripes and weathering.")

STYLE = (
    "2D side-scrolling video game art, hand-painted digital illustration, "
    "realistic 1990s Japanese real-robot military mecha style, gritty and grounded, "
    "weathered paint, chipped edges, panel lines, hydraulic pistons, small stencil markings, "
    "strong readable silhouette, soft light from the upper left. "
    "Original design, no logos, no text, no letters, no numbers."
)

MECHS = {
    "assault": "a very heavy front-line assault mecha: bulky layered armor, broad shoulders, thick legs, "
               "a huge riveted tower shield mounted on the far arm, a short heavy machine gun in the near arm, "
               "olive drab paint with bright orange accent stripes",
    "striker": "a heavy-firepower artillery mecha: sturdy frame, a boxy six-cell missile pod on the back, "
               "a long-barrel cannon held in the near arm, stabilizer struts on the legs, "
               "desert tan paint with red accent stripes",
    "scout": "a slim, lightweight, fast reconnaissance mecha: narrow armor, long sensor antennas on the head, "
             "large thrusters on the back, a long sniper rifle in the near arm, "
             "dark gunmetal grey paint with cyan accent stripes and cyan sensor eye",
    "support": "a medium-weight field-engineering support mecha: a backpack with supply containers and a folded "
               "crane-like repair arm, a compact submachine gun in the near arm, white cross marking on the shoulder, "
               "steel blue paint with yellow accent stripes",
    "enemy": "a hostile mass-produced grunt mecha: hunched aggressive posture, single round red mono-eye sensor, "
             "angular armor, an assault rifle in the near arm, "
             "dark crimson and black paint",
}

REF_PROMPT = (
    "Full body of {desc}. Strict side view (profile), facing right, standing in a neutral pose with the near arm "
    "holding the weapon pointing straight forward horizontally. The whole robot is visible with empty margin around it, "
    "centered, on a fully transparent background, no ground, no shadow. " + STYLE
)

SHEET_PROMPT = (
    "Using the mecha in the reference image, create a 2D cutout-animation parts sheet of THIS SAME mecha "
    "(identical design, colors, markings and painting style), every part seen exactly from the side, facing right. "
    "Draw each part separately and NOT touching, with wide empty gaps between parts, on a fully transparent background, "
    "arranged in one row from left to right: "
    "(1) TORSO: chest, head, hips and backpack as one piece, with NO arms and NO legs; "
    "(2) ARM WITH WEAPON: shoulder, arm and the weapon as one piece, held horizontally, the weapon pointing right; "
    "(3) THIGH: the upper leg only, standing vertical, hip joint at the top, knee joint at the bottom; "
    "(4) SHIN: the lower leg only, standing vertical, knee joint at the top, ankle at the bottom; "
    "(5) FOOT: the foot only, flat on its sole, toes pointing right. "
    "All parts at the same scale as the reference. No text, no labels, no numbers, no shadows, no background."
)

BOSS_REF = (
    "Full body of a gigantic four-legged walking tank boss mecha: a massive armored hull with a long twin-barrel main cannon "
    "pointing forward, missile hatches on top, a glowing orange reactor core vent on the side, four heavy articulated "
    "mechanical legs. Strict side view facing right, whole machine visible with empty margin, on a fully transparent "
    "background, no ground, no shadow. Dark gunmetal and rust-orange paint. " + STYLE
)

BOSS_SHEET = (
    "Using the walking tank in the reference image, create a 2D cutout-animation parts sheet of THIS SAME machine "
    "(identical design, colors and painting style), side view facing right. Draw each part separately and NOT touching, "
    "with wide empty gaps, on a fully transparent background, in one row from left to right: "
    "(1) HULL: the main body with the twin-barrel cannon, with NO legs; "
    "(2) UPPER LEG: one upper leg segment, vertical, hip joint at the top, knee joint at the bottom; "
    "(3) LOWER LEG: one lower leg segment with its foot pad, vertical, knee joint at the top, foot at the bottom. "
    "Same scale as the reference. No text, no labels, no shadows, no background."
)

ASSETS = {}

for key, desc in MECHS.items():
    ASSETS[f"mech_{key}_ref"] = dict(prompt=REF_PROMPT.format(desc=desc), size="1024x1536", bg="transparent")
    ASSETS[f"mech_{key}_sheet"] = dict(prompt=SHEET_PROMPT, size="1536x1024", bg="transparent",
                                       ref=f"mech_{key}_ref")

ASSETS["mech_assault_shield"] = dict(
    prompt="Using the mecha in the reference image, draw ONLY its huge riveted tower shield as a separate object "
           "(identical colors, markings and painting style), seen from the side, standing vertical, the whole shield "
           "visible with margin, centered, on a fully transparent background. No robot, no arm, no text, no shadow.",
    size="1024x1536", bg="transparent", ref="mech_assault_ref")

ASSETS["boss_ref"] = dict(prompt=BOSS_REF, size="1536x1024", bg="transparent")
ASSETS["boss_sheet"] = dict(prompt=BOSS_SHEET, size="1536x1024", bg="transparent", ref="boss_ref")

ASSETS["tank"] = dict(
    prompt="A hostile medium battle tank, strict side view facing right, tracked hull, angular turret with a long cannon "
           "pointing forward, dark crimson and black paint, whole tank visible with margin, centered, on a fully "
           "transparent background, no ground, no shadow. " + STYLE,
    size="1536x1024", bg="transparent")
ASSETS["heli"] = dict(
    prompt="A hostile attack helicopter gunship, strict side view facing right, slim armored fuselage, stub wings with "
           "rocket pods, chin gun turret, tail rotor, dark crimson and black paint. Draw ONLY the rotor hub on top, "
           "WITHOUT the main rotor blades. Whole aircraft visible with margin, on a fully transparent background, "
           "no shadow. " + STYLE,
    size="1536x1024", bg="transparent")
ASSETS["turret"] = dict(
    prompt="Two separate parts of a hostile heavy gun emplacement for a side-scrolling game, side view, NOT touching, "
           "with a wide gap between them, on a fully transparent background: on the left, (1) a squat armored concrete "
           "and steel bunker base with a round turret ring on top; on the right, (2) the rotating gun head: a compact "
           "armored housing with twin barrels pointing right. Dark crimson and black paint with hazard markings. " + STYLE,
    size="1536x1024", bg="transparent")

ASSETS["bg_far"] = dict(
    prompt="Wide panoramic background painting for a side-scrolling action game, far layer: a war-torn continent at dusk, "
           "burning orange and violet sky with heavy clouds, distant mountain ranges, and far away a colossal orbital "
           "elevator tower rising straight up into the sky with blinking lights. Atmospheric perspective, no foreground "
           "objects, the lower 25 percent is hazy distant plains. Painterly, cinematic, muted military palette. "
           "No text, no people, no vehicles.",
    size="3072x1024", bg="opaque")
ASSETS["bg_mid"] = dict(
    prompt="Wide panoramic middle layer for a side-scrolling action game parallax background: a dark silhouette band of a "
           "ruined industrial city at dusk - broken refinery towers, smokestacks, cranes, collapsed buildings, power "
           "pylons - occupying only the lower half of the image, with a few small fires and rim light from an orange "
           "sky. The entire upper half is fully transparent, and everything above the skyline is transparent. "
           "Painterly, desaturated blue-violet tones. No text, no people.",
    size="3072x1024", bg="transparent")
ASSETS["bg_near"] = dict(
    prompt="Wide panoramic near layer for a side-scrolling action game parallax background: close dark silhouettes of a "
           "military industrial zone - pipes, chain-link fences, broken walls, girders, sandbags, wrecked trucks - "
           "occupying only the lower 40 percent of the image, very dark with slight orange rim light. Everything above "
           "is fully transparent. Painterly. No text, no people.",
    size="3072x1024", bg="transparent")
ASSETS["tex_ground"] = dict(
    prompt="Seamless tileable texture for side-scrolling game terrain blocks, front view: heavy reinforced concrete and "
           "riveted steel plates, cracks, grime and rust stains, dark grey-brown, evenly lit, no perspective, no "
           "objects, no text. Must tile seamlessly in both directions.",
    size="1024x1024", bg="opaque")

PORTRAIT = (
    "Character bust portrait for a military mecha game, 1990s anime-influenced realistic illustration, painterly, "
    "head and shoulders, three-quarter view facing right, dramatic lighting, dark slate grey background with subtle "
    "hangar haze. {desc} Wearing a {color} pilot suit with a headset. No text, no logos."
)
ASSETS["portrait_assault"] = dict(prompt=PORTRAIT.format(
    desc="A battle-hardened veteran man in his late forties, broad build, buzz-cut grey hair, scar across the cheek, calm stare.",
    color="olive drab and orange"), size="1024x1024", bg="opaque")
ASSETS["portrait_striker"] = dict(prompt=PORTRAIT.format(
    desc="A composed woman in her thirties, short silver hair, sharp eyes, slight confident smile.",
    color="desert tan and red"), size="1024x1024", bg="opaque")
ASSETS["portrait_scout"] = dict(prompt=PORTRAIT.format(
    desc="An energetic young man around twenty, messy dark hair, grin, visor pushed up on the forehead.",
    color="dark grey and cyan"), size="1024x1024", bg="opaque")
ASSETS["portrait_support"] = dict(prompt=PORTRAIT.format(
    desc="A cheerful field engineer woman in her late twenties, dark skin, braided hair tied back, goggles around the neck.",
    color="steel blue and yellow"), size="1024x1024", bg="opaque")

ASSETS["keyart"] = dict(
    prompt="Cinematic key art for a 2D co-op mecha action game: a squad of four distinct military mechas charging "
           "together across a burning battlefield at dusk - a heavy olive mecha with a huge shield in front, a tan "
           "artillery mecha firing a missile salvo, a slim dark grey scout mecha jumping with thrusters, a steel blue "
           "support mecha with a repair arm - against a hostile crimson mono-eye mecha army, a colossal orbital elevator "
           "tower in the far background, dramatic orange and violet sky, smoke and sparks. Painterly, epic, 1990s Japanese "
           "real-robot style. Leave calm empty sky space in the upper left third for a title. No text, no logos." + NO_MARKS,
    size="1536x864", bg="opaque")
ASSETS["logo"] = dict(
    prompt="Game title logo reading exactly \"STEEL SQUAD\" in bold, heavy, slightly slanted military stencil-inspired "
           "metallic letters with brushed steel texture, orange hot edge glow, scratches, a thin hazard-stripe underline. "
           "Only the logo, centered, on a fully transparent background, no other text.",
    size="1536x512", bg="transparent")

# Steam ストア用（ライブラリのヒーロー画像と縦長キーアート）
ASSETS["steam_hero"] = dict(
    prompt="Ultra-wide cinematic banner painting for a 2D co-op mecha action game: four distinct military mechas "
           "(heavy olive mecha with tower shield, tan artillery mecha with missile pod, slim dark grey scout mecha with "
           "thrusters, steel blue support mecha with crane arm) advancing in a line across a burning industrial "
           "battlefield at dusk, crimson mono-eye enemy mechas and a giant four-legged walking tank in the haze, "
           "a colossal orbital elevator tower in the far background, orange and violet sky. Subjects centered in the "
           "middle third, calm sky at the top. Painterly, 1990s Japanese real-robot style. No text, no logos." + NO_MARKS,
    size="3744x1248", bg="opaque")
ASSETS["steam_vertical"] = dict(
    prompt="Vertical poster key art for a 2D co-op mecha action game: a heavy olive military mecha with a huge riveted "
           "tower shield standing in front, three squad mates behind it (tan artillery mecha firing missiles, slim dark "
           "grey scout mecha jumping with thrusters, steel blue support mecha), burning industrial ruins at dusk, a "
           "colossal orbital elevator tower rising into the violet-orange sky. Leave the top 25 percent as calm sky for a "
           "title. Painterly, epic, 1990s Japanese real-robot style. No text, no logos." + NO_MARKS,
    size="1024x1536", bg="opaque")


def run_one(gi, name, spec):
    api_key = gi.load_api_key()
    started = time.time()
    if spec.get("ref"):
        ref_path = RAW / f"{spec['ref']}.png"
        if not ref_path.exists():
            ref_path = RAW.parent / "drafts" / f"{spec['ref']}.webp"
        fields = [("model", gi.DEFAULT_MODEL), ("prompt", spec["prompt"]), ("quality", "medium"),
                  ("size", spec["size"]), ("output_format", "png")]
        if spec.get("bg"):
            fields.append(("background", spec["bg"]))
        files = [("image[]", ref_path.name, ref_path.read_bytes(), gi.mime_for(ref_path))]
        body, ctype = gi._multipart(fields, files)
        payload, rid, _ = gi._post(f"{gi.base_url()}/images/edits", body, ctype, api_key)
    else:
        body = {"model": gi.DEFAULT_MODEL, "prompt": spec["prompt"], "quality": "medium",
                "size": spec["size"], "output_format": "png", "n": 1}
        if spec.get("bg"):
            body["background"] = spec["bg"]
        payload, rid, _ = gi._post(f"{gi.base_url()}/images/generations",
                                   json.dumps(body).encode("utf-8"), "application/json", api_key)
    meta = dict(spec, model=gi.DEFAULT_MODEL, quality="medium", request_id=rid,
                elapsed_sec=round(time.time() - started, 1), usage=payload.get("usage"))
    gi.save_results(payload, RAW, name, "png", meta)
    return name, meta["elapsed_sec"]


def main():
    gi = load_skill()
    RAW.mkdir(parents=True, exist_ok=True)
    wanted = sys.argv[1:]
    todo = [n for n in ASSETS if n in wanted] if wanted else \
        [n for n in ASSETS if not (RAW / f"{n}.png").exists() and not (RAW.parent / "drafts" / f"{n}.webp").exists()]
    # 参照画像が必要な素材は、参照画像ができてから回す
    first = [n for n in todo if not ASSETS[n].get("ref")]
    second = [n for n in todo if ASSETS[n].get("ref")]
    failed = []
    for batch in (first, second):
        with ThreadPoolExecutor(max_workers=6) as ex:
            futs = {ex.submit(run_one, gi, n, ASSETS[n]): n for n in batch}
            for f in as_completed(futs):
                n = futs[f]
                try:
                    _, sec = f.result()
                    print(f"ok   {n} ({sec}s)", flush=True)
                except Exception as e:  # noqa: BLE001
                    failed.append(n)
                    print(f"FAIL {n}: {e}", flush=True)
    if failed:
        print("failed:", " ".join(failed))
        sys.exit(1)


if __name__ == "__main__":
    main()
