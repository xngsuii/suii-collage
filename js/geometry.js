/* 캔버스 크기와 사진 칸(rect) 계산, 레이어 히트 테스트. */

import { state, template, BASE_SIZE, MAX_SIZE, MAX_AREA } from 'app/state.js';

const EPS = 1e-6;

/* 캔버스 크기와 각 사진 칸의 픽셀 좌표를 계산한다. */
export function computeLayout() {
  const layout = state.mode === 'template' ? templateLayout() : autoLayout();
  return clampSize(layout);
}

function templateLayout() {
  const W = state.canvasW;
  const H = state.canvasH;

  const gap = state.gap;
  const m = state.margin ? gap : 0;
  const innerW = W - m * 2;
  const innerH = H - m * 2;

  const rects = template().cells.map(([x, y, w, h]) => {
    // 안쪽으로 맞닿는 변에만 gap 절반씩 물린다.
    const left   = x > EPS ? gap / 2 : 0;
    const right  = x + w < 1 - EPS ? gap / 2 : 0;
    const top    = y > EPS ? gap / 2 : 0;
    const bottom = y + h < 1 - EPS ? gap / 2 : 0;
    return {
      x: m + x * innerW + left,
      y: m + y * innerH + top,
      w: Math.max(1, w * innerW - left - right),
      h: Math.max(1, h * innerH - top - bottom),
    };
  });

  return { W, H, rects };
}

/* 원본 비율을 지킨 채 빈틈 없이 이어 붙인다.
   맞닿는 변의 길이를 가장 큰 사진에 맞춰 통일하므로 여백이 생기지 않고,
   사진이 한 장이면 그 사진의 원본 크기가 그대로 남는다. */
function autoLayout() {
  const gap = state.gap;
  const m = state.margin ? gap : 0;
  const photos = state.photos.filter(Boolean);

  if (!photos.length) {
    const S = BASE_SIZE;
    return { W: S, H: S, rects: [{ x: m, y: m, w: S - m * 2, h: S - m * 2 }] };
  }

  const rects = [];

  if (state.direction === 'h') {
    const H0 = Math.max(...photos.map((p) => p.img.height));
    let x = m;
    for (const p of photos) {
      const w = p.img.width * (H0 / p.img.height);
      rects.push({ x, y: m, w, h: H0 });
      x += w + gap;
    }
    return { W: Math.round(x - gap + m), H: Math.round(H0 + m * 2), rects };
  }

  const W0 = Math.max(...photos.map((p) => p.img.width));
  let y = m;
  for (const p of photos) {
    const h = p.img.height * (W0 / p.img.width);
    rects.push({ x: m, y, w: W0, h });
    y += h + gap;
  }
  return { W: Math.round(W0 + m * 2), H: Math.round(y - gap + m), rects };
}

/* 브라우저가 감당하지 못할 만큼 큰 캔버스만 균일 축소한다. */
function clampSize({ W, H, rects }) {
  const s = Math.min(
    1,
    MAX_SIZE / Math.max(W, H),
    Math.sqrt(MAX_AREA / (W * H)),
  );
  if (s >= 1) return { W, H, rects };
  return {
    W: Math.round(W * s),
    H: Math.round(H * s),
    rects: rects.map((r) => ({ x: r.x * s, y: r.y * s, w: r.w * s, h: r.h * s })),
  };
}

/* ── 사진 cover 배치 ─────────────────────── */

export function coverBox(img, rect, zoom, panX, panY) {
  const scale = Math.max(rect.w / img.width, rect.h / img.height) * zoom;
  const w = img.width * scale;
  const h = img.height * scale;
  return {
    x: rect.x + (rect.w - w) / 2 + panX,
    y: rect.y + (rect.h - h) / 2 + panY,
    w, h,
  };
}

export function clampPan(photo, rect) {
  const scale = Math.max(rect.w / photo.img.width, rect.h / photo.img.height) * photo.zoom;
  const maxX = Math.max(0, (photo.img.width * scale - rect.w) / 2);
  const maxY = Math.max(0, (photo.img.height * scale - rect.h) / 2);
  photo.panX = Math.min(maxX, Math.max(-maxX, photo.panX));
  photo.panY = Math.min(maxY, Math.max(-maxY, photo.panY));
}

/* ── 레이어 좌표 변환 ────────────────────── */

/* 캔버스 좌표를 레이어 로컬 좌표(중심 기준, 회전 제거)로 옮긴다. */
export function toLocal(layer, px, py) {
  const dx = px - layer.cx;
  const dy = py - layer.cy;
  const c = Math.cos(-layer.rot);
  const s = Math.sin(-layer.rot);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

/* 레이어 로컬 좌표를 캔버스 좌표로 옮긴다. */
export function toCanvas(layer, lx, ly) {
  const c = Math.cos(layer.rot);
  const s = Math.sin(layer.rot);
  return { x: layer.cx + lx * c - ly * s, y: layer.cy + lx * s + ly * c };
}

export function layerCorners(layer) {
  const hw = layer._w / 2;
  const hh = layer._h / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
    .map(([x, y]) => toCanvas(layer, x, y));
}

export function hitLayer(layer, px, py) {
  const p = toLocal(layer, px, py);
  if (layer.type === 'shape' && layer.shape === 'circle') {
    const rx = layer._w / 2;
    const ry = layer._h / 2;
    return (p.x / rx) ** 2 + (p.y / ry) ** 2 <= 1;
  }
  return Math.abs(p.x) <= layer._w / 2 && Math.abs(p.y) <= layer._h / 2;
}

export function hitCell(rects, px, py) {
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return i;
  }
  return -1;
}

/* ── 그리드와 스냅 ───────────────────────── */

/* 그리드 선 위치. 0 과 W(H) 도 포함해 가장자리에도 붙는다. */
export function gridLines(size, count) {
  const lines = [];
  for (let i = 0; i <= count; i++) lines.push((size * i) / count);
  return lines;
}

/* 스냅이 켜져 있으면 가까운 그리드 선이나 캔버스 중앙으로 끌어당긴다. */
export function snapPoint(x, y, W, H) {
  if (!state.grid.snap) return { x, y };
  const tol = Math.max(6, Math.min(W, H) * 0.012);
  const xs = [...gridLines(W, state.grid.cols), W / 2];
  const ys = [...gridLines(H, state.grid.rows), H / 2];
  return { x: pull(x, xs, tol), y: pull(y, ys, tol) };
}

function pull(v, candidates, tol) {
  let best = v;
  let dist = tol;
  for (const c of candidates) {
    const d = Math.abs(v - c);
    if (d < dist) { dist = d; best = c; }
  }
  return best;
}

/* 위에 있는 레이어부터 검사한다. */
export function pickLayer(px, py) {
  for (let i = state.layers.length - 1; i >= 0; i--) {
    if (hitLayer(state.layers[i], px, py)) return state.layers[i];
  }
  return null;
}
