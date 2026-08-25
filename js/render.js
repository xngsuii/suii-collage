/* 캔버스 그리기. 작품용 캔버스(#canvas)와 선택 표시용 오버레이(#overlay)를 나눠 그린다. */

import { state, selectedLayer } from './state.js';
import { computeLayout, coverBox, layerCorners, toCanvas } from './geometry.js';

const art = document.getElementById('canvas');
const actx = art.getContext('2d');
const overlay = document.getElementById('overlay');
const octx = overlay.getContext('2d');
const box = document.getElementById('canvasBox');

export const HANDLE = 9;        // 화면 기준 핸들 크기(px)
export const ROTATE_OFFSET = 26;

let lastLayout = { W: 1, H: 1, rects: [] };
export const getLayout = () => lastLayout;

/* ── 메인 ────────────────────────────────── */

export function render() {
  const layout = computeLayout();
  keepLayersInFrame(lastLayout, layout);
  lastLayout = layout;
  const { W, H, rects } = layout;

  if (art.width !== W || art.height !== H) {
    art.width = W;
    art.height = H;
  }
  fitBox(W, H);

  actx.setTransform(1, 0, 0, 1, 0, 0);
  actx.clearRect(0, 0, W, H);
  actx.fillStyle = state.bg;
  actx.fillRect(0, 0, W, H);

  rects.forEach((rect, i) => {
    const photo = state.photos[i];
    if (photo) drawPhoto(photo, rect);
    else drawPlaceholder(rect);
  });

  if (state.border.show) drawBorders(rects, W, H);

  for (const layer of state.layers) drawLayer(layer);

  drawOverlay();
}

/* 캔버스 크기가 바뀌면 얹어둔 요소도 같은 비율로 따라 움직이게 한다. */
function keepLayersInFrame(prev, next) {
  if (prev.W <= 1 || prev.H <= 1) return;
  if (prev.W === next.W && prev.H === next.H) return;
  const sx = next.W / prev.W;
  const sy = next.H / prev.H;
  for (const l of state.layers) {
    l.cx *= sx;
    l.cy *= sy;
  }
}

/* 캔버스 박스를 무대 안에 비율 맞춰 채운다. */
function fitBox(W, H) {
  const stage = box.parentElement;
  const availW = stage.clientWidth - 56;
  const availH = stage.clientHeight - 56;
  if (availW <= 0 || availH <= 0) return;
  const scale = Math.min(availW / W, availH / H);
  box.style.width = `${Math.round(W * scale)}px`;
  box.style.height = `${Math.round(H * scale)}px`;
}

/* ── 사진 칸 ─────────────────────────────── */

function drawPhoto(photo, rect) {
  const b = coverBox(photo.img, rect, photo.zoom, photo.panX, photo.panY);
  actx.save();
  actx.beginPath();
  actx.rect(rect.x, rect.y, rect.w, rect.h);
  actx.clip();
  actx.drawImage(photo.img, b.x, b.y, b.w, b.h);
  actx.restore();
}

/* 빈 칸은 옅은 면과 가느다란 + 하나로만 표시한다. */
function drawPlaceholder(rect) {
  const unit = Math.min(rect.w, rect.h);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const arm = unit * 0.06;

  actx.save();
  actx.fillStyle = '#f2f2f2';
  actx.fillRect(rect.x, rect.y, rect.w, rect.h);

  actx.strokeStyle = '#c6c6c6';
  actx.lineWidth = Math.max(1.5, unit * 0.005);
  actx.lineCap = 'round';
  actx.beginPath();
  actx.moveTo(cx - arm, cy);
  actx.lineTo(cx + arm, cy);
  actx.moveTo(cx, cy - arm);
  actx.lineTo(cx, cy + arm);
  actx.stroke();
  actx.restore();
}

function drawBorders(rects, W, H) {
  const { width, color, outer } = state.border;
  actx.save();
  actx.strokeStyle = color;
  actx.lineWidth = width;
  actx.lineJoin = 'miter';
  for (const r of rects) {
    actx.strokeRect(r.x + width / 2, r.y + width / 2, r.w - width, r.h - width);
  }
  if (outer) {
    actx.strokeRect(width / 2, width / 2, W - width, H - width);
  }
  actx.restore();
}

/* ── 레이어 ──────────────────────────────── */

function drawLayer(layer) {
  if (layer.type === 'text') return drawText(layer);
  if (layer.type === 'shape') return drawShape(layer);
  if (layer.type === 'sticker') return drawSticker(layer);
}

/* 스티커: 알파 실루엣을 원형으로 여러 번 찍어 외곽선을 만든다.
   배경이 투명한 PNG면 자연스럽게 피사체 윤곽을 따라간다. */
function drawSticker(layer) {
  actx.save();
  actx.translate(layer.cx, layer.cy);
  actx.rotate(layer.rot);

  const w = layer.w;
  const h = layer.h;
  const x = -w / 2;
  const y = -h / 2;

  if (layer.shadow.show) applyShadow(actx, layer.shadow);

  if (layer.outline.show && layer.outline.width > 0) {
    const sil = silhouette(layer.img, w, h, layer.outline.width, layer.outline.color);
    const steps = 32;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      actx.drawImage(
        sil.canvas,
        x - sil.pad + Math.cos(a) * layer.outline.width,
        y - sil.pad + Math.sin(a) * layer.outline.width,
      );
    }
  }

  actx.shadowColor = 'transparent';
  actx.drawImage(layer.img, x, y, w, h);
  actx.restore();
}

const silCanvas = document.createElement('canvas');

function silhouette(img, w, h, width, color) {
  const pad = Math.ceil(width) + 2;
  silCanvas.width = Math.ceil(w) + pad * 2;
  silCanvas.height = Math.ceil(h) + pad * 2;
  const c = silCanvas.getContext('2d');
  c.clearRect(0, 0, silCanvas.width, silCanvas.height);
  c.globalCompositeOperation = 'source-over';
  c.drawImage(img, pad, pad, w, h);
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = color;
  c.fillRect(0, 0, silCanvas.width, silCanvas.height);
  c.globalCompositeOperation = 'source-over';
  // 다음 호출에서 덮어쓰이므로 즉시 사용해야 한다.
  const copy = document.createElement('canvas');
  copy.width = silCanvas.width;
  copy.height = silCanvas.height;
  copy.getContext('2d').drawImage(silCanvas, 0, 0);
  return { canvas: copy, pad };
}

/* 글래스 테두리와 블러는 요소 크기가 아니라 캔버스 크기를 기준으로 잡는다.
   요소를 키워도 테두리가 같이 두꺼워지지 않게 하기 위한 것. */
const glassEdge = () => Math.max(1.5, Math.min(art.width, art.height) * 0.0022);
const glassBlur = () => Math.max(10, Math.min(art.width, art.height) * 0.022);

/* 그림자도 같은 이유로 번짐 반경을 캔버스 기준으로 잡는다. */
function applyShadow(c, sh) {
  const unit = Math.min(art.width, art.height);
  const blur = Math.max(2, unit * sh.blur);
  c.shadowColor = `rgba(0, 0, 0, ${sh.opacity})`;
  c.shadowBlur = blur;
  c.shadowOffsetY = blur * 0.35;
}

/* 글래스처럼 칠 자체가 반투명한 경우, 아래에 불투명한 판을 깔아 그림자만 흘린다. */
function castShadow(c, buildPath, sh) {
  c.save();
  applyShadow(c, sh);
  c.fillStyle = '#000';
  buildPath(c);
  c.fill();
  c.restore();
}

/* 도형 */
function drawShape(layer) {
  actx.save();
  actx.translate(layer.cx, layer.cy);
  actx.rotate(layer.rot);

  const w = layer.w;
  const h = layer.h;
  const build = (c) => shapePath(c, layer, w, h);

  if (layer.shadow.show) castShadow(actx, build, layer.shadow);

  if (layer.fill.mode === 'glass') {
    glassFill(actx, build, layer.fill.c1, layer.fill.opacity * 0.35, glassBlur());
    actx.save();
    build(actx);
    actx.strokeStyle = 'rgba(255,255,255,0.55)';
    actx.lineWidth = glassEdge();
    actx.stroke();
    actx.restore();
  } else {
    actx.globalAlpha = layer.fill.opacity;
    actx.fillStyle = layer.fill.mode === 'gradient'
      ? makeGradient(actx, layer, w, h)
      : layer.fill.c1;
    build(actx);
    actx.fill();
    actx.globalAlpha = 1;
  }

  if (layer.stroke.show && layer.stroke.width > 0) {
    build(actx);
    actx.strokeStyle = layer.stroke.color;
    actx.lineWidth = layer.stroke.width;
    actx.stroke();
  }

  actx.restore();
}

function shapePath(c, layer, w, h) {
  c.beginPath();
  if (layer.shape === 'circle') {
    c.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else {
    const r = Math.min(w, h) * Math.min(0.5, layer.radius);
    c.roundRect(-w / 2, -h / 2, w, h, r);
  }
  c.closePath();
}

function makeGradient(c, layer, w, h) {
  const a = (layer.fill.angle * Math.PI) / 180;
  const len = Math.abs(Math.cos(a)) * w + Math.abs(Math.sin(a)) * h;
  const dx = (Math.cos(a) * len) / 2;
  const dy = (Math.sin(a) * len) / 2;
  const g = c.createLinearGradient(-dx, -dy, dx, dy);
  g.addColorStop(0, rgba(layer.fill.c1, layer.fill.a1));
  g.addColorStop(1, rgba(layer.fill.c2, layer.fill.a2));
  return g;
}

/* #rgb / #rrggbb + 알파 → rgba() */
export function rgba(hex, alpha = 1) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16) || 0;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/* ── 텍스트 ──────────────────────────────── */

const fontRequests = new Set();

export function fontSpec(layer) {
  return `${layer.weight} ${Math.round(layer.size)}px "${layer.font}"`;
}

function ensureFont(layer) {
  const spec = fontSpec(layer);
  if (fontRequests.has(spec) || !document.fonts) return;
  fontRequests.add(spec);
  document.fonts.load(spec, layer.text || '가').then(() => render()).catch(() => {});
}

/* 텍스트 상자 크기를 재고 layer._w/_h 에 캐시한다. */
export function measureText(layer) {
  ensureFont(layer);
  actx.save();
  applyTextStyle(actx, layer);
  const lines = (layer.text || ' ').split('\n');
  const widths = lines.map((l) => actx.measureText(l || ' ').width);
  actx.restore();

  const lineH = layer.size * layer.lineHeight;
  const textW = Math.max(1, ...widths);
  const textH = lineH * lines.length;
  const padX = layer.bg.mode === 'none' ? 0 : layer.size * layer.bg.padX;
  const padY = layer.bg.mode === 'none' ? 0 : layer.size * layer.bg.padY;

  layer._w = textW + padX * 2;
  layer._h = textH + padY * 2;
  return { lines, widths, lineH, textW, textH, padX, padY };
}

function applyTextStyle(c, layer) {
  c.font = fontSpec(layer);
  c.textBaseline = 'middle';
  c.textAlign = layer.align;
  try { c.letterSpacing = `${layer.size * layer.letterSpacing}px`; } catch { /* 미지원 브라우저 */ }
}

function drawText(layer) {
  const m = measureText(layer);

  actx.save();
  actx.translate(layer.cx, layer.cy);
  actx.rotate(layer.rot);

  // 배경
  if (layer.bg.mode !== 'none') {
    const w = layer._w;
    const h = layer._h;
    const r = Math.min(w, h) * Math.min(0.5, layer.bg.radius);
    const build = (c) => { c.beginPath(); c.roundRect(-w / 2, -h / 2, w, h, r); c.closePath(); };

    if (layer.shadow.show) castShadow(actx, build, layer.shadow);

    if (layer.bg.mode === 'glass') {
      glassFill(actx, build, layer.bg.color, layer.bg.opacity * 0.4, glassBlur());
      actx.save();
      build(actx);
      actx.strokeStyle = 'rgba(255,255,255,0.5)';
      actx.lineWidth = glassEdge();
      actx.stroke();
      actx.restore();
    } else {
      actx.save();
      actx.globalAlpha = layer.bg.opacity;
      actx.fillStyle = layer.bg.color;
      build(actx);
      actx.fill();
      actx.restore();
    }
  }

  // 글자 — 이탤릭은 기울임 변환으로 처리한다(한글 폰트에 이탤릭 자형이 없으므로).
  actx.save();
  if (layer.italic) actx.transform(1, 0, -0.21, 1, 0, 0);
  applyTextStyle(actx, layer);

  const startY = -m.textH / 2 + m.lineH / 2;
  const anchorX = layer.align === 'left'  ? -m.textW / 2
                : layer.align === 'right' ?  m.textW / 2
                : 0;
  const at = (i) => startY + i * m.lineH;

  // 배경이 없을 때만 글자 자체에 그림자를 건다. 첫 획에만 걸어야 겹쳐 진해지지 않는다.
  const textShadow = layer.shadow.show && layer.bg.mode === 'none';

  if (layer.stroke.show && layer.stroke.width > 0) {
    actx.save();
    if (textShadow) applyShadow(actx, layer.shadow);
    actx.strokeStyle = layer.stroke.color;
    actx.lineWidth = layer.size * layer.stroke.width;
    actx.lineJoin = 'round';
    actx.miterLimit = 2;
    m.lines.forEach((line, i) => actx.strokeText(line, anchorX, at(i)));
    actx.restore();
  } else if (textShadow) {
    applyShadow(actx, layer.shadow);
  }

  actx.fillStyle = layer.color;
  m.lines.forEach((line, i) => actx.fillText(line, anchorX, at(i)));
  actx.restore();
  actx.restore();
}

/* ── 글래스모피즘 ────────────────────────── */

const snapCanvas = document.createElement('canvas');

function glassFill(c, buildPath, tint, alpha, blur) {
  const cv = c.canvas;
  snapCanvas.width = cv.width;
  snapCanvas.height = cv.height;
  const s = snapCanvas.getContext('2d');
  s.clearRect(0, 0, cv.width, cv.height);
  s.filter = `blur(${blur}px)`;
  s.drawImage(cv, 0, 0);
  s.filter = 'none';

  c.save();
  buildPath(c);
  c.clip();
  const t = c.getTransform();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.drawImage(snapCanvas, 0, 0);
  c.setTransform(t);
  c.globalAlpha = alpha;
  c.fillStyle = tint;
  buildPath(c);
  c.fill();
  c.globalAlpha = 1;
  c.restore();
}

/* ── 오버레이(선택 표시) ─────────────────── */

export function drawOverlay() {
  const dpr = window.devicePixelRatio || 1;
  const cssW = box.clientWidth;
  const cssH = box.clientHeight;
  if (!cssW || !cssH) return;

  if (overlay.width !== Math.round(cssW * dpr) || overlay.height !== Math.round(cssH * dpr)) {
    overlay.width = Math.round(cssW * dpr);
    overlay.height = Math.round(cssH * dpr);
  }
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  octx.clearRect(0, 0, cssW, cssH);

  const k = cssW / art.width;   // 캔버스 좌표 → 화면 좌표

  if (state.grid.show) drawGrid(cssW, cssH);

  const sel = state.selection;
  if (!sel) return;

  if (sel.kind === 'cell') {
    const r = lastLayout.rects[sel.index];
    if (!r) return;
    octx.strokeStyle = '#0038ff';
    octx.lineWidth = 2;
    octx.setLineDash([5, 4]);
    octx.strokeRect(r.x * k + 1, r.y * k + 1, r.w * k - 2, r.h * k - 2);
    octx.setLineDash([]);
    return;
  }

  const layer = selectedLayer();
  if (!layer) return;

  const pts = layerCorners(layer).map((p) => ({ x: p.x * k, y: p.y * k }));

  octx.strokeStyle = '#0038ff';
  octx.lineWidth = 1.5;
  octx.beginPath();
  octx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < 4; i++) octx.lineTo(pts[i].x, pts[i].y);
  octx.closePath();
  octx.stroke();

  // 회전 핸들
  const rot = rotateHandlePoint(layer, k);
  const topMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  octx.beginPath();
  octx.moveTo(topMid.x, topMid.y);
  octx.lineTo(rot.x, rot.y);
  octx.stroke();
  dot(rot.x, rot.y, true);

  for (const p of pts) dot(p.x, p.y, false);
}

/* 안내용 그리드. 오버레이에만 그리므로 내보낸 이미지에는 남지 않는다. */
function drawGrid(cssW, cssH) {
  const { cols, rows } = state.grid;
  const path = new Path2D();
  for (let i = 1; i < cols; i++) {
    const x = Math.round((cssW * i) / cols) + 0.5;
    path.moveTo(x, 0);
    path.lineTo(x, cssH);
  }
  for (let i = 1; i < rows; i++) {
    const y = Math.round((cssH * i) / rows) + 0.5;
    path.moveTo(0, y);
    path.lineTo(cssW, y);
  }

  octx.save();
  // 밝은 사진 위에서도 어두운 사진 위에서도 보이도록 흰 밑선을 깔고 회색 선을 얹는다.
  octx.lineWidth = 3;
  octx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  octx.stroke(path);
  octx.lineWidth = 1;
  octx.strokeStyle = 'rgba(70, 70, 70, 0.7)';
  octx.stroke(path);
  octx.restore();
}

function dot(x, y, round) {
  octx.fillStyle = '#ffffff';
  octx.strokeStyle = '#0038ff';
  octx.lineWidth = 1.5;
  octx.beginPath();
  if (round) octx.arc(x, y, HANDLE / 2, 0, Math.PI * 2);
  else octx.rect(x - HANDLE / 2, y - HANDLE / 2, HANDLE, HANDLE);
  octx.fill();
  octx.stroke();
}

/* 회전 핸들의 화면 좌표 */
export function rotateHandlePoint(layer, k) {
  const local = { x: 0, y: -layer._h / 2 - ROTATE_OFFSET / k };
  const p = toCanvas(layer, local.x, local.y);
  return { x: p.x * k, y: p.y * k };
}

export { art, overlay, box };
