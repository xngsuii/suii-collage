/* 배경 무늬. 배경색 위·사진 아래에 깔리고 내보낸 이미지에도 함께 나간다.

   state.bgPattern 하나만 보고 캔버스 전체를 채운다. 무늬는 두 갈래다.
   · 반복 무늬(모눈·도트·체커) — 작은 타일을 만들어 createPattern 으로 깐다.
     타일은 값이 바뀔 때만 다시 만든다(매 프레임 새로 그리지 않도록).
   · 사진 무늬(사진 흐림·픽셀화·하프톤) — 고른 사진을 흐리게 깔거나
     네모 칸 또는 망점으로 다시 찍는다. */

import { state, bgOpts } from 'app/state.js';

const tile = document.createElement('canvas');
let tileKey = '';

/* 사진에서 색을 집어 오는 축소본. getImageData 를 쓰므로 따로 둔다
   (willReadFrequently 는 캔버스를 만들 때 정해지고 나중에 바꿀 수 없다). */
const samp = document.createElement('canvas');
const sctx = samp.getContext('2d', { willReadFrequently: true });

/* 반투명하게 깔 때 겹친 자리만 진해지지 않도록, 일단 불투명하게 그려 두는 판. */
const buf = document.createElement('canvas');

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mix = (a, b, t) => Math.round(a + (b - a) * t);

function hexRgb(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function drawBackground(c, W, H) {
  const bp = state.bgPattern;
  if (!bp || bp.kind === 'none') return;
  const o = bgOpts();

  c.save();
  c.globalAlpha = clamp(o.opacity, 0, 1);
  if (bp.kind === 'gradient') gradientBg(c, W, H, o);
  else if (bp.kind === 'blur') photoBlur(c, W, H, o, bp.img);
  else if (bp.kind === 'pixel' || bp.kind === 'halftone') photoScreen(c, W, H, bp.kind, o, bp.img);
  else tiledBg(c, W, H, bp.kind, o);
  c.restore();
}

/* 배경색에서 무늬 색으로 번지는 그라데이션. 각도는 도형 채우기와 같은 규칙. */
function gradientBg(c, W, H, o) {
  const a = (o.angle * Math.PI) / 180;
  const len = Math.abs(Math.cos(a)) * W + Math.abs(Math.sin(a)) * H;
  const dx = (Math.cos(a) * len) / 2;
  const dy = (Math.sin(a) * len) / 2;
  const g = c.createLinearGradient(W / 2 - dx, H / 2 - dy, W / 2 + dx, H / 2 + dy);
  g.addColorStop(0, state.bg);
  g.addColorStop(1, o.color);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
}

/* ── 반복 무늬 ───────────────────────────── */

function tiledBg(c, W, H, kind, o) {
  const unit = Math.max(2, o.size);
  const weight = clamp(o.weight, 0.02, 1);
  // 체커는 두 칸이 모여 한 타일이 된다.
  const tw = kind === 'checker' ? unit * 2 : unit;

  const key = `${kind}|${unit}|${weight}|${o.color}`;
  if (key !== tileKey) {
    tileKey = key;
    tile.width = Math.max(1, Math.ceil(tw));
    tile.height = Math.max(1, Math.ceil(tw));
    const t = tile.getContext('2d');
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.clearRect(0, 0, tile.width, tile.height);
    t.fillStyle = o.color;

    if (kind === 'grid') {
      // 선은 타일 경계에 걸치지 않게 안쪽으로 붙인다(반복해도 굵기가 고르다).
      const lw = Math.max(0.6, unit * weight * 0.4);
      t.fillRect(0, 0, lw, tw);
      t.fillRect(0, 0, tw, lw);
    } else if (kind === 'dot') {
      t.beginPath();
      t.arc(unit / 2, unit / 2, Math.max(0.4, (unit / 2) * weight), 0, Math.PI * 2);
      t.fill();
    } else if (kind === 'checker') {
      t.fillRect(0, 0, unit, unit);
      t.fillRect(unit, unit, unit, unit);
    }
  }

  const pat = c.createPattern(tile, 'repeat');
  if (!pat) return;
  try {
    pat.setTransform(new DOMMatrix().translate(o.x, o.y).rotate(o.angle));
  } catch { /* setTransform 이 없는 브라우저 — 무늬만 반듯하게 깔린다 */ }
  c.fillStyle = pat;
  c.fillRect(0, 0, W, H);
}

/* ── 사진 무늬 ───────────────────────────── */

/* 고른 사진을 흐리게 깐다. size 가 흐림 반경(px)이다.
   blur 필터는 그림 가장자리를 투명하게 번지게 하므로, 반경만큼 넉넉히
   키워 그려 번지는 자리가 캔버스 밖으로 나가게 한다. */
function photoBlur(c, W, H, o, img) {
  if (!img?.width) return;
  clampBgPan(W, H);

  const r = Math.max(0, o.size);
  const z = coverZoom(img, W, H, o);
  const iw = img.width * z;
  const ih = img.height * z;
  // 짧은 변 기준으로 사방에 2r 씩 더 나가도록 비율을 지킨 채 키운다.
  const grow = 1 + (4 * r) / Math.max(1, Math.min(iw, ih));
  const gw = iw * grow;
  const gh = ih * grow;
  const cx = W / 2 + o.x;
  const cy = H / 2 + o.y;

  c.save();
  c.filter = [r > 0 ? `blur(${r}px)` : '', adjustFilter(o)].filter(Boolean).join(' ') || 'none';
  c.drawImage(img, cx - gw / 2, cy - gh / 2, gw, gh);
  c.restore();
}

/* 밝기·대비는 -1 ~ 1 로 받아 CSS 필터의 0 ~ 2 배로 옮긴다. */
function adjustFilter(o) {
  const b = clamp(o.brightness, -1, 1);
  const ct = clamp(o.contrast, -1, 1);
  const parts = [];
  if (b) parts.push(`brightness(${(1 + b).toFixed(3)})`);
  if (ct) parts.push(`contrast(${(1 + ct).toFixed(3)})`);
  return parts.join(' ');
}

/* 격자만 각도대로 돌리고 사진은 그대로 둔다. 칸 자리를 캔버스 좌표로 되돌려
   거기서 색을 집으므로, 사진이 기울지 않고 칸 줄만 비스듬해진다.
   픽셀화는 그 칸을 네모로 채우고, 하프톤은 어두움에 따라 크기가 변하는 원을 찍는다. */
function photoScreen(c, W, H, kind, o, img) {
  if (!img) return;
  clampBgPan(W, H);
  // 칸 하나하나를 따로 그리므로 개수가 곧 비용이다. 캔버스가 커도 한 변에
  // 300 줄쯤에서 멈추게 바닥을 깔아 둔다(끌고 있는 동안에도 버벅이지 않을 만큼).
  const cell = Math.max(4, o.size, Math.hypot(W, H) / 300);
  const at = sampler(img, W, H, o, cell);
  if (!at) return;

  const halftone = kind === 'halftone';
  const scale = clamp(o.weight, 0.02, 1) * 2;       // 0.5 가 기본 굵기
  const block = cell * Math.min(1, scale);          // 픽셀화에서 칸을 채우는 비율

  /* 칸을 꽉 채우는 설정이면 이웃끼리 반 픽셀씩 물려 그린다.
     칸 경계가 픽셀 한가운데(예: 칸 15 → 가장자리 ±7.5)에 떨어지면 두 칸이 그
     픽셀을 반씩만 덮어, 사이로 바탕색이 비쳐 격자 무늬처럼 보이기 때문이다. */
  const bleed = block >= cell - 0.001 ? 0.5 : 0;

  const tintAmount = clamp(o.tint, 0, 1);
  const ink = hexRgb(o.color);

  const a = (o.angle * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  // 돌려도 네 귀퉁이가 비지 않도록 대각선 길이만큼 깐다.
  const n = Math.ceil(Math.hypot(W, H) / cell) + 2;

  /* 서로 겹쳐 그리므로, 반투명하게 깔 때는 겹친 자리만 두 번 칠해져 진해진다.
     그럴 때만 딴 판에 불투명하게 그려 두고 마지막에 통째로 얹는다. */
  const alpha = c.globalAlpha;
  const buffered = alpha < 0.999 && (halftone || bleed > 0);
  let g = c;
  if (buffered) {
    buf.width = W;
    buf.height = H;
    g = buf.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
  }

  g.translate(W / 2, H / 2);
  g.rotate(a);

  // 하프톤은 잉크 한 색이라 점을 모아 한 번에 칠한다(수만 번 색을 바꾸지 않도록).
  const dots = halftone ? new Path2D() : null;

  for (let j = 0; j < n; j++) {
    const ly = (j - n / 2 + 0.5) * cell;
    for (let i = 0; i < n; i++) {
      const lx = (i - n / 2 + 0.5) * cell;
      const px = W / 2 + lx * cos - ly * sin;
      const py = H / 2 + lx * sin + ly * cos;
      if (px < -cell || py < -cell || px > W + cell || py > H + cell) continue;

      const s = at(px, py);
      if (!s) continue;

      if (!halftone) {
        g.fillStyle = `rgb(${mix(s[0], ink[0], tintAmount)}, ${mix(s[1], ink[1], tintAmount)}, ${mix(s[2], ink[2], tintAmount)})`;
        g.fillRect(lx - block / 2 - bleed, ly - block / 2 - bleed, block + bleed * 2, block + bleed * 2);
        continue;
      }

      // 어두운 곳의 점이 커진다. 제곱근을 쓰면 점 면적이 어두움에 비례한다.
      const lum = (s[0] * 0.299 + s[1] * 0.587 + s[2] * 0.114) / 255;
      const r = cell * 0.72 * Math.sqrt(clamp(1 - lum, 0, 1)) * scale;
      if (r < 0.2) continue;

      dots.moveTo(lx + r, ly);
      dots.arc(lx, ly, r, 0, Math.PI * 2);
    }
  }

  if (dots) {
    g.fillStyle = o.color;
    g.fill(dots);
  }

  if (buffered) {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(buf, 0, 0);          // 불투명도는 c 에 이미 걸려 있다
  }
}

/* 사진을 캔버스에 cover 로 올린 모습 그대로 축소해 두고,
   캔버스 좌표를 넣으면 그 자리 색(밝기·대비 적용)을 돌려주는 함수를 만든다.
   사진이 캔버스를 덮지 않는 자리(확대를 1 아래로 줄인 경우)는 null 이다. */
/* 배경 사진이 캔버스를 덮는 배율. 1 보다 작게는 못 줄인다. */
const coverZoom = (img, W, H, o) =>
  Math.max(W / img.width, H / img.height) * Math.max(1, o.zoom);

/* 배경 사진은 늘 캔버스를 꽉 채우고 있어야 한다.
   덮고 있는 범위 밖으로는 밀리지 않게 잡아 둔다(사진 칸의 clampPan 과 같은 규칙). */
export function clampBgPan(W, H) {
  const { kind, img } = state.bgPattern;
  if (!img?.width || !['blur', 'pixel', 'halftone'].includes(kind)) return;
  const o = bgOpts();
  const z = coverZoom(img, W, H, o);
  const maxX = Math.max(0, (img.width * z - W) / 2);
  const maxY = Math.max(0, (img.height * z - H) / 2);
  o.x = Math.min(maxX, Math.max(-maxX, o.x));
  o.y = Math.min(maxY, Math.max(-maxY, o.y));
}

function sampler(img, W, H, o, cell) {
  if (!img.width || !img.height) return null;

  // 망점 하나에 서너 픽셀씩 돌아가도록 해상도를 잡는다.
  const want = clamp(Math.ceil(Math.max(W, H) / cell) * 3, 64, 1200);
  const k = want / Math.max(W, H);
  const sw = Math.max(1, Math.round(W * k));
  const sh = Math.max(1, Math.round(H * k));

  samp.width = sw;
  samp.height = sh;
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(0, 0, sw, sh);

  const z = coverZoom(img, W, H, o);
  const iw = img.width * z;
  const ih = img.height * z;
  sctx.drawImage(
    img,
    ((W - iw) / 2 + o.x) * k, ((H - ih) / 2 + o.y) * k,
    iw * k, ih * k,
  );

  const data = sctx.getImageData(0, 0, sw, sh).data;
  const bright = clamp(o.brightness, -1, 1) * 255;
  const ct = 1 + clamp(o.contrast, -1, 1);
  const out = [0, 0, 0, 0];

  return (x, y) => {
    const ix = clamp(Math.round(x * k - 0.5), 0, sw - 1);
    const iy = clamp(Math.round(y * k - 0.5), 0, sh - 1);
    const o = (iy * sw + ix) * 4;
    if (data[o + 3] < 8) return null;
    for (let i = 0; i < 3; i++) out[i] = clamp((data[o + i] - 128) * ct + 128 + bright, 0, 255);
    out[3] = data[o + 3];
    return out;
  };
}
