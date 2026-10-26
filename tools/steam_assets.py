#!/usr/bin/env python3
"""Steam ストアページ用の画像を steam/ に書き出す（キーアート＋ロゴから合成）。"""
from pathlib import Path

from PIL import Image, ImageFilter, ImageEnhance

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "art-src" / "raw"


def raw(name):
    """生成した元画像。art-src/raw の PNG が無ければ drafts の WebP を使う。"""
    png = RAW / f"{name}.png"
    return png if png.exists() else RAW.parent / "drafts" / f"{name}.webp"
OUT = ROOT / "steam"


def cover(im, w, h, focus=(0.5, 0.5)):
    """縦横比を保って w×h を覆うように拡大し、focus を中心に切り抜く。"""
    s = max(w / im.width, h / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    x = round((im.width - w) * focus[0])
    y = round((im.height - h) * focus[1])
    return im.crop((x, y, x + w, y + h))


def with_logo(bg, logo, width_frac, pos):
    bg = bg.convert("RGBA")
    lw = round(bg.width * width_frac)
    lg = logo.resize((lw, round(logo.height * lw / logo.width)), Image.LANCZOS)
    # 読みやすくするため、ロゴの下に柔らかい影を敷く
    shadow = Image.new("RGBA", lg.size, (0, 0, 0, 0))
    shadow.putalpha(lg.getchannel("A").point(lambda a: int(a * 0.7)))
    shadow = shadow.filter(ImageFilter.GaussianBlur(max(2, lw // 60)))
    x = round((bg.width - lw) * pos[0])
    y = round((bg.height - lg.height) * pos[1])
    bg.alpha_composite(shadow, (x + 3, y + 5))
    bg.alpha_composite(lg, (x, y))
    return bg.convert("RGB")


def trim(im):
    return im.crop(im.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox())


def main():
    OUT.mkdir(exist_ok=True)
    key = Image.open(raw("keyart")).convert("RGB")
    vert = Image.open(raw("steam_vertical")).convert("RGB")
    hero = Image.open(raw("steam_hero")).convert("RGB")
    logo = trim(Image.open(raw("logo")).convert("RGBA"))

    out = {
        "header_capsule_920x430.jpg": with_logo(cover(key, 920, 430, (0.5, 0.45)), logo, 0.62, (0.08, 0.12)),
        "small_capsule_462x174.jpg": with_logo(cover(key, 462, 174, (0.5, 0.5)), logo, 0.86, (0.5, 0.5)),
        "main_capsule_1232x706.jpg": with_logo(cover(key, 1232, 706, (0.5, 0.45)), logo, 0.55, (0.08, 0.1)),
        "vertical_capsule_748x896.jpg": with_logo(cover(vert, 748, 896, (0.5, 0.35)), logo, 0.84, (0.5, 0.06)),
        "library_capsule_600x900.jpg": with_logo(cover(vert, 600, 900, (0.5, 0.4)), logo, 0.86, (0.5, 0.06)),
        "library_hero_3840x1240.jpg": cover(hero, 3840, 1240, (0.5, 0.5)),
        "page_background_1438x810.jpg": ImageEnhance.Brightness(cover(key, 1438, 810).filter(ImageFilter.GaussianBlur(6))).enhance(0.45),
    }
    for name, im in out.items():
        im.save(OUT / name, quality=90)
    # ライブラリのロゴ（透過 PNG）
    lw = 1280
    lg = logo.resize((lw - 80, round(logo.height * (lw - 80) / logo.width)), Image.LANCZOS)
    canvas = Image.new("RGBA", (1280, 720), (0, 0, 0, 0))
    canvas.alpha_composite(lg, (40, (720 - lg.height) // 2))
    canvas.save(OUT / "library_logo_1280x720.png")
    print("wrote", len(out) + 1, "files to", OUT)


if __name__ == "__main__":
    main()
