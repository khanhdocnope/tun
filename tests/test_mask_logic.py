"""Synthetic regression test for mask_logic (LaMa replaced by cv2.inpaint)."""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import cv2, numpy as np
from mask_logic import Det, CLS_TEXT_BUBBLE, CLS_TEXT_FREE, build_masks, flat_fill_uniform_paper

H, W = 500, 900
rng = np.random.default_rng(0)


def make_page(text_touches_border: bool):
    img = np.full((H, W, 3), 255, np.uint8)
    # screentone area (right-bottom): regular dots on light gray
    tone = np.zeros((H, W), np.uint8)
    for y in range(300, 480, 6):
        for x in range(520, 880, 6):
            cv2.circle(tone, (x, y), 1, 255, -1)
    img[tone > 0] = (40, 40, 40)
    # bubble: thick black outline + white inside
    c, ax = (300, 230), (200, 130)
    ring_outer = np.zeros((H, W), np.uint8); cv2.ellipse(ring_outer, c, ax, 0, 0, 360, 255, -1)
    inner = np.zeros((H, W), np.uint8);      cv2.ellipse(inner, c, (ax[0]-6, ax[1]-6), 0, 0, 360, 255, -1)
    ring = cv2.subtract(ring_outer, inner)
    img[ring > 0] = (0, 0, 0)
    img[inner > 0] = (255, 255, 255)
    # dialogue text
    t = np.zeros((H, W), np.uint8)
    y0 = 118 if text_touches_border else 150
    cv2.putText(t, "I WON'T LET YOU", (170, y0), cv2.FONT_HERSHEY_SIMPLEX, 1.0, 255, 3)
    cv2.putText(t, "DESTROY THIS!", (190, y0 + 60), cv2.FONT_HERSHEY_SIMPLEX, 1.0, 255, 3)
    img[t > 0] = (0, 0, 0)
    # SFX outside bubble
    s = np.zeros((H, W), np.uint8)
    cv2.putText(s, "DOOM", (600, 160), cv2.FONT_HERSHEY_DUPLEX, 3.0, 255, 8)
    img[s > 0] = (10, 10, 10)
    # mock CTD seg: strokes ~1.0, plus false positives on all screentone dots
    seg = np.zeros((H, W), np.float32)
    seg[cv2.dilate(t, np.ones((3, 3), np.uint8)) > 0] = 0.95
    seg[cv2.dilate(s, np.ones((3, 3), np.uint8)) > 0] = 0.9
    seg[tone > 0] = 0.9
    ys, xs = np.where(t > 0); bx = (xs.min() - 6, ys.min() - 6, xs.max() + 6, ys.max() + 6)
    ys, xs = np.where(s > 0); sx = (xs.min() - 4, ys.min() - 4, xs.max() + 4, ys.max() + 4)
    dets = [Det(CLS_TEXT_BUBBLE, .9, tuple(map(float, bx))), Det(CLS_TEXT_FREE, .9, tuple(map(float, sx)))]
    return img, seg, dets, ring, inner, t, s, tone


def run(img, seg, dets, clean_sfx):
    ms = build_masks(img, seg, dets, seg_thr=0.3, dilation_px=4)
    work, filled = flat_fill_uniform_paper(img, ms.chat_erase, ms.chat_boxes)
    target = cv2.bitwise_or(ms.chat_erase, ms.sfx_erase) if clean_sfx else ms.chat_erase
    lama_mask = cv2.bitwise_and(target, cv2.bitwise_not(filled))
    if lama_mask.any():
        work = cv2.inpaint(work, lama_mask, 3, cv2.INPAINT_TELEA)  # stand-in for LaMa
    return ms, work, filled


def check(touch):
    img, seg, dets, ring, inner, t, s, tone = make_page(touch)
    ms, out, filled = run(img, seg, dets, clean_sfx=False)
    g = cv2.cvtColor(out, cv2.COLOR_BGR2GRAY)
    ring_pixels_changed = int(((ring > 0) & (np.abs(out.astype(int) - img.astype(int)).sum(2) > 0)).sum())
    ring_total = int((ring > 0).sum())
    text_left = int(((t > 0) & (g < 200)).sum())
    inner_dirty = int(((inner > 0) & (cv2.erode(inner, np.ones((15, 15), np.uint8)) > 0) & (g < 200)).sum())
    tone_changed = int(((tone > 0) & (np.abs(out.astype(int) - img.astype(int)).sum(2) > 0)).sum())
    sfx_changed = int(((s > 0) & (np.abs(out.astype(int) - img.astype(int)).sum(2) > 0)).sum())
    print(f"[touch={touch}] mode1: ring px changed {ring_pixels_changed}/{ring_total} | text px left {text_left} "
          f"| dirty px inside bubble {inner_dirty} | screentone changed {tone_changed} | SFX changed {sfx_changed} "
          f"| flat-filled {int((filled>0).sum())}px")
    ms2, out2, _ = run(img, seg, dets, clean_sfx=True)
    g2 = cv2.cvtColor(out2, cv2.COLOR_BGR2GRAY)
    sfx_left = int(((s > 0) & (g2 < 120)).sum())
    tone_changed2 = int(((tone > 0) & (np.abs(out2.astype(int) - img.astype(int)).sum(2) > 0)).sum())
    print(f"[touch={touch}] mode2: SFX px still dark {sfx_left}/{int((s>0).sum())} | screentone changed {tone_changed2}")
    cv2.imwrite(f"/tmp/test_in_{int(touch)}.png", img); cv2.imwrite(f"/tmp/test_out_{int(touch)}.png", out)
    return dict(ring=ring_pixels_changed, text=text_left, dirty=inner_dirty, tone=tone_changed, sfx=sfx_changed, sfx_left=sfx_left, tone2=tone_changed2)


if __name__ == "__main__":
    for touch in (False, True):
        r = check(touch)
        assert r["tone"] == 0 and r["tone2"] == 0, "screentone must never be touched"
        assert r["sfx"] == 0, "SFX must be preserved in mode 1"
        assert r["dirty"] == 0, "bubble interior must be clean"
        print("   ring changed:", r["ring"], "| residual text:", r["text"])
