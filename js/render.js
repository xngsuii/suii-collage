/* 캔버스 그리기. 작품용 캔버스(#canvas)와 선택 표시용 오버레이(#overlay)를 나눠 그린다. */

import { state, selectedLayer, MAX_VIEW, MIN_VIEW } from 'app/state.js';
import { computeLayout, coverBox, layerCorners, rectCorners, toCanvas } from 'app/geometry.js';
import { filtered, applyCanvasEffect } from 'app/effects.js';
import { drawBackground } from 'app/pattern.js';

const art = document.getElementById('canvas');
const actx = art.getContext('2d');
const overlay = document.getElementById('overlay');
const octx = overlay.getContext('2d');
const box = document.getElementById('canvasBox');

/* 선택 표시 색. CSS 의 --accent 와 같은 값을 쓴다. */
const ACCENT = '#1f6b70';

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
  // 배경을 끄면 아무것도 깔지 않아 캔버스가 투명하게 남는다(PNG·WEBP 로만 살아남는다).
  if (state.bgOn) {
    actx.fillStyle = state.bg;
    actx.fillRect(0, 0, W, H);
    drawBackground(actx, W, H);
  }

  // 자유 배치는 칸이 겹칠 수 있다. 외곽선을 마지막에 몰아 그리면 아래 사진의 테가
  // 위 사진 위로 올라오므로, 그때는 사진마다 바로 둘러 쌓인 순서를 지킨다.
  const free = state.mode === 'free';
  const outlined = state.outline.mode === 'fill' && state.outline.width > 0;

  rects.forEach((rect, i) => {
    const photo = state.photos[i];
    if (!photo) {
      if (!free) drawPlaceholder(rect);     // 자유 배치에는 빈 칸이라는 것이 없다
      return;
    }
    drawPhoto(photo, rect);
    if (free && outlined) drawOutline(rect);
  });

  if (!free && outlined) for (const rect of rects) drawOutline(rect);

  for (const layer of state.layers) drawLayer(layer);

  // 전체 모드일 때만 마지막에 덧입힌다. 개별 효과와 겹쳐 걸리지는 않는다.
  applyCanvasEffect(actx, state.fxMode === 'all' ? state.canvasFx : null);

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
  // 자유 배치의 사진 틀도 같은 비율로 따라간다.
  for (const p of state.photos) {
    if (!p?.free) continue;
    p.free.cx *= sx;
    p.free.cy *= sy;
    p.free.w *= sx;
    p.free.h *= sy;
  }
}

/* 보기 창(.stage-inner)의 크기는 그대로 두고, 그 안에서 캔버스만 확대·이동한다.
   박스의 실제 픽셀 크기를 바꾸므로 오버레이 좌표 계산이 그대로 맞아떨어진다.
   view.x / view.y 는 보기 창 왼쪽 위를 기준으로 한 박스의 위치다. */
const VIEW_PAD = 28;

/* 지금 화면에 적용 중인 배율과, 창에 딱 맞출 때의 배율.
   둘 다 '캔버스 1px 이 화면 몇 px 인지'라서 그대로 백분율로 보여 줄 수 있다. */
let lastRatio = 1;
let lastFit = 1;
export const viewRatio = () => lastRatio;
export const fitRatio = () => lastFit;

function fitBox(W, H) {
  const stage = box.parentElement;
  const vw = stage.clientWidth;
  const vh = stage.clientHeight;
  if (vw <= 0 || vh <= 0) return;

  lastFit = Math.min((vw - VIEW_PAD * 2) / W, (vh - VIEW_PAD * 2) / H);
  lastRatio = state.view.fit ? lastFit : state.view.scale;

  const w = W * lastRatio;
  const h = H * lastRatio;

  box.style.width = `${Math.round(w)}px`;
  box.style.height = `${Math.round(h)}px`;
  // 예전 스타일시트가 캐시에 남아 있어도 한쪽 변만 묶여 눌리지 않게 못을 박는다.
  box.style.maxWidth = 'none';
  box.style.maxHeight = 'none';

  clampView(w, h, vw, vh);
  box.style.transform = `translate(${Math.round(state.view.x)}px, ${Math.round(state.view.y)}px)`;
}

/* 보기 창보다 작으면 가운데에, 크면 가장자리가 안쪽으로 들어오지 않게 잡아둔다. */
function clampView(w, h, vw, vh) {
  const v = state.view;
  v.x = w <= vw ? (vw - w) / 2 : Math.min(0, Math.max(vw - w, v.x));
  v.y = h <= vh ? (vh - h) / 2 : Math.min(0, Math.max(vh - h, v.y));
}

/* 화면 좌표 (clientX, clientY) 아래 있는 지점을 붙잡은 채 확대한다.
   상태만 바꾸므로 호출한 쪽에서 render() 를 부른다. */
export function zoomViewAt(factor, clientX, clientY) {
  const stage = box.parentElement;
  const r = stage.getBoundingClientRect();
  const fx = clientX - r.left;
  const fy = clientY - r.top;

  const cur = lastRatio;
  const next = Math.min(MAX_VIEW, Math.max(MIN_VIEW, cur * factor));
  if (next === cur) return;

  // 초점에서 박스 왼쪽 위까지의 거리는 배율에 비례해 늘어난다.
  const v = state.view;
  v.x = fx - (fx - v.x) * (next / cur);
  v.y = fy - (fy - v.y) * (next / cur);
  v.fit = false;
  v.scale = next;
}

/* 배율 버튼이 쓰는 입구. 보기 창 한가운데를 붙잡은 채 그 배율로 맞춘다. */
export function setViewScale(ratio) {
  const stage = box.parentElement;
  const r = stage.getBoundingClientRect();
  zoomViewAt(ratio / lastRatio, r.left + r.width / 2, r.top + r.height / 2);
}

export function fitView() {
  state.view.fit = true;   // 위치는 clampView 가 가운데로 되돌린다
}

export function panView(dx, dy) {
  state.view.x += dx;
  state.view.y += dy;
}

/* 개별 효과는 'each' 모드에서만 산다. null 을 넘기면 원본이 그대로 돌아온다. */
const ownFx = (o) => (state.fxMode === 'each' ? o.fx : null);

/* ── 사진 칸 ─────────────────────────────── */

/* 칸 가운데를 원점으로 두고 회전 → 뒤집기 순으로 좌표계를 세운 뒤 사진을 채운다.
   panX/panY 는 화면 기준으로 저장돼 있으므로, 세운 좌표계 쪽으로 옮겨 줘야
   돌리거나 뒤집어도 끄는 손 방향과 사진이 움직이는 방향이 어긋나지 않는다. */
function drawPhoto(photo, rect) {
  const q = (photo.rot90 || 0) & 3;
  const swap = (q & 1) === 1;
  const fh = photo.flipH ? -1 : 1;
  const fv = photo.flipV ? -1 : 1;

  // 화면 기준 이동량을 회전한 만큼 되돌리고(−90°×q), 뒤집힌 축은 부호를 바꾼다.
  const rot = [
    [photo.panX, photo.panY],
    [photo.panY, -photo.panX],
    [-photo.panX, -photo.panY],
    [-photo.panY, photo.panX],
  ][q];
  const panX = fh * rot[0];
  const panY = fv * rot[1];

  // 돌아갔으면 칸의 가로세로를 바꾼 채로 채운다. 중심이 원점인 칸으로 계산한다.
  const cw = swap ? rect.h : rect.w;
  const ch = swap ? rect.w : rect.h;
  const b = coverBox(photo.img, { x: -cw / 2, y: -ch / 2, w: cw, h: ch }, photo.zoom, panX, panY);

  actx.save();
  actx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
  // 자유 배치에서 기울인 틀. 자르는 영역도 같이 기울어야 한다.
  if (rect.rot) actx.rotate(rect.rot);
  actx.beginPath();
  actx.rect(-rect.w / 2, -rect.h / 2, rect.w, rect.h);
  actx.clip();

  if (q) actx.rotate((q * Math.PI) / 2);
  if (fh < 0 || fv < 0) actx.scale(fh, fv);

  // 효과가 없으면 원본 이미지가 그대로 돌아온다.
  actx.drawImage(filtered(photo, photo.img, ownFx(photo)), b.x, b.y, b.w, b.h);
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

/* 사진 바깥에 둘러지는 테.
   선을 칸 경계에서 바깥쪽으로만 나가게 그어야(중심을 경계 밖 width/2 에 두어야)
   사진을 깎아먹지 않는다. 맞붙은 두 칸은 각자 width 씩 내보내 사이가 꼭 채워진다. */
function drawOutline(r) {
  const w = state.outline.width;
  actx.save();
  actx.strokeStyle = state.outline.color;
  actx.lineWidth = w;
  actx.lineJoin = 'miter';
  actx.translate(r.x + r.w / 2, r.y + r.h / 2);
  if (r.rot) actx.rotate(r.rot);
  actx.strokeRect(-(r.w + w) / 2, -(r.h + w) / 2, r.w + w, r.h + w);
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
  // 아웃라인은 원본 알파를 따라야 하므로 위에서 원본을 쓰고, 몸통만 효과를 먹인다.
  actx.drawImage(filtered(layer, layer.img, ownFx(layer)), x, y, w, h);
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

/* 그림자도 같은 이유로 번짐 반경을 캔버스 기준으로 잡는다.
   angle 은 빛이 있는 쪽이다. 0 이 위(12시)이고 시계 방향으로 돈다.
   그림자는 그 반대편으로 떨어진다. */
function applyShadow(c, sh) {
  const unit = Math.min(art.width, art.height);
  const blur = Math.max(2, unit * sh.blur);
  const dist = blur * 0.35;
  const a = ((sh.angle || 0) * Math.PI) / 180;

  c.shadowColor = `rgba(0, 0, 0, ${sh.opacity})`;
  c.shadowBlur = blur;
  c.shadowOffsetX = -Math.sin(a) * dist;
  c.shadowOffsetY = Math.cos(a) * dist;
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

/* 도형 윤곽. 모두 가운데를 원점으로 두고 w × h 상자 안에 들어간다.
   하트만 조절점이 상자를 살짝 넘겨 잡혀 있다(그래야 상자를 꽉 채운다). */
function shapePath(c, layer, w, h) {
  const hw = w / 2;
  const hh = h / 2;
  c.beginPath();

  switch (layer.shape) {
    case 'circle':
      c.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
      break;

    case 'ring': {
      // 바깥은 시계 방향, 안쪽은 반대 방향으로 그려 가운데가 뚫린다.
      const t = Math.min(0.95, Math.max(0.02, layer.inner ?? 0.55));
      c.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2, false);
      c.ellipse(0, 0, hw * t, hh * t, 0, 0, Math.PI * 2, true);
      break;
    }

    case 'triangle':
      c.moveTo(0, -hh);
      c.lineTo(hw, hh);
      c.lineTo(-hw, hh);
      break;

    case 'star': {
      const n = Math.max(3, Math.min(12, Math.round(layer.points ?? 5)));
      const ir = Math.min(0.9, Math.max(0.1, layer.spike ?? 0.45));
      for (let i = 0; i < n * 2; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / n;
        const k = i % 2 ? ir : 1;
        const x = Math.cos(a) * hw * k;
        const y = Math.sin(a) * hh * k;
        if (i) c.lineTo(x, y);
        else c.moveTo(x, y);
      }
      break;
    }

    case 'sparkle': {
      // 네 갈래 반짝임. 꼭짓점 사이를 가운데로 당겨 허리가 가늘어진다.
      const waist = 0.18;
      c.moveTo(0, -hh);
      for (let i = 0; i < 4; i++) {
        const a0 = -Math.PI / 2 + (i * Math.PI) / 2;
        const a1 = a0 + Math.PI / 2;
        const am = a0 + Math.PI / 4;
        c.quadraticCurveTo(
          Math.cos(am) * hw * waist, Math.sin(am) * hh * waist,
          Math.cos(a1) * hw, Math.sin(a1) * hh,
        );
      }
      break;
    }

    case 'heart':
      c.moveTo(0, hh * 0.98);
      c.bezierCurveTo(-hw * 1.32, hh * 0.08, -hw * 0.72, -hh * 1.18, 0, -hh * 0.42);
      c.bezierCurveTo(hw * 0.72, -hh * 1.18, hw * 1.32, hh * 0.08, 0, hh * 0.98);
      break;

    case 'arrow': {
      // 오른쪽을 가리킨다. 방향은 회전으로 맞춘다.
      const bw = hh * 0.42;        // 몸통 두께의 절반
      const head = hw * 0.7;       // 머리 길이
      c.moveTo(hw, 0);
      c.lineTo(hw - head, -hh);
      c.lineTo(hw - head, -bw);
      c.lineTo(-hw, -bw);
      c.lineTo(-hw, bw);
      c.lineTo(hw - head, bw);
      c.lineTo(hw - head, hh);
      break;
    }

    default: {
      const r = Math.min(w, h) * Math.min(0.5, layer.radius);
      c.roundRect(-hw, -hh, w, h, r);
    }
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

  // 고쳐 쓰는 중이면 화면 위 입력창이 글자를 보여준다. 캔버스에 겹쳐 그리지 않는다.
  if (state.editingId === layer.id) { actx.restore(); return; }

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
    const pts = rectCorners(r).map((p) => ({ x: p.x * k, y: p.y * k }));
    octx.strokeStyle = ACCENT;

    // 자유 배치에서는 사진도 요소처럼 끌고 돌리므로 같은 핸들을 붙인다.
    if (state.mode === 'free' && state.photos[sel.index]) {
      octx.lineWidth = 1.5;
      outlinePoly(pts);
      drawHandles(pts, rectRotateHandlePoint(r, k));
      return;
    }

    octx.lineWidth = 2;
    octx.setLineDash([5, 4]);
    outlinePoly(pts);
    octx.setLineDash([]);
    return;
  }

  const layer = selectedLayer();
  if (!layer) return;

  const pts = layerCorners(layer).map((p) => ({ x: p.x * k, y: p.y * k }));
  octx.strokeStyle = ACCENT;
  octx.lineWidth = 1.5;
  outlinePoly(pts);
  drawHandles(pts, rotateHandlePoint(layer, k));
}

function outlinePoly(pts) {
  octx.beginPath();
  octx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) octx.lineTo(pts[i].x, pts[i].y);
  octx.closePath();
  octx.stroke();
}

/* 네 귀퉁이 점과, 위쪽 변에서 뻗어 나온 회전 손잡이. */
function drawHandles(pts, rot) {
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
  octx.strokeStyle = ACCENT;
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

/* 사진 칸(자유 배치)의 회전 핸들 */
export function rectRotateHandlePoint(r, k) {
  const a = r.rot || 0;
  const ly = -r.h / 2 - ROTATE_OFFSET / k;
  const x = r.x + r.w / 2 - ly * Math.sin(a);
  const y = r.y + r.h / 2 + ly * Math.cos(a);
  return { x: x * k, y: y * k };
}

export { art, overlay, box };
