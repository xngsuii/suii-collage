/* 캔버스 조작(선택·이동·확대·회전)과 앱 초기화. */

import { state, makeText, makeShape, makeSticker, selectedLayer, removeLayer, duplicateLayer } from './state.js';
import { render, getLayout, art, overlay, HANDLE, rotateHandlePoint, measureText } from './render.js';
import { hitCell, pickLayer, clampPan, layerCorners, snapPoint } from './geometry.js';
import { pickImages } from './files.js';
import {
  initLeftPanel, initRightPanel, initStageBar, initLayerReorder, initPanelTabs,
  update, refreshProps, syncFromCanvas, syncViewReset, paintAllRanges,
} from './ui.js';

/* ── 좌표 변환 ───────────────────────────── */

function pointer(e) {
  const r = overlay.getBoundingClientRect();
  const sx = e.clientX - r.left;          // 화면(CSS px) 좌표
  const sy = e.clientY - r.top;
  const k = r.width / art.width;          // 캔버스 → 화면 배율
  return { sx, sy, x: sx / k, y: sy / k, k };
}

/* ── 미리보기 확대(두 손가락 · Ctrl+휠) ──── */

const MAX_VIEW = 6;
const pointers = new Map();
let pinch = null;

const clampView = (v) => Math.min(MAX_VIEW, Math.max(1, v));

function startPinch() {
  const [a, b] = [...pointers.values()];
  pinch = {
    dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    scale: state.view.scale,
    pan: { x: state.view.x, y: state.view.y },
  };
}

function movePinch() {
  const [a, b] = [...pointers.values()];
  const dist = Math.hypot(a.x - b.x, a.y - b.y);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  state.view.scale = clampView(pinch.scale * (dist / pinch.dist));
  state.view.x = pinch.pan.x + (mid.x - pinch.mid.x);
  state.view.y = pinch.pan.y + (mid.y - pinch.mid.y);
  if (state.view.scale === 1) { state.view.x = 0; state.view.y = 0; }
  render();
  syncViewReset();
}

/* ── 드래그 상태 ─────────────────────────── */

let drag = null;

overlay.addEventListener('pointerdown', async (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size >= 2) {
    drag = null;                 // 두 손가락이면 요소 조작 대신 화면을 확대한다
    startPinch();
    return;
  }

  const p = pointer(e);
  const layer = selectedLayer();

  // 1) 선택 중인 레이어의 핸들부터 확인
  if (layer) {
    const handle = hitHandle(layer, p);
    if (handle === 'rotate') {
      drag = { mode: 'rotate', layer, startAngle: angleTo(layer, p) - layer.rot };
      overlay.setPointerCapture(e.pointerId);
      return;
    }
    if (handle === 'corner') {
      drag = {
        mode: 'scale', layer,
        startDist: Math.max(4, distTo(layer, p)),
        base: layer.type === 'text' ? layer.size : { w: layer.w, h: layer.h },
      };
      overlay.setPointerCapture(e.pointerId);
      return;
    }
  }

  // 2) 레이어 선택 / 이동
  const hit = pickLayer(p.x, p.y);
  if (hit) {
    state.selection = { kind: 'layer', id: hit.id };
    drag = { mode: 'move', layer: hit, dx: hit.cx - p.x, dy: hit.cy - p.y };
    overlay.setPointerCapture(e.pointerId);
    update();
    return;
  }

  // 3) 사진 칸 선택 / 이동
  const idx = hitCell(getLayout().rects, p.x, p.y);
  if (idx < 0) { state.selection = null; update(); return; }

  state.selection = { kind: 'cell', index: idx };
  const photo = state.photos[idx];
  if (!photo) { update(); await fillCell(idx); return; }

  drag = { mode: 'pan', index: idx, startX: p.x, startY: p.y, panX: photo.panX, panY: photo.panY };
  overlay.setPointerCapture(e.pointerId);
  update();
});

overlay.addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size >= 2) return movePinch();

  if (!drag) return;
  const p = pointer(e);

  if (drag.mode === 'move') {
    const { W, H } = getLayout();
    const snapped = snapPoint(p.x + drag.dx, p.y + drag.dy, W, H);
    drag.layer.cx = snapped.x;
    drag.layer.cy = snapped.y;
  } else if (drag.mode === 'rotate') {
    drag.layer.rot = normalizeAngle(angleTo(drag.layer, p) - drag.startAngle);
  } else if (drag.mode === 'scale') {
    const f = Math.max(0.05, distTo(drag.layer, p) / drag.startDist);
    if (drag.layer.type === 'text') {
      drag.layer.size = Math.max(8, drag.base * f);
    } else {
      drag.layer.w = Math.max(12, drag.base.w * f);
      drag.layer.h = Math.max(12, drag.base.h * f);
      drag.layer._w = drag.layer.w;
      drag.layer._h = drag.layer.h;
    }
  } else if (drag.mode === 'pan') {
    const photo = state.photos[drag.index];
    if (!photo) return;
    photo.panX = drag.panX + (p.x - drag.startX);
    photo.panY = drag.panY + (p.y - drag.startY);
    clampPan(photo, getLayout().rects[drag.index]);
  }

  render();
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (!drag) return;
  drag = null;
  syncFromCanvas();
}

overlay.addEventListener('pointerup', endPointer);
overlay.addEventListener('pointercancel', endPointer);

/* 휠: 레이어 위면 크기, 사진 칸 위면 확대 */
overlay.addEventListener('wheel', (e) => {
  // Ctrl(맥은 Cmd)과 함께면 요소가 아니라 보이는 화면을 확대한다.
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    state.view.scale = clampView(state.view.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
    if (state.view.scale === 1) { state.view.x = 0; state.view.y = 0; }
    render();
    syncViewReset();
    return;
  }

  const p = pointer(e);
  const step = e.deltaY < 0 ? 1.06 : 1 / 1.06;

  const hit = pickLayer(p.x, p.y);
  if (hit) {
    e.preventDefault();
    state.selection = { kind: 'layer', id: hit.id };
    if (hit.type === 'text') hit.size = Math.max(8, Math.min(600, hit.size * step));
    else {
      hit.w = Math.max(12, hit.w * step);
      hit.h = Math.max(12, hit.h * step);
      hit._w = hit.w;
      hit._h = hit.h;
    }
    update();
    return;
  }

  const idx = hitCell(getLayout().rects, p.x, p.y);
  const photo = idx >= 0 ? state.photos[idx] : null;
  if (!photo) return;
  e.preventDefault();
  state.selection = { kind: 'cell', index: idx };
  photo.zoom = Math.min(4, Math.max(1, photo.zoom * step));
  clampPan(photo, getLayout().rects[idx]);
  update();
}, { passive: false });

/* 키보드 */
window.addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  const layer = selectedLayer();

  if ((e.key === 'Delete' || e.key === 'Backspace') && layer) {
    e.preventDefault();
    removeLayer(layer.id);
    update();
    return;
  }
  if (e.key === 'Escape') { state.selection = null; update(); return; }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && layer) {
    e.preventDefault();
    const copy = duplicateLayer(layer.id);
    if (copy) state.selection = { kind: 'layer', id: copy.id };
    update();
    return;
  }

  const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (nudge && layer) {
    e.preventDefault();
    const d = e.shiftKey ? 20 : 4;
    layer.cx += nudge[0] * d;
    layer.cy += nudge[1] * d;
    render();
  }
});

/* ── 핸들 판정 ───────────────────────────── */

function hitHandle(layer, p) {
  const rot = rotateHandlePoint(layer, p.k);
  if (Math.hypot(rot.x - p.sx, rot.y - p.sy) <= HANDLE) return 'rotate';

  const corners = layerCorners(layer);
  for (const c of corners) {
    if (Math.hypot(c.x * p.k - p.sx, c.y * p.k - p.sy) <= HANDLE) return 'corner';
  }
  return null;
}

const distTo = (layer, p) => Math.hypot(p.x - layer.cx, p.y - layer.cy);
const angleTo = (layer, p) => Math.atan2(p.y - layer.cy, p.x - layer.cx) + Math.PI / 2;

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/* ── 동작 ────────────────────────────────── */

async function addPhoto() {
  const imgs = await pickImages(true);
  if (!imgs.length) return;
  for (const img of imgs) state.photos.push({ img, panX: 0, panY: 0, zoom: 1 });
  update();
}

async function fillCell(index) {
  const [img] = await pickImages(false);
  if (!img) return;
  while (state.photos.length < index) state.photos.push(null);
  state.photos[index] = { img, panX: 0, panY: 0, zoom: 1 };
  state.selection = { kind: 'cell', index };
  refreshProps(true);
  update();
}

async function addSticker() {
  const imgs = await pickImages(true);
  if (!imgs.length) return;
  const { W, H } = getLayout();
  let last = null;
  imgs.forEach((img, i) => {
    last = makeSticker(img, W / 2 + i * 30, H / 2 + i * 30, Math.min(W, H) * 0.4);
    state.layers.push(last);
  });
  state.selection = { kind: 'layer', id: last.id };
  update();
}

function addText() {
  const { W, H } = getLayout();
  const layer = makeText(W / 2, H / 2, Math.round(Math.min(W, H) * 0.07));
  measureText(layer);
  state.layers.push(layer);
  state.selection = { kind: 'layer', id: layer.id };
  update();
}

function addShape(shape) {
  const { W, H } = getLayout();
  const layer = makeShape(shape, W / 2, H / 2, Math.min(W, H) * 0.3);
  state.layers.push(layer);
  state.selection = { kind: 'layer', id: layer.id };
  update();
}

function exportImage() {
  // 콜백이 늦게 실행되므로 포맷을 지금 붙잡아 둔다.
  const format = state.exportFormat;
  const quality = format === 'png' ? undefined : state.quality;
  const ext = format === 'jpeg' ? 'jpg' : format;

  // 선택 표시는 오버레이에만 있으므로 작품 캔버스를 그대로 내보낸다.
  art.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `collage-${stamp()}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, `image/${format}`, quality);
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function reset() {
  state.photos = [];
  state.layers = [];
  state.selection = null;
  update();
}

/* ── 초기화 ──────────────────────────────── */

const actions = { addPhoto, addSticker, addText, addShape, fillCell, exportImage, reset };
initLeftPanel(actions);
initRightPanel(actions);
initStageBar();
initLayerReorder();
initPanelTabs();

// 패널 너비가 바뀌면 슬라이더 채움 경계도 다시 계산해야 한다.
window.addEventListener('resize', () => { render(); paintAllRanges(); });

if (document.fonts?.ready) document.fonts.ready.then(() => render());

paintAllRanges();
update();
