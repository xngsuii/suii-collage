/* 캔버스 크기와 사진 칸(rect) 계산, 레이어 히트 테스트. */

import { state, template, BASE_SIZE, MAX_SIZE, MAX_AREA } from 'app/state.js';

const EPS = 1e-6;

/* 90/270도로 돌린 사진은 가로세로가 뒤바뀐 것으로 친다.
   원본 그대로 모드에서 칸 모양이 회전을 따라가고, 칸을 정확히 채우게 된다. */
export function photoSize(p) {
  const swap = ((p.rot90 || 0) & 1) === 1;
  return { w: swap ? p.img.height : p.img.width, h: swap ? p.img.width : p.img.height };
}

/* 캔버스 크기와 각 사진 칸의 픽셀 좌표를 계산한다.
   칸은 { x, y, w, h, rot } 이고 rot 은 자유 배치에서만 0 이 아니다. */
export function computeLayout() {
  const layout = state.mode === 'template' ? templateLayout()
    : state.mode === 'free' ? freeLayout()
    : autoLayout();
  return clampSize(layout);
}

/* ── 자유 배치 ───────────────────────────── */

/* 사진마다 들고 있는 틀(photo.free)을 그대로 칸으로 쓴다. 겹쳐도 되고 돌려도 된다.
   캔버스 크기는 템플릿 모드와 같은 비율·픽셀 설정을 따른다. */
function freeLayout() {
  const W = state.canvasW;
  const H = state.canvasH;
  const rects = state.photos.map((p) => {
    if (!p) return { x: 0, y: 0, w: 1, h: 1, rot: 0 };
    const f = p.free || (p.free = defaultFree(p, W, H));
    return { x: f.cx - f.w / 2, y: f.cy - f.h / 2, w: f.w, h: f.h, rot: f.rot };
  });
  return { W, H, rects };
}

/* 아무 정보가 없을 때의 기본 틀 — 원본 비율을 지킨 채 캔버스 가운데에 놓는다. */
export function defaultFree(photo, W, H) {
  const { w, h } = photoSize(photo);
  const k = Math.min((W * 0.6) / w, (H * 0.6) / h);
  return { cx: W / 2, cy: H / 2, w: w * k, h: h * k, rot: 0 };
}

/* 자유 배치로 넘어올 때, 직전 모드에서 보고 있던 자리를 그대로 물려받는다.
   좌표는 '넘어오기 전 캔버스' 기준으로 적어 둔다. 캔버스 크기가 달라지는 몫은
   바로 뒤에 돌아가는 render 의 keepLayersInFrame 이 요소들과 함께 맞춰 준다. */
export function seedFreeBoxes(prev) {
  const W = prev?.W > 1 ? prev.W : state.canvasW;
  const H = prev?.H > 1 ? prev.H : state.canvasH;
  state.photos.forEach((p, i) => {
    if (!p || p.free) return;
    const r = prev?.rects?.[i];
    p.free = r
      ? { cx: r.x + r.w / 2, cy: r.y + r.h / 2, w: r.w, h: r.h, rot: 0 }
      : defaultFree(p, W, H);
  });
}

/* 사진이 맞붙는 자리는 테 두 장이 만나므로 외곽선 굵기의 두 배만큼 벌린다.
   캔버스 가장자리는 테 한 장이라 그 절반(= 굵기)만 비운다. */
const outlineGap = () => state.outline.width * 2;
const outlineMargin = () => (state.outline.outer ? state.outline.width : 0);

function templateLayout() {
  const W = state.canvasW;
  const H = state.canvasH;

  const gap = outlineGap();
  const m = outlineMargin();
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
      rot: 0,
    };
  });

  return { W, H, rects };
}

/* 원본 비율을 지킨 채 빈틈 없이 이어 붙인다.
   맞닿는 변의 길이를 가장 큰 사진에 맞춰 통일하므로 여백이 생기지 않고,
   사진이 한 장이면 그 사진의 원본 크기가 그대로 남는다. */
function autoLayout() {
  const gap = outlineGap();
  const m = outlineMargin();
  const photos = state.photos.filter(Boolean);

  if (!photos.length) {
    const S = BASE_SIZE;
    return { W: S, H: S, rects: [{ x: m, y: m, w: S - m * 2, h: S - m * 2, rot: 0 }] };
  }

  const rects = [];

  const sizes = photos.map(photoSize);

  if (state.direction === 'h') {
    const H0 = Math.max(...sizes.map((s) => s.h));
    let x = m;
    for (const s of sizes) {
      const w = s.w * (H0 / s.h);
      rects.push({ x, y: m, w, h: H0, rot: 0 });
      x += w + gap;
    }
    return { W: Math.round(x - gap + m), H: Math.round(H0 + m * 2), rects };
  }

  const W0 = Math.max(...sizes.map((s) => s.w));
  let y = m;
  for (const s of sizes) {
    const h = s.h * (W0 / s.w);
    rects.push({ x: m, y, w: W0, h, rot: 0 });
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
    rects: rects.map((r) => ({ x: r.x * s, y: r.y * s, w: r.w * s, h: r.h * s, rot: r.rot })),
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
  // 돌아간 상태에서는 칸의 가로세로를 바꿔 놓고 계산한다.
  const swap = ((photo.rot90 || 0) & 1) === 1;
  const cw = swap ? rect.h : rect.w;
  const ch = swap ? rect.w : rect.h;

  const scale = Math.max(cw / photo.img.width, ch / photo.img.height) * photo.zoom;
  let maxX = Math.max(0, (photo.img.width * scale - cw) / 2);
  let maxY = Math.max(0, (photo.img.height * scale - ch) / 2);
  // panX/panY 는 화면 기준이라, 로컬 축이 돌아간 만큼 한계도 서로 바뀐다.
  if (swap) [maxX, maxY] = [maxY, maxX];

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
  // 둥근 도형은 모양대로 받는다. 속 빈 원은 구멍 안쪽도 잡히게 둔다(집기 쉽도록).
  if (layer.type === 'shape' && (layer.shape === 'circle' || layer.shape === 'ring')) {
    const rx = layer._w / 2;
    const ry = layer._h / 2;
    return (p.x / rx) ** 2 + (p.y / ry) ** 2 <= 1;
  }
  return Math.abs(p.x) <= layer._w / 2 && Math.abs(p.y) <= layer._h / 2;
}

/* ── 사진 칸 좌표 ────────────────────────── */

/* 캔버스 좌표를 칸 로컬 좌표(중심 기준, 기울기 제거)로 옮긴다. */
export function rectLocal(r, px, py) {
  const dx = px - (r.x + r.w / 2);
  const dy = py - (r.y + r.h / 2);
  if (!r.rot) return { x: dx, y: dy };
  const c = Math.cos(-r.rot);
  const s = Math.sin(-r.rot);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

export function rectCorners(r) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const c = Math.cos(r.rot || 0);
  const s = Math.sin(r.rot || 0);
  const hw = r.w / 2;
  const hh = r.h / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
    .map(([x, y]) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c }));
}

/* 위에 그려진 칸부터 찾는다. 자유 배치에서는 칸이 겹칠 수 있다. */
export function hitCell(rects, px, py) {
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i];
    if (!r) continue;
    const p = rectLocal(r, px, py);
    if (Math.abs(p.x) <= r.w / 2 && Math.abs(p.y) <= r.h / 2) return i;
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
