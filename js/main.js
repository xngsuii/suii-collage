/* 캔버스 조작(선택·이동·확대·회전)과 앱 초기화. */

import {
  state, bgOpts, makePhoto, makeText, makeShape, makeSticker,
  selectedLayer, removeLayer, duplicateLayer,
} from 'app/state.js';
import {
  render, getLayout, art, overlay, box, HANDLE, rotateHandlePoint, rectRotateHandlePoint,
  measureText, zoomViewAt, panView,
} from 'app/render.js';
import {
  hitCell, pickLayer, clampPan, layerCorners, rectCorners, snapPoint, defaultFree,
} from 'app/geometry.js';
import { setFullRes } from 'app/effects.js';
import { pickImages } from 'app/files.js';
import {
  initLeftPanel, initRightPanel, initStageBar, initLayerReorder, initPanelTabs,
  update, refreshProps, syncFromCanvas, syncZoomBar, paintAllRanges,
} from 'app/ui.js';

/* ── 좌표 변환 ───────────────────────────── */

function pointer(e) {
  const r = overlay.getBoundingClientRect();
  const sx = e.clientX - r.left;          // 화면(CSS px) 좌표
  const sy = e.clientY - r.top;
  const k = r.width / art.width;          // 캔버스 → 화면 배율
  return { sx, sy, x: sx / k, y: sy / k, k };
}

/* ── 미리보기 확대(두 손가락 · Ctrl+휠) ────
   보기 창 크기는 그대로 두고 그 안의 캔버스만 확대·이동한다. */

const pointers = new Map();
let pinch = null;

/* 두 손가락의 거리와 중점. 직전 값과 비교해 조금씩 확대·이동한다. */
function grip() {
  const [a, b] = [...pointers.values()];
  return {
    dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
  };
}

function movePinch() {
  closeTextEditor();
  const now = grip();
  // 중점이 움직인 만큼 밀고, 벌어진 만큼 그 중점을 붙잡은 채 확대한다.
  panView(now.mid.x - pinch.mid.x, now.mid.y - pinch.mid.y);
  zoomViewAt(now.dist / pinch.dist, now.mid.x, now.mid.y);
  pinch = now;
  render();
  syncZoomBar();
}

/* ── 드래그 상태 ─────────────────────────── */

let drag = null;

/* 포인터가 캔버스 밖으로 나가도 계속 따라오게 한다. */
function capture(pointerId) {
  try { overlay.setPointerCapture(pointerId); } catch { /* 합성 이벤트 등 */ }
}

/* 빈 칸을 눌렀을 때 열 파일 선택창. iOS 사파리는 pointerdown 을 사용자 제스처로
   인정하지 않는 경우가 있어, 칸 번호만 적어 뒀다가 click 에서 연다. */
let pendingFill = -1;

overlay.addEventListener('pointerdown', (e) => {
  // 가운데 버튼은 화면 이동 전용. 디자인 도구들과 같은 감각.
  if (e.button === 1) {
    e.preventDefault();
    closeTextEditor();
    drag = { mode: 'panView', lastX: e.clientX, lastY: e.clientY };
    capture(e.pointerId);
    return;
  }

  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  pendingFill = -1;
  if (pointers.size >= 2) {
    drag = null;                 // 두 손가락이면 요소 조작 대신 화면을 확대한다
    pinch = grip();
    return;
  }

  const p = pointer(e);
  const layer = selectedLayer();

  // 1) 선택 중인 레이어의 핸들부터 확인
  if (layer) {
    const handle = hitHandle(layer, p);
    if (handle === 'rotate') {
      drag = { mode: 'rotate', layer, startAngle: angleTo(layer, p) - layer.rot };
      capture(e.pointerId);
      return;
    }
    if (handle === 'corner') {
      drag = {
        mode: 'scale', layer,
        startDist: Math.max(4, distTo(layer, p)),
        base: layer.type === 'text' ? layer.size : { w: layer.w, h: layer.h },
      };
      capture(e.pointerId);
      return;
    }
  }

  // 1-b) 자유 배치에서 고른 사진의 핸들. 사진도 요소처럼 끌고 돌린다.
  const freePhoto = freeSelection();
  if (freePhoto) {
    const r = getLayout().rects[state.selection.index];
    const handle = r && hitRectHandle(r, p);
    if (handle) {
      const f = freePhoto.free;
      drag = handle === 'rotate'
        ? { mode: 'freeRotate', photo: freePhoto, startAngle: angleToPoint(f, p) - f.rot }
        : { mode: 'freeScale', photo: freePhoto, startDist: Math.max(4, distToPoint(f, p)), base: { w: f.w, h: f.h } };
      capture(e.pointerId);
      return;
    }
  }

  // 2) 레이어 선택 / 이동
  const hit = pickLayer(p.x, p.y);
  if (hit) {
    state.selection = { kind: 'layer', id: hit.id };
    drag = { mode: 'move', layer: hit, dx: hit.cx - p.x, dy: hit.cy - p.y };
    capture(e.pointerId);
    update();
    return;
  }

  // 3) 사진 칸 선택 / 이동
  const idx = hitCell(getLayout().rects, p.x, p.y);
  if (idx < 0) {
    state.selection = null;
    // 아무것도 없는 바탕을 끌면 배경 무늬가 따라 움직인다.
    if (state.bgPattern.kind !== 'none') {
      drag = { mode: 'bgPan', lastX: e.clientX, lastY: e.clientY, k: p.k };
      capture(e.pointerId);
    }
    update();
    return;
  }

  state.selection = { kind: 'cell', index: idx };
  const photo = state.photos[idx];
  if (!photo) { pendingFill = idx; update(); return; }

  // 자유 배치에서는 끌면 사진이 움직인다. 틀 안에서 사진만 밀려면 Shift 를 누른다.
  if (state.mode === 'free' && !e.shiftKey) {
    const f = photo.free || (photo.free = defaultFree(photo, state.canvasW, state.canvasH));
    drag = { mode: 'freeMove', photo, dx: f.cx - p.x, dy: f.cy - p.y };
  } else {
    drag = { mode: 'pan', index: idx, startX: p.x, startY: p.y, panX: photo.panX, panY: photo.panY };
  }
  capture(e.pointerId);
  update();
});

/* 자유 배치에서 지금 고른 사진. 그 밖에는 null. */
function freeSelection() {
  if (state.mode !== 'free') return null;
  const sel = state.selection;
  if (sel?.kind !== 'cell') return null;
  const photo = state.photos[sel.index];
  return photo?.free ? photo : null;
}

/* 미리보기의 빈 칸(＋)을 탭하면 바로 사진을 고른다. */
let lastFillAt = 0;

overlay.addEventListener('click', () => {
  if (pendingFill < 0) return;
  const idx = pendingFill;
  pendingFill = -1;
  // 빠르게 두 번 누르면 파일 창이 두 번 열린다. 바로 뒤따르는 두 번째는 흘려보낸다.
  const now = Date.now();
  if (now - lastFillAt < 600) return;
  lastFillAt = now;
  fillCell(idx);
});

/* ── 미리보기에서 글자 고쳐 쓰기 ─────────── */

let editor = null;

function closeTextEditor() {
  if (!editor) return;
  const el = editor;
  editor = null;              // blur 로 다시 불려도 한 번만 정리되도록 먼저 비운다
  state.editingId = null;
  el.remove();
  render();
}

/* 글자를 두 번 누르면 그 자리에 입력창을 띄운다.
   그동안 캔버스에는 글자를 그리지 않으므로(state.editingId) 겹쳐 보이지 않는다. */
function openTextEditor(layer) {
  closeTextEditor();
  state.editingId = layer.id;

  const ta = document.createElement('textarea');
  ta.className = 'text-edit';
  ta.value = layer.text;
  ta.spellcheck = false;
  box.appendChild(ta);
  editor = ta;
  placeEditor(layer, ta);

  ta.addEventListener('input', () => {
    layer.text = ta.value;
    measureText(layer);
    placeEditor(layer, ta);
    update();
  });
  // Delete 나 방향키가 캔버스 조작으로 새지 않게 막는다.
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); ta.blur(); }
  });
  ta.addEventListener('blur', closeTextEditor);

  render();
  ta.focus();
  ta.select();
}

/* 입력창을 캔버스 위 같은 자리·같은 서체로 맞춘다. */
function placeEditor(layer, ta) {
  const k = box.clientWidth / art.width;
  const w = Math.max(40, layer._w * k) + 10;
  const h = Math.max(24, layer._h * k) + 10;
  Object.assign(ta.style, {
    width: `${w}px`,
    height: `${h}px`,
    left: `${layer.cx * k - w / 2}px`,
    top: `${layer.cy * k - h / 2}px`,
    // font 단축 속성은 line-height 를 되돌리므로 반드시 뒤에서 다시 정한다.
    font: `${layer.weight} ${layer.size * k}px "${layer.font}", sans-serif`,
    lineHeight: String(layer.lineHeight),
    letterSpacing: `${layer.size * layer.letterSpacing * k}px`,
    textAlign: layer.align,
    color: layer.color,
    // 캔버스 쪽 기울임(-0.21)과 같은 각도로 맞춘다.
    transform: `rotate(${layer.rot}rad)${layer.italic ? ' skewX(-11.86deg)' : ''}`,
  });
}

overlay.addEventListener('dblclick', (e) => {
  const p = pointer(e);

  const hit = pickLayer(p.x, p.y);
  if (hit) {
    if (hit.type !== 'text') return;
    e.preventDefault();
    drag = null;
    state.selection = { kind: 'layer', id: hit.id };
    update();
    openTextEditor(hit);
    return;
  }

  // 얹은 요소가 없으면 사진 칸이다. 두 번 누르면 바로 교체한다.
  // 빈 칸은 한 번만 눌러도 열리므로(pendingFill) 여기서는 채워진 칸만 받는다.
  const idx = hitCell(getLayout().rects, p.x, p.y);
  if (idx < 0 || !state.photos[idx]) return;
  e.preventDefault();
  drag = null;
  state.selection = { kind: 'cell', index: idx };
  update();
  fillCell(idx);
});

overlay.addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size >= 2) { pendingFill = -1; return movePinch(); }

  if (!drag) return;

  if (drag.mode === 'panView') {
    panView(e.clientX - drag.lastX, e.clientY - drag.lastY);
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    render();
    return;
  }

  if (drag.mode === 'bgPan') {
    // 화면에서 끈 거리를 캔버스 픽셀로 환산해 무늬를 그만큼 민다.
    // 위치는 무늬마다 따로 들고 있으므로 지금 고른 무늬 칸에 적는다.
    const o = bgOpts();
    o.x += (e.clientX - drag.lastX) / drag.k;
    o.y += (e.clientY - drag.lastY) / drag.k;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    render();
    return;
  }

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
  } else if (drag.mode === 'freeMove') {
    const f = drag.photo.free;
    const { W, H } = getLayout();
    const snapped = snapPoint(p.x + drag.dx, p.y + drag.dy, W, H);
    f.cx = snapped.x;
    f.cy = snapped.y;
  } else if (drag.mode === 'freeScale') {
    const f = drag.photo.free;
    const k = Math.max(0.05, distToPoint(f, p) / drag.startDist);
    f.w = Math.max(12, drag.base.w * k);
    f.h = Math.max(12, drag.base.h * k);
    clampPan(drag.photo, { x: 0, y: 0, w: f.w, h: f.h });
  } else if (drag.mode === 'freeRotate') {
    const f = drag.photo.free;
    f.rot = normalizeAngle(angleToPoint(f, p) - drag.startAngle);
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

/* 휠은 화면을 민다. 크기 조절은 Alt 를 눌러야 한다.
   같은 제스처가 상황에 따라 달라지면 헷갈리므로 역할을 갈라 뒀다.
   (확대해 놓고 화면을 옮기려 휠을 굴리면 사진이 확대되던 문제) */
overlay.addEventListener('wheel', (e) => {
  // Ctrl(맥은 Cmd)과 함께면 화면 배율. 브라우저가 가로채는 일이 있어 버튼도 따로 뒀다.
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    closeTextEditor();
    zoomViewAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY);
    render();
    syncZoomBar();
    return;
  }

  if (e.altKey) {
    e.preventDefault();
    return resizeUnderPointer(e);
  }

  // 그 밖에는 보이는 화면을 민다. Shift 를 누르면 좌우로.
  e.preventDefault();
  closeTextEditor();
  if (e.shiftKey) panView(-e.deltaY, 0);
  else panView(-e.deltaX, -e.deltaY);
  render();
}, { passive: false });

/* Alt+휠 — 포인터 아래 요소의 크기, 사진 칸이면 사진 확대 */
function resizeUnderPointer(e) {
  const p = pointer(e);
  const step = e.deltaY < 0 ? 1.06 : 1 / 1.06;

  const hit = pickLayer(p.x, p.y);
  if (hit) {
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
  state.selection = { kind: 'cell', index: idx };

  // 자유 배치에서는 칸 자체가 사진 크기다. 그쪽을 키우는 게 자연스럽다.
  if (state.mode === 'free' && photo.free) {
    photo.free.w = Math.max(12, photo.free.w * step);
    photo.free.h = Math.max(12, photo.free.h * step);
    clampPan(photo, { x: 0, y: 0, w: photo.free.w, h: photo.free.h });
    update();
    return;
  }

  photo.zoom = Math.min(4, Math.max(1, photo.zoom * step));
  clampPan(photo, getLayout().rects[idx]);
  update();
}

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
  if (!nudge) return;
  const d = e.shiftKey ? 20 : 4;
  if (layer) {
    e.preventDefault();
    layer.cx += nudge[0] * d;
    layer.cy += nudge[1] * d;
    render();
    return;
  }
  // 자유 배치에서는 고른 사진도 방향키로 조금씩 옮긴다.
  const free = freeSelection();
  if (free) {
    e.preventDefault();
    free.free.cx += nudge[0] * d;
    free.free.cy += nudge[1] * d;
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

/* 사진 칸(자유 배치)의 핸들. 요소와 같은 모양·같은 크기로 잡는다. */
function hitRectHandle(r, p) {
  const rot = rectRotateHandlePoint(r, p.k);
  if (Math.hypot(rot.x - p.sx, rot.y - p.sy) <= HANDLE) return 'rotate';
  for (const c of rectCorners(r)) {
    if (Math.hypot(c.x * p.k - p.sx, c.y * p.k - p.sy) <= HANDLE) return 'corner';
  }
  return null;
}

const distTo = (layer, p) => Math.hypot(p.x - layer.cx, p.y - layer.cy);
const angleTo = (layer, p) => Math.atan2(p.y - layer.cy, p.x - layer.cx) + Math.PI / 2;

// 중심이 cx/cy 인 아무 것(요소든 사진 틀이든)에 쓸 수 있는 같은 계산.
const distToPoint = distTo;
const angleToPoint = angleTo;

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/* ── 동작 ────────────────────────────────── */

async function addPhoto() {
  const imgs = await pickImages(true);
  if (!imgs.length) return;
  imgs.forEach((img, i) => {
    const photo = makePhoto(img);
    if (state.mode === 'free') placeFree(photo, i);
    state.photos.push(photo);
  });
  update();
}

/* 자유 배치에서 새 사진을 놓는 자리. 여러 장이면 조금씩 엇갈려 쌓인다. */
function placeFree(photo, i) {
  const W = state.canvasW;
  const H = state.canvasH;
  const f = defaultFree(photo, W, H);
  const step = Math.min(W, H) * 0.06;
  f.cx += ((i % 5) - 2) * step;
  f.cy += ((i % 5) - 2) * step;
  photo.free = f;
}

async function fillCell(index) {
  const [img] = await pickImages(false);
  if (!img) return;
  while (state.photos.length < index) state.photos.push(null);

  const old = state.photos[index];
  const photo = makePhoto(img);
  if (state.mode === 'free') {
    // 교체해도 놓인 자리와 기울기는 그대로 두고, 가로 폭에 맞춰 높이만 다시 잡는다.
    if (old?.free) {
      photo.free = { ...old.free, h: old.free.w * (img.height / img.width) };
    } else {
      placeFree(photo, 0);
    }
  }
  state.photos[index] = photo;
  state.selection = { kind: 'cell', index };
  refreshProps(true);
  update();
}

/* 배경 무늬로 쓸 사진 */
async function pickBgPattern() {
  const [img] = await pickImages(false);
  if (!img) return;
  state.bgPattern.img = img;
  // 사진을 쓰지 않는 무늬를 고른 채였다면 바로 보이도록 하프톤으로 켜 준다.
  if (!['blur', 'pixel', 'halftone'].includes(state.bgPattern.kind)) state.bgPattern.kind = 'halftone';
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

function addShape(shape = 'rect') {
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

  // 미리보기는 효과를 작게 구워 쓴다. 내보낼 때만 원본 해상도로 다시 굽는다.
  closeTextEditor();
  setFullRes(true);
  render();

  // 선택 표시는 오버레이에만 있으므로 작품 캔버스를 그대로 내보낸다.
  art.toBlob((blob) => {
    setFullRes(false);
    render();
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

const actions = {
  addPhoto, addSticker, addText, addShape, fillCell, pickBgPattern, exportImage, reset,
};
initLeftPanel(actions);
initRightPanel(actions);
initStageBar();
initLayerReorder();
initPanelTabs();

// 패널 너비가 바뀌면 슬라이더 채움 경계도 다시 계산해야 한다.
window.addEventListener('resize', () => { closeTextEditor(); render(); syncZoomBar(); paintAllRanges(); });

if (document.fonts?.ready) document.fonts.ready.then(() => render());

paintAllRanges();
update();
