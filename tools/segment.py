"""透過背景のパーツシートを、つながった塊ごとに切り分ける（numpy のみ）。"""
import numpy as np
from PIL import Image


def label(mask):
    """4近傍の連結成分ラベル（2パスの union-find）。"""
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32)
    parent = [0]

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    nxt = 1
    for y in range(h):
        row = mask[y]
        for x in range(w):
            if not row[x]:
                continue
            up = lab[y - 1, x] if y else 0
            left = lab[y, x - 1] if x else 0
            if up and left:
                a, b = find(up), find(left)
                lab[y, x] = min(a, b)
                if a != b:
                    parent[max(a, b)] = min(a, b)
            elif up or left:
                lab[y, x] = up or left
            else:
                parent.append(nxt)
                lab[y, x] = nxt
                nxt += 1
    roots = np.array([find(i) for i in range(nxt)], np.int32)
    return roots[lab]


def components(path, alpha_min=40, scale=4, min_frac=0.01):
    """大きい塊を左から順に返す: [(bbox(x0,y0,x1,y1), mask_fullres)]"""
    im = Image.open(path).convert("RGBA")
    a = np.array(im)[:, :, 3]
    small = np.array(Image.fromarray(a).resize((a.shape[1] // scale, a.shape[0] // scale), Image.BILINEAR)) > alpha_min
    lab = label(small)
    ids, counts = np.unique(lab[lab > 0], return_counts=True)
    total = counts.sum()
    big = [i for i, c in zip(ids, counts) if c / total >= min_frac]
    out = []
    for i in big:
        m = lab == i
        # 小さな破片は、外接矩形が大きな塊の外接矩形に含まれるならその塊に入れる
        ys, xs = np.nonzero(m)
        box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
        for j, c in zip(ids, counts):
            if j in big:
                continue
            ys2, xs2 = np.nonzero(lab == j)
            if xs2.min() >= box[0] - 2 and xs2.max() < box[2] + 2 and ys2.min() >= box[1] - 2 and ys2.max() < box[3] + 2:
                m = m | (lab == j)
        full = np.array(Image.fromarray(m.astype(np.uint8) * 255).resize((a.shape[1], a.shape[0]), Image.NEAREST)) > 0
        # 縁のにじみを拾うため少し膨らませる
        full = np.array(Image.fromarray(full.astype(np.uint8) * 255).filter(__import__("PIL.ImageFilter").ImageFilter.MaxFilter(9))) > 0
        full &= a > 8
        ys, xs = np.nonzero(full)
        out.append(((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1), full))
    out.sort(key=lambda t: t[0][0])
    return im, out


def crop_part(im, bbox, mask):
    arr = np.array(im).copy()
    arr[:, :, 3] = np.where(mask, arr[:, :, 3], 0)
    x0, y0, x1, y1 = bbox
    return Image.fromarray(arr[y0:y1, x0:x1])
