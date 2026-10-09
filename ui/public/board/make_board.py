#!/usr/bin/env python3
"""Realistic procedural wooden board textures for TorsGUI.

Original artwork generated from a simple physical model of flat-sawn wood
(no source images). GPL-3.0-or-later.

Model, per pixel (u = along the grain, v = across):
  * annual rings: phase = rings per tile along v, plus periodic "ridges"
    (the log surface rising/falling under the cut), which turn the rings into
    nested cathedral arches; year widths and latewood density vary per year;
  * ring profile: earlywood light, gradual darkening into latewood, sharp
    boundary into the next year's earlywood;
  * fibres and pores run straight along u (they follow the log axis, not the
    rings), so they cross the cathedral arcs as in real flat-sawn boards;
  * maple gets tiny ray flecks, walnut gets visible pore lines and a few
    long mineral streaks; colour shifts toward orange/red in the latewood.
Everything is periodic, so the textures tile; rendering happens at 2x and is
box-filtered down.

Outputs: light.webp, dark.webp, board.webp, frame.webp, preview.png
"""
import os
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
SS = 2          # supersampling factor
T = 512         # tile size


def hex2rgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)


def pnoise(rng, h, w, sx, sy):
    """Periodic anisotropic gaussian noise, zero mean, unit std (sx, sy in px)."""
    n = rng.standard_normal((h, w)).astype(np.float32)
    fy = np.fft.fftfreq(h).astype(np.float32)[:, None]
    fx = np.fft.rfftfreq(w).astype(np.float32)[None, :]
    k = np.exp(-2 * (np.pi ** 2) * ((fx * sx) ** 2 + (fy * sy) ** 2))
    a = np.fft.irfft2(np.fft.rfft2(n) * k, s=(h, w)).astype(np.float32)
    a -= a.mean()
    return a / (a.std() + 1e-12)


def warp_sample(a, du, dv):
    """Sample a periodic field at (u + du, v + dv), bilinear, wrap-around."""
    h, w = a.shape
    vv, uu = np.mgrid[0:h, 0:w].astype(np.float32)
    x = uu + du
    y = vv + dv
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    fx = x - x0
    fy = y - y0
    x0 %= w
    y0 %= h
    x1 = (x0 + 1) % w
    y1 = (y0 + 1) % h
    return ((a[y0, x0] * (1 - fx) + a[y0, x1] * fx) * (1 - fy)
            + (a[y1, x0] * (1 - fx) + a[y1, x1] * fx) * fy)


def pdist(c, c0, period):
    """Smooth periodic signed distance."""
    return np.sin(np.pi * (c - c0) / period) * period / np.pi


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def wood(seed, base, w, h, p):
    """Return an (h, w, 3) float array at final resolution (rendered at SS x)."""
    rng = np.random.default_rng(seed)
    W, H = w * SS, h * SS
    vv, uu = np.mgrid[0:H, 0:W].astype(np.float32)

    # grain wobble shared by rings and fibres (slow, mostly across the grain)
    wob_v = (pnoise(rng, H, W, W * 0.10, H * 0.05) * p['wobble'] * SS
             + pnoise(rng, H, W, W * 0.03, H * 0.012) * p['wobble'] * 0.25 * SS)
    wob_u = pnoise(rng, H, W, W * 0.08, H * 0.08) * 6 * SS
    # extra, ring-only distortion (rings are less straight than fibres)
    ring_v = pnoise(rng, H, W, W * 0.18, H * 0.06) * p['ring_warp'] * SS
    u = uu + wob_u
    v = vv + wob_v + ring_v

    n = p['rings'] * (h / T)                                     # whole years per tile
    n = max(1, int(round(n)))
    phase = n * v / H
    # ridges -> cathedral figure
    for _ in range(p['ridges'] * max(1, (w * h) // (T * T))):
        u0, v0 = rng.uniform(0, W), rng.uniform(0, H)
        su = W * rng.uniform(*p['ridge_len']) * (T / w)
        sv = H * rng.uniform(0.035, 0.08) * (T / h)
        k = rng.uniform(*p['ridge_k']) * rng.choice([-1, 1])
        du = np.abs(pdist(u, u0, W)) / su
        dv = pdist(v, v0, H) / sv
        phase += k * np.exp(-(du ** 1.5 + dv ** 2))
    # uneven year widths (keeps phase periodic: harmonics of n)
    js = rng.choice(np.arange(1, max(2, n)), size=min(4, max(1, n - 1)), replace=False)
    amp = 0.55 / sum(2 * np.pi * j / n for j in js)
    hph = phase.copy()
    for j in js:
        hph += amp * rng.uniform(0.5, 1.0) * np.sin(2 * np.pi * j * phase / n + rng.uniform(0, 6.3))
    year = np.floor(hph).astype(np.int64) % n
    f = hph - np.floor(hph)
    inten = np.clip(1 + 0.35 * rng.standard_normal(n), 0.45, 1.7).astype(np.float32)[year]
    e0 = rng.uniform(0.25, 0.55, n).astype(np.float32)[year]     # earlywood fraction
    late = np.clip((f - e0) / (1 - e0), 0, 1) ** p['late_pow']
    late *= 1 - smoothstep(0.985, 1.0, f)                        # sharp year boundary
    dens = late * inten                                          # 0 = earlywood
    # earlywood pore band: sharp edge at the year boundary, fading into the year;
    # in flat-sawn ash these thin tan bands are the grain lines you actually see
    pband = smoothstep(0.0, 0.02, f) * np.exp(-f / p.get('pband_w', 0.1)) * np.sqrt(inten)

    # fibres, straight along the grain with the shared wobble
    fib = warp_sample(pnoise(rng, H, W, W * 0.05, 1.4 * SS), 0, wob_v)
    fine = warp_sample(pnoise(rng, H, W, 10 * SS, 0.5 * SS), 0, wob_v)
    # pores: thin short dashes, more of them in the earlywood
    pr = warp_sample(pnoise(rng, H, W, p['pore_len'] * SS, 0.35 * SS), 0, wob_v)
    pores = np.clip(pr - p['pore_thr'], 0, None)
    pores /= pores.max() + 1e-6
    pores *= (1 - p['pore_ring'] * np.clip(dens, 0, 1))
    # ray flecks: tiny dashes across the grain
    fl = pnoise(rng, H, W, 0.6 * SS, 2.2 * SS)
    flecks = np.clip(fl - 3.0, 0, None)
    flecks /= flecks.max() + 1e-6
    # broad colour drift and occasional mineral streaks
    drift = pnoise(rng, H, W, W * 0.35, H * 0.10)
    st = pnoise(rng, H, W, W * 0.30, H * 0.012)
    streak = np.clip(st - 2.3, 0, None)
    streak /= streak.max() + 1e-6
    # curly (fiddleback) figure: soft wavy bands across the grain, the shimmer
    # a satin finish gives to premium maple; drawn last so the fields above keep their seeds
    m = max(1, int(round(p.get('curl_n', 32) * w / T)))
    cph = (m * u / W + 0.40 * pnoise(rng, H, W, W * 0.04, H * 0.15)
           + 0.12 * pnoise(rng, H, W, W * 0.01, H * 0.04))
    curl = np.sin(2 * np.pi * cph)
    curl = np.sign(curl) * np.abs(curl) ** 0.7
    curl *= smoothstep(-0.6, 1.4, pnoise(rng, H, W, W * 0.25, H * 0.12))

    c = p['contrast']
    dm = dens - dens.mean()
    lum = (1 - c * p['ring'] * dm
           + c * p['fib'] * fib + c * p['fine'] * fine
           - c * p['pore'] * pores - c * p['fleck'] * flecks
           + c * p['drift'] * drift - c * p['streak'] * streak
           + c * p.get('curl', 0.0) * curl)
    ptex = smoothstep(-1.0, 1.6, warp_sample(pnoise(rng, H, W, 5 * SS, 0.5 * SS), 0, wob_v))
    pband = pband * (0.55 + 0.45 * ptex)                         # the band is made of pores: streaky
    hue = np.asarray(p['late_hue'], dtype=np.float32)            # per-channel shift in latewood
    col = np.empty((H, W, 3), np.float32)
    for ch in range(3):
        col[..., ch] = (base[ch] * lum * (1 + hue[ch] * dm) * (1 + p['drift_hue'][ch] * drift)
                        * (1 - p.get('pband', 0.0) * p.get('pband_gain', (1, 1, 1))[ch] * pband))
    # box filter down to final size (keeps the texture periodic)
    col = col.reshape(h, SS, w, SS, 3).mean(axis=(1, 3))
    for _ in range(3):                                           # mean back to base, mind clipping
        col = np.clip(col * (base / col.reshape(-1, 3).mean(axis=0)), 0, 255)
    return col.astype(np.float64)


def to_img(a):
    return Image.fromarray(np.clip(a + 0.5, 0, 255).astype(np.uint8), 'RGB')


def save_webp(img, name, q=85):
    path = os.path.join(OUT, name)
    img.save(path, 'WEBP', quality=q, method=6)
    print(name, img.size, os.path.getsize(path) // 1024, 'KB')


LIGHT, DARK = hex2rgb('#fcd7a2'), hex2rgb('#ab6826')
# ash: pale, ring-porous, crisp tan grain lines, straight runs and cathedrals
P_LIGHT = dict(rings=26, ridges=4, ridge_len=(0.20, 0.45), ridge_k=(2.0, 5.0), wobble=3, ring_warp=4,
               late_pow=1.4, contrast=0.040, ring=-0.3, fib=0.35, fine=0.35, pore=0.8, pore_len=8,
               pore_thr=2.3, pore_ring=0.7, fleck=0.0, drift=0.45, streak=0.0, curl=0.0,
               pband=0.15, pband_w=0.10, pband_gain=(1.0, 1.3, 2.0),
               late_hue=(0.0, 0.0, 0.0), drift_hue=(0.0, 0.004, 0.012))
# walnut: mostly straight grain, many long fine dark pore streaks, soft ring lines
P_DARK = dict(rings=30, ridges=2, ridge_len=(0.18, 0.40), ridge_k=(1.0, 3.0), wobble=4, ring_warp=4,
              late_pow=1.3, contrast=0.070, ring=0.5, fib=0.45, fine=0.50, pore=3.0, pore_len=14,
              pore_thr=1.8, pore_ring=0.6, fleck=0.0, drift=0.50, streak=1.6, curl=0.0,
              pband=0.10, pband_w=0.07, pband_gain=(1.1, 1.1, 1.2),
              late_hue=(0.03, -0.04, -0.15), drift_hue=(0.0, -0.01, -0.03))

light_a = wood(101, LIGHT, T, T, P_LIGHT)
dark_a = wood(202, DARK, T, T, P_DARK)
light_img, dark_img = to_img(light_a), to_img(dark_a)
save_webp(light_img, 'light.webp')
save_webp(dark_img, 'dark.webp')

# ---------------------------------------------------------------- board
# every square is cut from a larger plank (same wood, different seed), with a
# random offset, flip and a small tilt, so each looks like its own inlaid piece
SQ = 128
PL = 1024
plank_l = to_img(wood(303, LIGHT, PL, PL, P_LIGHT))
plank_d = to_img(wood(404, DARK, PL, PL, P_DARK))
rng = np.random.default_rng(2024)


def square_from(plank, jitter_lum):
    big = Image.new('RGB', (PL * 3, PL * 3))
    for i in range(3):
        for j in range(3):
            big.paste(plank, (i * PL, j * PL))
    ang = rng.uniform(-2.2, 2.2)
    if rng.random() < 0.12:
        ang += rng.choice([-1, 1]) * rng.uniform(3, 4)
    rot = big.rotate(ang, resample=Image.BICUBIC, center=(PL * 1.5, PL * 1.5))
    ox = int(rng.integers(0, PL)) + PL // 2
    oy = int(rng.integers(0, PL)) + PL // 2
    cr = rot.crop((ox, oy, ox + SQ, oy + SQ))
    if rng.random() < 0.5:
        cr = cr.transpose(Image.FLIP_TOP_BOTTOM)
    if rng.random() < 0.5:
        cr = cr.transpose(Image.FLIP_LEFT_RIGHT)
    return np.asarray(cr, dtype=np.float64) * (1 + rng.uniform(-jitter_lum, jitter_lum))


board = np.zeros((SQ * 8, SQ * 8, 3))
for r in range(8):
    for c in range(8):
        light = (r + c) % 2 == 0
        board[r * SQ:(r + 1) * SQ, c * SQ:(c + 1) * SQ] = square_from(
            plank_l if light else plank_d, 0.025 if light else 0.035)
for k in range(1, 8):
    q = k * SQ
    for off, fct in ((-1, 0.93), (0, 0.86)):
        board[q + off, :, :] *= fct
        board[:, q + off, :] *= fct
board_img = to_img(board)
save_webp(board_img, 'board.webp')

# ---------------------------------------------------------------- frame (9-slice, 48 px)
# Four mitred rails of the same realistic wood, grain along each rail, with a
# moulded profile lit from the top-left: dark outer edge, rounded bullnose,
# flat field, a thin light inlay stringer, then a small cove down to the board.
B, FS = 48, 512
FR, EDGE = hex2rgb('#d4915a'), hex2rgb('#a4642e')
STRING = hex2rgb('#f3d9ac')
P_FRAME = dict(P_LIGHT, rings=10, ridges=4, contrast=0.050, fleck=0.4, pore=1.2, curl=0.0, pband=0.08,
               late_hue=(0.02, -0.03, -0.10))
src = wood(505, FR, FS, FS, P_FRAME)
str_tex = wood(606, STRING, FS, FS, dict(P_LIGHT, contrast=0.03, curl=0.0, pband=0.0))
yy, xx = np.mgrid[0:FS, 0:FS]
dist = np.minimum.reduce([xx, yy, FS - 1 - xx, FS - 1 - yy]).astype(np.float64)
top = (yy <= xx) & (yy < FS - 1 - xx)
bot = (FS - 1 - yy <= FS - 1 - xx) & (FS - 1 - yy < xx)
left = ~top & ~bot & (xx < FS / 2)
right = ~top & ~bot & ~left
# each rail cut from a different strip of the plank (separate pieces of wood)
srcT = src.transpose(1, 0, 2)
rail = np.zeros((FS, FS, 3))
rail[top] = src[(yy[top] + 20) % FS, xx[top]]
rail[bot] = src[(FS - 1 - yy[bot] + 150) % FS, (xx[bot] + 211) % FS]
rail[left] = srcT[(yy[left] + 97) % FS, (xx[left] + 290) % FS]
rail[right] = srcT[(yy[right] + 333) % FS, (FS - 1 - xx[right] + 410) % FS]
# moulding: slope s(d) > 0 faces outward; light from the top-left
d = dist
s = np.zeros_like(d)
bn = (d >= 2) & (d < 9)
s[bn] = np.cos((d[bn] - 2) / 7 * np.pi / 2)            # bullnose rolling off the outer edge
cv = (d >= 43) & (d < 47)
s[cv] = -0.75 * np.sin((d[cv] - 43) / 4 * np.pi)       # cove facing the board
side = np.where(top | left, 1.0, -1.0) * np.where(top | bot, 1.0, 0.8)
lum = 1 + 0.085 * s * side
rgb = rail * lum[..., None]
# inlay stringer: dark hairline, light wood, dark hairline
strg = ((d >= 39) & (d < 42))[..., None]
rgb = np.where(strg, str_tex * (1 + 0.03 * side)[..., None], rgb)
for dd, k in ((38, 0.30), (42, 0.35)):
    m = (np.abs(d - dd) < 0.5)[..., None] * k
    rgb = rgb * (1 - m) + EDGE * 0.75 * m
# mitre joints
dg = np.minimum(np.abs(yy - xx), np.abs(yy - (FS - 1 - xx)))
rgb = rgb * np.where(dg == 0, 0.86, np.where(dg == 1, 0.95, 1.0))[..., None]
# outer dark edge and a thin shadow line where the frame meets the board
ew = np.clip((2.5 - d) / 1.0, 0, 1)[..., None]
rgb = rgb * (1 - ew) + EDGE * ew
il = (d == B - 1)[..., None] * 0.45
rgb = rgb * (1 - il) + EDGE * 0.8 * il
frame = np.zeros((FS, FS, 4))
frame[..., :3] = rgb
frame[..., 3] = np.where(d < B, 255, 0)
fimg = Image.fromarray(np.clip(frame + 0.5, 0, 255).astype(np.uint8), 'RGBA')
save_webp(fimg, 'frame.webp')
print('frame field mean', rgb[(d >= 9) & (d < 38)].mean(0).round(1), 'target', FR)

# ---------------------------------------------------------------- preview
PS = 96
pv = board_img.resize((PS * 8, PS * 8), Image.LANCZOS)
pvw = PS * 8 + 2 * B
canvas = Image.new('RGB', (pvw, pvw), (40, 40, 40))
cw = pvw - 2 * B
slices = [((0, 0, B, B), (0, 0), (B, B)), ((B, 0, FS - B, B), (B, 0), (cw, B)),
          ((FS - B, 0, FS, B), (pvw - B, 0), (B, B)), ((0, B, B, FS - B), (0, B), (B, cw)),
          ((FS - B, B, FS, FS - B), (pvw - B, B), (B, cw)), ((0, FS - B, B, FS), (0, pvw - B), (B, B)),
          ((B, FS - B, FS - B, FS), (B, pvw - B), (cw, B)), ((FS - B, FS - B, FS, FS), (pvw - B, pvw - B), (B, B))]
for box, pos, sz in slices:
    im = fimg.crop(box).resize(sz, Image.BICUBIC)
    canvas.paste(im, pos, im)
canvas.paste(pv, (B, B))
d = ImageDraw.Draw(canvas)
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', int(PS * 0.78))
glyph = {'k': '♚', 'q': '♛', 'r': '♜', 'b': '♝', 'n': '♞', 'p': '♟'}
layout = {
    'a8': 'r', 'd8': 'q', 'e8': 'k', 'h8': 'r', 'b7': 'p', 'f7': 'p', 'g7': 'p', 'c6': 'n', 'f6': 'b',
    'e4': 'P', 'd5': 'P', 'c3': 'N', 'f3': 'N', 'c4': 'B', 'a2': 'P', 'b2': 'P', 'g2': 'P', 'h2': 'P',
    'a1': 'R', 'd1': 'Q', 'e1': 'K', 'h1': 'R',
}
for sqn in ('e2', 'e4'):
    c = 'abcdefgh'.index(sqn[0]); r = 8 - int(sqn[1])
    ov = Image.new('RGBA', (PS, PS), (255, 230, 80, 90))
    canvas.paste(ov, (B + c * PS, B + r * PS), ov)
for sqn, pc in layout.items():
    c = 'abcdefgh'.index(sqn[0]); r = 8 - int(sqn[1])
    cx, cy = B + c * PS + PS // 2, B + r * PS + PS // 2 + 2
    white = pc.isupper()
    fill, stroke = ((250, 248, 240), (30, 24, 20)) if white else ((38, 30, 26), (225, 215, 200))
    d.text((cx, cy), glyph[pc.lower()], font=font, fill=fill, anchor='mm', stroke_width=3, stroke_fill=stroke)
    d.text((cx, cy), glyph[pc.lower()], font=font, fill=fill, anchor='mm')
canvas.save(os.path.join(OUT, 'preview.png'))
print('preview.png', canvas.size)

# ---------------------------------------------------------------- stats
lt = np.asarray(Image.open(os.path.join(OUT, 'light.webp')).convert('RGB'), dtype=float)
dk = np.asarray(Image.open(os.path.join(OUT, 'dark.webp')).convert('RGB'), dtype=float)
print('light mean', lt.reshape(-1, 3).mean(0).round(1), 'target', LIGHT, 'std', lt.std(axis=(0, 1)).round(1))
print('dark  mean', dk.reshape(-1, 3).mean(0).round(1), 'target', DARK, 'std', dk.std(axis=(0, 1)).round(1))
bd = np.asarray(Image.open(os.path.join(OUT, 'board.webp')).convert('RGB'), dtype=float)
Ls, Ds = [], []
for r in range(8):
    for c in range(8):
        blk = bd[r * SQ + 3:(r + 1) * SQ - 3, c * SQ + 3:(c + 1) * SQ - 3].reshape(-1, 3).mean(0)
        (Ls if (r + c) % 2 == 0 else Ds).append(blk)
print('board light squares', np.mean(Ls, 0).round(1), ' dark', np.mean(Ds, 0).round(1))
for nm, a in (('light', lt), ('dark', dk)):
    print(nm, 'wrap diff x/y', round(np.abs(a[:, 0] - a[:, -1]).mean(), 2), round(np.abs(a[0] - a[-1]).mean(), 2),
          'interior', round(np.abs(a[:, 200] - a[:, 201]).mean(), 2), round(np.abs(a[200] - a[201]).mean(), 2))
