/* 좌/우 패널 UI. 상태를 바꾸고 다시 그리도록 요청한다. */

import {
  state, RATIOS, TEMPLATES, SHAPES, BG_PATTERNS, BG_DEFAULTS, bgOpts,
  KIND_LABEL, WEIGHT_LABEL, FREE_RATIO,
  template, shapeLabel, selectedLayer, removeLayer, duplicateLayer,
  resizeCanvas, applyRatio, freeRatio, movePhoto,
} from 'app/state.js';
import { render, getLayout, fitView, setViewScale, viewRatio, fitRatio } from 'app/render.js';
import { clampPan, photoSize, seedFreeBoxes } from 'app/geometry.js';
import { EFFECTS } from 'app/effects.js';
import { clampBgPan } from 'app/pattern.js';
import { allFonts, findFont, addWebFont } from 'app/webfonts.js';

const $ = (id) => document.getElementById(id);
const propsEl = $('props');
const photoPropsEl = $('photoProps');
const layerListEl = $('layerList');
const thumbsEl = $('thumbs');
const photoFxEl = $('photoFx');
const bgPropsEl = $('bgProps');

/* ── 슬라이더 채움 표시 ──────────────────── */

/* CSS 의 thumb 너비와 맞춰야 채움 경계가 손잡이 한가운데에 온다. */
const THUMB_W = 24;

export function paintRange(el) {
  const min = Number(el.min) || 0;
  const max = Number(el.max);
  const v = Number(el.value);
  const ratio = max === min ? 0 : (v - min) / (max - min);
  const w = el.clientWidth;
  // 손잡이는 양 끝에서 절반씩 안쪽으로만 움직인다. 그 이동 범위에 맞춰 경계를 잡는다.
  const pct = w > THUMB_W
    ? ((THUMB_W / 2 + ratio * (w - THUMB_W)) / w) * 100
    : ratio * 100;
  el.style.setProperty('--pct', `${Math.max(0, Math.min(100, pct))}%`);
}

export function paintAllRanges(root = document) {
  root.querySelectorAll('input[type="range"]').forEach(paintRange);
}

document.addEventListener('input', (e) => {
  if (e.target.type === 'range') paintRange(e.target);
}, true);

/* ── 색상 코드 ───────────────────────────── */

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

function normalizeHex(value) {
  const s = String(value).trim();
  if (!HEX_RE.test(s)) return null;
  let h = s.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return `#${h.toLowerCase()}`;
}

/* 색상 견본과 HEX 입력을 한 쌍으로 묶는다. */
function colorField(label, path, value) {
  return `<div class="field field-color">
    <span>${label}</span>
    <span class="color-pair">
      <input type="text" class="hex" data-path="${path}" data-hex="1" maxlength="7" value="${String(value).toUpperCase()}">
      <input type="color" data-path="${path}" value="${value}">
    </span>
  </div>`;
}

/* 패널에 고정으로 박혀 있는 색상 입력 한 쌍을 연결한다. */
function bindStaticColor(colorEl, hexEl, apply) {
  colorEl.addEventListener('input', () => {
    hexEl.value = colorEl.value.toUpperCase();
    hexEl.classList.remove('is-invalid');
    apply(colorEl.value);
  });
  hexEl.addEventListener('input', () => {
    const hex = normalizeHex(hexEl.value);
    hexEl.classList.toggle('is-invalid', !hex);
    if (!hex) return;
    colorEl.value = hex;
    apply(hex);
  });
}

/* ── 전체 갱신 ───────────────────────────── */

export const photoCount = () => state.photos.filter(Boolean).length;

export function update() {
  render();
  syncZoomBar();
  refreshProps();
  refreshPhotoFx();
  refreshBgProps();
  refreshThumbs();
  refreshLayerList();
  refreshMeta();
}

/* ── 사진 썸네일 ─────────────────────────── */

let panelActions = null;

export function refreshThumbs() {
  const slots = state.mode === 'template'
    ? Math.max(state.photos.length, template().cells.length)
    : state.photos.length;

  thumbsEl.innerHTML = '';
  if (!slots) return;

  const sel = state.selection;
  for (let i = 0; i < slots; i++) {
    const photo = state.photos[i];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'thumb'
      + (photo ? '' : ' thumb-empty')
      + (sel?.kind === 'cell' && sel.index === i ? ' is-active' : '');
    b.title = state.mode === 'free'
      ? `${i + 1}번째 사진 (뒤에 있을수록 위에 그려짐)`
      : `${i + 1}번 칸${photo ? '' : ' (비어 있음)'}`;

    if (photo) {
      const img = document.createElement('img');
      img.src = photo.img.src;
      img.alt = '';
      // 브라우저 기본 이미지 끌기가 켜져 있으면 누르는 순간 포인터가 취소돼
      // 순서 바꾸기가 시작조차 못 한다.
      img.draggable = false;
      b.appendChild(img);
    } else {
      b.textContent = '+';
    }

    b.addEventListener('click', () => {
      if (thumbClickBlocked) return;        // 방금 끌어서 순서를 바꾼 참이다
      if (!photo) return panelActions?.fillCell(i);
      state.selection = { kind: 'cell', index: i };
      update();
    });
    thumbsEl.appendChild(b);
  }
}

/* 썸네일을 끌어 사진 순서를 바꾼다.
   레이어 목록과 달리 격자라서 한 칸 밀릴 때 줄이 바뀌기도 한다.
   그래서 칸의 실제 자리를 재 두고 '어느 자리로 가는지'를 좌표로 계산한다. */
let thumbDrag = null;
let thumbClickBlocked = false;

/* setPointerCapture 는 쓰지 않는다. 컨테이너가 포인터를 잡으면 pointerup 이 그쪽으로
   가면서 click 이 버튼 대신 컨테이너로 떨어져, 썸네일 클릭 선택이 통째로 죽는다.
   대신 끄는 동안만 document 에 귀를 달아 밖으로 나가도 따라오게 한다. */
function initThumbReorder() {
  const onMove = (e) => {
    if (!thumbDrag) return;
    const dx = e.clientX - thumbDrag.startX;
    const dy = e.clientY - thumbDrag.startY;

    if (!thumbDrag.moved) {
      if (Math.hypot(dx, dy) < 5) return;   // 그냥 누른 것과 구분
      thumbDrag.moved = true;
      thumbDrag.el.classList.add('is-dragging');
      thumbsEl.classList.add('is-reordering');
    }
    e.preventDefault();
    thumbDrag.el.style.transform = `translate(${dx}px, ${dy}px)`;

    const target = nearestSlot(thumbDrag, dx, dy);
    if (target !== thumbDrag.target) {
      thumbDrag.target = target;
      shiftThumbs();
    }
  };

  const finish = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', finish);
    document.removeEventListener('pointercancel', finish);
    if (!thumbDrag) return;

    const { moved, index, target, el, items } = thumbDrag;
    thumbDrag = null;

    el.classList.remove('is-dragging');
    thumbsEl.classList.remove('is-reordering');
    for (const it of items) it.style.transform = '';
    if (!moved) return;                     // 눌렀다 뗀 것 — click 이 알아서 처리한다

    // 끌었다면 이어서 오는 click 은 무시한다(빈 칸이면 파일 창이 열려 버린다).
    // 터치에서는 click 이 조금 늦게 오므로 넉넉히 기다렸다 푼다.
    thumbClickBlocked = true;
    setTimeout(() => { thumbClickBlocked = false; }, 400);

    if (index === target) return;
    movePhoto(index, target);
    update();
  };

  thumbsEl.addEventListener('pointerdown', (e) => {
    if (e.button != null && e.button !== 0) return;   // 왼쪽 버튼만
    const el = e.target.closest('.thumb');
    if (!el) return;
    const items = [...thumbsEl.children];
    if (items.length < 2) return;
    const index = items.indexOf(el);
    thumbDrag = {
      items, el, index, target: index, moved: false,
      slots: items.map((it) => ({ x: it.offsetLeft, y: it.offsetTop })),
      startX: e.clientX, startY: e.clientY,
    };
    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
  });
}

/* 끄는 칸의 지금 위치에서 가장 가까운 자리를 고른다. */
function nearestSlot({ slots, index }, dx, dy) {
  const px = slots[index].x + dx;
  const py = slots[index].y + dy;
  let best = index;
  let lo = Infinity;
  slots.forEach((s, i) => {
    const d = (s.x - px) ** 2 + (s.y - py) ** 2;
    if (d < lo) { lo = d; best = i; }
  });
  return best;
}

/* 끄는 칸을 뺀 나머지가 한 자리씩 밀린다. 줄이 바뀌는 경우도 좌표 차이로 처리된다. */
function shiftThumbs() {
  const { items, slots, index, target, el } = thumbDrag;
  items.forEach((it, i) => {
    if (it === el) return;
    let to = i;
    if (index < target && i > index && i <= target) to = i - 1;
    else if (index > target && i >= target && i < index) to = i + 1;
    const dx = slots[to].x - slots[i].x;
    const dy = slots[to].y - slots[i].y;
    it.style.transform = dx || dy ? `translate(${dx}px, ${dy}px)` : '';
  });
}

/* 미리보기 아래 안내문 — 모드마다 되는 조작이 달라 문구도 갈라 둔다. */
const STAGE_TIPS = {
  auto: '드래그로 사진 속 이동 · 두 번 눌러 교체 · 휠로 화면 이동 · Alt+휠로 확대',
  template: '빈 칸 클릭해 넣기 · 두 번 눌러 교체 · 드래그로 사진 속 이동 · Alt+휠로 확대',
  free: '드래그로 옮기기 · 귀퉁이로 크기 · 위 손잡이로 기울기 · Shift+드래그로 사진 속 이동',
};

function refreshMeta() {
  const { W, H } = getLayout();
  const size = `${W} × ${H} px`;
  const ratio = state.ratioId === FREE_RATIO ? '자유 비율' : state.ratioId;
  $('windowMeta').textContent = state.mode === 'template'
    ? `${ratio} · ${size}`
    : state.mode === 'free'
      ? `자유 배치 · ${ratio} · ${size}`
      : `원본 그대로 · ${state.direction === 'h' ? '가로' : '세로'} · ${size}`;
  $('stageTip').textContent = STAGE_TIPS[state.mode] || '';
  if (state.mode === 'template') updateTemplateNote();
}

/* ── 왼쪽 패널 ───────────────────────────── */

export function initLeftPanel(actions) {
  panelActions = actions;
  buildRatioChips();
  buildTemplates();

  segment($('modeSeg'), 'mode', (v) => {
    // 자유 배치로 넘어갈 때 지금 보고 있는 자리를 물려받으므로 먼저 재 둔다.
    const prev = getLayout();
    state.mode = v;
    state.selection = null;
    if (v === 'free') seedFreeBoxes(prev);
    // 원본 그대로·자유 배치에는 빈 칸 개념이 없으므로 빈 자리를 눌러 없앤다.
    if (v !== 'template') state.photos = state.photos.filter(Boolean);
    syncModeBlocks();
    update();
  });

  segment($('dirSeg'), 'dir', (v) => { state.direction = v; update(); });

  // 비율·크기는 입력을 마쳤을 때 반영한다(타이핑 중간값으로 튀지 않게).
  $('ratioW').addEventListener('change', onRatioInput);
  $('ratioH').addEventListener('change', onRatioInput);
  $('pxW').addEventListener('change', (e) => { resizeCanvas('w', Number(e.target.value)); syncCanvasFields(); update(); });
  $('pxH').addEventListener('change', (e) => { resizeCanvas('h', Number(e.target.value)); syncCanvasFields(); update(); });

  rangeControl($('outlineW'), $('outlineWNum'), (v) => { state.outline.width = v; syncOutlineBlock(); update(); });
  $('outlineOuter').addEventListener('change', (e) => { state.outline.outer = e.target.checked; update(); });
  bindStaticColor($('outlineColor'), $('outlineColorHex'), (v) => { state.outline.color = v; update(); });

  segment($('outlineModeSeg'), 'omode', (v) => { state.outline.mode = v; syncOutlineBlock(); update(); });

  $('bgOff').addEventListener('change', (e) => {
    state.bgOn = !e.target.checked;
    syncBgBlock();
    update();
  });

  bindStaticColor($('bgColor'), $('bgColorHex'), (v) => { state.bg = v; update(); });

  $('addPhoto').addEventListener('click', actions.addPhoto);

  for (const el of [photoPropsEl, photoFxEl, bgPropsEl]) {
    el.addEventListener('input', onPropInput);
    el.addEventListener('change', onNumCommit);
    el.addEventListener('click', (e) => onPropClick(e, actions));
    trackGroupToggles(el);
  }
  initThumbReorder();

  syncModeBlocks();
  syncOutlineBlock();
  syncBgBlock();
  syncCanvasFields();
}

/* 외곽선 블록 — 비워 두는 방식이면 색을 고를 이유가 없다. */
function syncOutlineBlock() {
  const { width, mode } = state.outline;
  $('outlineColorField').classList.toggle('is-hidden', mode !== 'fill');
  $('outlineNote').textContent = width === 0
    ? '사진 바깥에 둘러지는 테입니다. 굵기를 올리면 사진이 그만큼 서로 떨어집니다.'
    : mode === 'fill'
      ? `맞붙은 사진 사이는 테 두 장이 만나 ${width * 2}px 로 보입니다.`
      : `테 자리를 비워 둬 배경이 비칩니다. 사진 사이는 ${width * 2}px 입니다.`;
}

/* 배경을 끄면 색도 무늬도 쓸 일이 없다.
   접어 뒀을 때도 무엇이 깔려 있는지는 제목 옆에 적어 둔다. */
function syncBgBlock() {
  $('bgOpts').classList.toggle('is-hidden', !state.bgOn);
  $('bgOffNote').classList.toggle('is-hidden', state.bgOn);
  const kind = BG_PATTERNS.find((p) => p.id === state.bgPattern.kind);
  $('bgFoldHint').textContent = state.bgOn ? (kind?.label || '') : '사용 안 함';
}

function onRatioInput() {
  const w = Math.max(1, Number($('ratioW').value) || 1);
  const h = Math.max(1, Number($('ratioH').value) || 1);
  applyRatio(w, h);
  markActive($('ratioChips'), '.chip', (el) => el.dataset.ratio === state.ratioId);
  syncCanvasFields();
  update();
}

function syncCanvasFields() {
  const free = state.ratioId === FREE_RATIO;
  $('ratioPair').classList.toggle('is-hidden', free);
  $('ratioNote').textContent = free
    ? '가로와 세로를 따로 정합니다.'
    : '한쪽 값을 바꾸면 비율에 맞춰 나머지가 따라갑니다.';
  $('ratioW').value = state.ratio.w;
  $('ratioH').value = state.ratio.h;
  $('pxW').value = state.canvasW;
  $('pxH').value = state.canvasH;
}

function syncModeBlocks() {
  const m = state.mode;
  // 캔버스 크기를 직접 정하는 모드 — 템플릿과 자유 배치.
  const sized = m === 'template' || m === 'free';
  $('autoBlock').classList.toggle('is-hidden', m !== 'auto');
  $('ratioBlock').classList.toggle('is-hidden', !sized);
  $('templateBlock').classList.toggle('is-hidden', m !== 'template');
  $('freeBlock').classList.toggle('is-hidden', m !== 'free');
  // 자유 배치에는 '캔버스 가장자리 여백'이라는 개념이 없다.
  $('outlineOuterRow').classList.toggle('is-hidden', m === 'free');
  if (m === 'template') updateTemplateNote();
}

function updateTemplateNote() {
  const cells = template().cells.length;
  const photos = photoCount();
  const note = $('templateNote');
  if (photos < cells) note.textContent = `${cells}칸 중 ${photos}칸 채움 — 빈 칸을 클릭해 사진을 넣으세요.`;
  else if (photos > cells) note.textContent = `사진 ${photos}장 중 앞에서 ${cells}장만 배치됩니다.`;
  else note.textContent = `${cells}칸을 모두 채웠습니다.`;
}

function buildRatioChips() {
  const wrap = $('ratioChips');
  wrap.innerHTML = '';

  const chip = (id, label, pick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (id === state.ratioId ? ' is-active' : '');
    b.dataset.ratio = id;
    b.textContent = label;
    b.addEventListener('click', () => {
      pick();
      markActive(wrap, '.chip', (el) => el.dataset.ratio === id);
      syncCanvasFields();
      update();
    });
    wrap.appendChild(b);
  };

  for (const r of RATIOS) chip(r.id, r.id, () => applyRatio(r.w, r.h));
  // 비율에 묶지 않고 가로·세로를 따로 정하는 칸.
  chip(FREE_RATIO, '자유', freeRatio);
}

function buildTemplates() {
  const wrap = $('templates');
  wrap.innerHTML = '';
  for (const t of TEMPLATES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tpl' + (t.id === state.templateId ? ' is-active' : '');
    b.dataset.tpl = t.id;
    b.title = `${t.cells.length}칸`;
    for (const [x, y, w, h] of t.cells) {
      const i = document.createElement('i');
      i.style.left = `${8 + x * 84}%`;
      i.style.top = `${8 + y * 84}%`;
      i.style.width = `${w * 84 - 3}%`;
      i.style.height = `${h * 84 - 3}%`;
      b.appendChild(i);
    }
    b.addEventListener('click', () => {
      state.templateId = t.id;
      state.selection = null;
      markActive(wrap, '.tpl', (el) => el.dataset.tpl === t.id);
      update();
    });
    wrap.appendChild(b);
  }
}

/* ── 오른쪽 패널 ─────────────────────────── */

export function initRightPanel(actions) {
  initAddMenu(actions);
  $('exportBtn').addEventListener('click', actions.exportImage);
  $('resetBtn').addEventListener('click', actions.reset);

  segment($('formatSeg'), 'format', (v) => {
    state.exportFormat = v;
    $('qualityWrap').classList.toggle('is-hidden', v === 'png');
  });

  rangeControl($('quality'), $('qualityNum'), (v) => { state.quality = v / 100; });

  propsEl.addEventListener("input", onPropInput);
  propsEl.addEventListener("change", onNumCommit);
  propsEl.addEventListener("click", (e) => onPropClick(e, actions));
  trackGroupToggles(propsEl);

  // 웹폰트 칸은 data-path 가 없어 위 처리기들이 그냥 지나친다. 따로 받는다.
  propsEl.addEventListener('change', (e) => {
    const cb = e.target.closest('[data-webfont-toggle]');
    if (!cb) return;
    webfontOpen = cb.checked;
    webfontMsg = '';
    refreshProps(true);
  });
  propsEl.addEventListener('input', (e) => {
    const ta = e.target.closest('[data-webfont-code]');
    if (ta) webfontDraft = ta.value;
  });
}

/* 레이어 칸 우상단 + 드롭다운 */
function initAddMenu(actions) {
  const btn = $('addMenuBtn');
  const list = $('addMenu');
  const close = () => {
    list.classList.add('is-hidden');
    btn.setAttribute('aria-expanded', 'false');
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = list.classList.toggle('is-hidden');
    btn.setAttribute('aria-expanded', String(!open));
    if (open) return;
    // 화면 기준으로 띄우므로 열 때마다 버튼 위치를 다시 잰다.
    const r = btn.getBoundingClientRect();
    list.style.top = `${r.bottom + 4}px`;
    list.style.right = `${window.innerWidth - r.right}px`;
  });

  // 스크롤하면 버튼과 어긋나므로 닫는다.
  window.addEventListener('scroll', close, true);
  window.addEventListener('resize', close);

  list.addEventListener('click', (e) => {
    const item = e.target.closest('[data-add]');
    if (!item) return;
    close();
    const kind = item.dataset.add;
    if (kind === 'sticker') actions.addSticker();
    else if (kind === 'text') actions.addText();
    // 도형은 한 항목으로 묶여 있다. 종류는 속성 패널에서 고른다.
    else actions.addShape();
  });

  document.addEventListener('click', (e) => {
    if (!list.classList.contains('is-hidden') && !e.target.closest('.menu')) close();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

/* 좁은 화면에서는 패널을 탭으로 전환한다. 넓은 화면에서는 CSS 가 무시한다. */
export function initPanelTabs() {
  const tabs = [...document.querySelectorAll('.panel-tab')];
  const bodies = [...document.querySelectorAll('.panel-body')];

  const activate = (name) => {
    for (const t of tabs) t.classList.toggle('is-active', t.dataset.panel === name);
    for (const b of bodies) b.classList.toggle('is-active', b.dataset.panel === name);
    // 숨어 있던 미리보기가 나오면 크기를 다시 재야 한다.
    render();
    paintAllRanges();
  };

  for (const t of tabs) t.addEventListener('click', () => activate(t.dataset.panel));
  activate('preview');
}

/* 배율 버튼과 지금 배율 표시 */
export function syncZoomBar() {
  const pct = Math.round(viewRatio() * 100);
  $('zoomNow').textContent = `${pct}%`;
  for (const b of $('zoomBar').querySelectorAll('[data-zoom]')) {
    const z = b.dataset.zoom;
    const on = z === 'fit'
      ? state.view.fit
      : !state.view.fit && Math.abs(viewRatio() - Number(z)) < 0.005;
    b.classList.toggle('is-active', on);
  }
}

/* 미리보기 아래 그리드 · 스냅 */
export function initStageBar() {
  $('zoomBar').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-zoom]');
    if (!btn) return;
    if (btn.dataset.zoom === 'fit') fitView();
    else setViewScale(Number(btn.dataset.zoom));
    render();
    syncZoomBar();
  });

  $('gridOn').addEventListener('change', (e) => { state.grid.show = e.target.checked; render(); });
  $('snapOn').addEventListener('change', (e) => { state.grid.snap = e.target.checked; });
  $('gridCols').addEventListener('input', (e) => {
    state.grid.cols = Math.max(1, Math.min(24, Number(e.target.value) || 1));
    render();
  });
  $('gridRows').addEventListener('input', (e) => {
    state.grid.rows = Math.max(1, Math.min(24, Number(e.target.value) || 1));
    render();
  });
}

/* 속성 패널은 선택 대상이 바뀔 때만 다시 만든다(입력 중 포커스 유지). */
let propsKey = '';

export function refreshProps(force = false) {
  const sel = state.selection;
  const key = !sel ? 'none' : `${sel.kind}:${sel.kind === 'cell' ? sel.index : sel.id}`;
  if (!force && key === propsKey) { syncPropOutputs(); return; }
  propsKey = key;

  if (sel?.kind === 'cell') {
    photoPropsEl.innerHTML = cellProps(sel.index);
    propsEl.innerHTML = emptyHint();
  } else if (sel?.kind === 'layer') {
    photoPropsEl.innerHTML = '';
    propsEl.innerHTML = layerProps(selectedLayer());
  } else {
    photoPropsEl.innerHTML = '';
    propsEl.innerHTML = emptyHint();
  }
  paintAllRanges();
}

const emptyHint = () =>
  '<p class="block-note">캔버스에서 스티커·텍스트·도형을 선택하면 여기에 속성이 나옵니다.</p>';

function cellProps(index) {
  const photo = state.photos[index];
  if (!photo) {
    return `<p class="block-note">이 칸에 넣을 사진을 고르세요.</p>
      <button class="btn" data-action="fillCell" type="button">사진 넣기</button>`;
  }
  const free = state.mode === 'free' ? photo.free : null;
  const span = Math.max(state.canvasW, state.canvasH);

  return `${slider('확대', 'zoom', photo.zoom, 1, 4, 0.01)}
    <div class="switch-pair">
      ${switchRow('좌우 반전', 'flipH', photo.flipH)}
      ${switchRow('상하 반전', 'flipV', photo.flipV)}
      <button class="mini-btn rotate-btn" data-action="rotate90" type="button"
        title="시계 방향으로 90° 회전">↻ 회전</button>
    </div>
    ${!free ? '' : `<div class="prop-group">
      ${slider('틀 가로', 'free.w', free.w, 20, span, 1)}
      ${slider('틀 세로', 'free.h', free.h, 20, span, 1)}
      ${slider('기울기 °', 'free.rot', (free.rot * 180) / Math.PI, -180, 180, 1,
        { reset: 'resetFreeRot', scale: Math.PI / 180 })}
      <button class="btn" data-action="fitFreeBox" type="button">원본 비율로 맞춤</button>
      <div class="field-row">
        <button class="btn" data-action="photoFront" type="button">맨 앞으로</button>
        <button class="btn" data-action="photoBack" type="button">맨 뒤로</button>
      </div>
    </div>`}
    <div class="field-row">
      <button class="btn" data-action="fillCell" type="button">교체</button>
      <button class="btn" data-action="resetPan" type="button">맞춤</button>
    </div>
    <button class="btn btn-ghost" data-action="removePhoto" type="button">이 사진 빼기</button>`;
}

/* 오른쪽에 스위치가 붙은 한 줄.
   label 로 줄 전체를 감싸면 글자를 눌러도 토글이 되므로, label 은 스위치에만 씌운다. */
/* data-keep 은 '이 체크박스는 하위 옵션을 여닫지 않는다'는 표시.
   패널을 다시 만들면 방금 만든 요소로 갈려 스위치가 움직이는 모습이 사라진다. */
function switchRow(label, path, on) {
  return `<div class="switch-row">
    <span>${label}</span>
    <label class="switch-hit">
      <input type="checkbox" data-path="${path}" data-keep="1" ${on ? 'checked' : ''}>
      <i class="switch"></i>
    </label>
  </div>`;
}

/* ── 효과 ────────────────────────────────── */

/* 효과 방식(state.fxMode)은 둘 중 하나만 산다 — 사진마다 따로 걸거나, 캔버스 전체에 걸거나.
   칸을 고르지 않아도 방식을 바꿀 수 있도록 사진 블록에 늘 띄워 둔다. */
let fxKey = '';

/* 그레인과 밝기·대비는 다른 효과 위에 겹쳐 쓰는 것이라 목록에서 빼고 따로 조절하게 뒀다.
   강도는 효과마다 따로 저장하므로 경로에 현재 효과 이름이 들어간다.
   픽셀화·하프톤에서는 그 강도가 사실상 칸 크기라 이름만 바꿔 보여 준다. */
const AMOUNT_LABEL = { pixel: '칸 크기', half: '칸 크기' };

function effectControls(fx, prefix) {
  const btns = EFFECTS.map((e) => `
    <button class="seg-btn ${fx.mode === e.id ? 'is-active' : ''}"
      data-set="${prefix}.mode" data-value="${e.id}" type="button">${e.label}</button>`).join('');

  return `<div class="seg seg-wrap">${btns}</div>
    ${fx.mode === 'none' ? '' : slider(AMOUNT_LABEL[fx.mode] || '강도',
      `${prefix}.amounts.${fx.mode}`, fx.amounts[fx.mode], 0, 1, 0.01)}
    ${fx.mode === 'half' ? slider('점 굵기', `${prefix}.dot`, fx.dot, 0.2, 1.6, 0.01) : ''}
    ${slider('밝기', `${prefix}.brightness`, fx.brightness, -1, 1, 0.01)}
    ${slider('대비', `${prefix}.contrast`, fx.contrast, -1, 1, 0.01)}
    ${slider('필름 그레인', `${prefix}.grain`, fx.grain, 0, 1, 0.01)}`;
}

/* 전체 모드에서는 요소마다 건 효과가 적용되지 않는다. 값은 그대로 두고 알려만 준다. */
const stickerFxNote = () => (state.fxMode === 'all'
  ? '<p class="block-note">지금은 <b>전체</b> 모드라 이 설정은 적용되지 않습니다. 사진 블록에서 <b>사진 선택</b>으로 바꾸면 살아납니다.</p>'
  : '');

function selectedPhoto() {
  const sel = state.selection;
  return sel?.kind === 'cell' ? state.photos[sel.index] : null;
}

export function refreshPhotoFx(force = false) {
  const all = state.fxMode === 'all';
  const photo = selectedPhoto();
  const fx = all ? state.canvasFx : photo?.fx;

  // 고른 대상이나 효과 종류가 바뀔 때만 다시 만든다(입력 중 초점 유지).
  const key = `${state.fxMode}|${all ? '-' : state.selection?.index ?? -1}|${fx?.mode ?? '-'}`;
  if (!force && key === fxKey) { syncPropOutputs(); return; }
  fxKey = key;

  const modeSeg = `<div class="seg">
    ${[['each', '사진 선택'], ['all', '전체']].map(([v, t]) => `
      <button class="seg-btn ${state.fxMode === v ? 'is-active' : ''}" data-fxmode="${v}" type="button">${t}</button>`).join('')}
  </div>`;

  const note = all
    ? '<p class="block-note">사진·글자·도형을 다 그린 뒤 캔버스 전체에 덧입힙니다. 사진마다 걸어 둔 효과는 적용되지 않습니다.</p>'
    : '';

  const body = fx
    ? effectControls(fx, all ? 'canvasFx' : 'fx')
    : '<p class="block-note">효과를 걸 칸을 먼저 고르세요.</p>';

  photoFxEl.innerHTML = group('효과', modeSeg + note + body);
  paintAllRanges(photoFxEl);
}

/* ── 배경 무늬 ───────────────────────────── */

/* 고른 무늬에 따라 쓸 만한 항목만 남긴다. 값은 모두 state.bgPattern 에 바로 들어간다. */
let bgKey = '';

export function refreshBgProps(force = false) {
  const bp = state.bgPattern;
  const key = `${bp.kind}|${bp.img ? 1 : 0}`;
  if (!force && key === bgKey) return;
  bgKey = key;
  bgPropsEl.innerHTML = bgPatternProps(bp);
  paintAllRanges(bgPropsEl);
  syncBgBlock();
}

function bgPatternProps(bp) {
  const seg = `<div class="seg seg-wrap">${BG_PATTERNS.map((p) => `
    <button class="seg-btn ${bp.kind === p.id ? 'is-active' : ''}"
      data-set="bgPattern.kind" data-value="${p.id}" type="button">${p.label}</button>`).join('')}</div>`;
  if (bp.kind === 'none') return seg;

  const pixel = bp.kind === 'pixel';
  const fromPhoto = pixel || bp.kind === 'halftone';
  const grad = bp.kind === 'gradient';
  // 조절값은 무늬마다 따로 있다. 경로도 그 무늬 칸을 가리킨다.
  const o = bgOpts();
  const at = (field) => `bgPattern.by.${bp.kind}.${field}`;

  return `${seg}
    ${!fromPhoto ? '' : `
      <button class="btn" data-action="bgPatternImage" type="button">${bp.img ? '사진 바꾸기' : '사진 고르기'}</button>
      ${bp.img ? '' : `<p class="block-note">${pixel ? '모자이크로' : '망점으로'} 찍을 사진을 고르세요.</p>`}`}
    ${grad ? '' : slider(fromPhoto ? '칸 크기' : '무늬 크기', at('size'), o.size, fromPhoto ? 6 : 3, 240, 1)}
    ${grad || bp.kind === 'checker' ? '' : slider(pixel ? '칸 채움' : fromPhoto ? '점 굵기' : '선·점 굵기',
      at('weight'), o.weight, 0.02, 1, 0.01)}
    ${slider('각도 °', at('angle'), o.angle, 0, 359, 1)}
    ${colorField(grad ? '번지는 색' : '무늬 색', at('color'), o.color)}
    ${pixel ? slider('무늬 색 섞기', at('tint'), o.tint, 0, 1, 0.01) : ''}
    ${!fromPhoto ? '' : `
      ${slider('밝기', at('brightness'), o.brightness, -1, 1, 0.01)}
      ${slider('대비', at('contrast'), o.contrast, -1, 1, 0.01)}
      ${slider('사진 확대', at('zoom'), o.zoom, 1, 4, 0.01)}`}
    ${slider('불투명도', at('opacity'), o.opacity, 0.05, 1, 0.01)}
    ${grad ? '' : `
      ${slider('가로 위치', at('x'), o.x, -3000, 3000, 1)}
      ${slider('세로 위치', at('y'), o.y, -3000, 3000, 1)}
      <p class="block-note">캔버스의 빈 바탕을 끌어도 무늬가 따라 움직입니다.${
        fromPhoto ? ' 사진은 늘 캔버스를 꽉 채운 채로만 움직입니다.' : ''}</p>`}
    <button class="btn btn-ghost" data-action="resetBgPattern" type="button">기본값으로</button>`;
}

function layerProps(l) {
  if (!l) return emptyHint();
  if (l.type === 'text') return textProps(l);
  if (l.type === 'shape') return shapeProps(l);
  return stickerProps(l);
}

/* ── 텍스트 ──────────────────────────────── */

function fontOptions(current) {
  return ['sans', 'serif', 'custom'].map((kind) => {
    const list = allFonts().filter((f) => f.kind === kind);
    if (!list.length) return '';
    const opts = list
      .map((f) => `<option value="${f.id}" ${f.id === current ? 'selected' : ''}>${escapeHtml(f.label)}</option>`)
      .join('');
    return `<optgroup label="${KIND_LABEL[kind]}">${opts}</optgroup>`;
  }).join('');
}

/* ── 웹폰트 임시 추가 ────────────────────── */

/* 속성 패널은 자주 다시 만들어지므로, 펼침 상태와 입력 중인 코드는 밖에 둔다. */
let webfontOpen = false;
let webfontDraft = '';
let webfontMsg = '';

function webfontBox() {
  const body = !webfontOpen ? '' : `
    <div class="webfont">
      <textarea data-webfont-code rows="3"
        placeholder="&lt;link&gt; 태그나 @import · @font-face 코드를 붙여 넣으세요">${escapeHtml(webfontDraft)}</textarea>
      <button class="btn" data-action="webfontAdd" type="button">확인</button>
      ${webfontMsg ? `<p class="block-note">${escapeHtml(webfontMsg)}</p>` : ''}
      <p class="block-note">이 창에서만 씁니다. 새로고침하면 사라집니다.</p>
    </div>`;

  return `<label class="check check-sm">
      <input type="checkbox" data-webfont-toggle ${webfontOpen ? 'checked' : ''}>
      <span>웹폰트 사용</span>
    </label>${body}`;
}

async function applyWebFont() {
  const code = webfontDraft.trim();
  if (!code) { webfontMsg = '임베드 코드를 붙여 넣어 주세요.'; refreshProps(true); return; }

  webfontMsg = '불러오는 중…';
  refreshProps(true);

  const res = await addWebFont(code);
  webfontMsg = res.ok ? `${res.added.join(', ')} — 폰트 목록에 넣었습니다.` : res.error;
  if (res.ok) webfontDraft = '';
  render();
  refreshProps(true);
}

const WEIGHT_SHORT = { 300: 'L', 400: 'M', 700: 'B' };

function weightSeg(l) {
  const font = findFont(l.font);
  const btns = [300, 400, 700].map((w) => {
    const has = font.weights.includes(w);
    return `<button class="seg-btn ${l.weight === w ? 'is-active' : ''}"
      data-set="weight" data-value="${w}" data-num="1" ${has ? '' : 'disabled'}
      title="${WEIGHT_LABEL[w]}" type="button">${WEIGHT_SHORT[w]}</button>`;
  }).join('');
  return `<div class="seg seg-mini">${btns}</div>`;
}

function textProps(l) {
  return `${title('텍스트')}
    ${group('', `
      <textarea data-path="text" rows="3">${escapeHtml(l.text)}</textarea>
      <div class="font-row">
        <select data-path="font">${fontOptions(l.font)}</select>
        ${weightSeg(l)}
      </div>
      ${webfontBox()}
      <div class="icon-row">
        <button class="icon-btn i-italic ${l.italic ? 'is-active' : ''}" data-toggle="italic" type="button">I</button>
        <span class="spacer"></span>
        ${['left', 'center', 'right'].map((a) => `
          <button class="icon-btn ${l.align === a ? 'is-active' : ''}" data-set="align" data-value="${a}" type="button">${a === 'left' ? '⇤' : a === 'right' ? '⇥' : '↔'}</button>`).join('')}
      </div>`)}

    ${group('글자 모양', `
      ${slider('크기', 'size', l.size, 12, 400, 1)}
      ${slider('자간', 'letterSpacing', l.letterSpacing, -0.05, 0.4, 0.005)}
      ${slider('행간', 'lineHeight', l.lineHeight, 0.9, 2.4, 0.05)}
      ${colorField('글자색', 'color', l.color)}`)}

    ${group('글자 외곽선', `
      <label class="check"><input type="checkbox" data-path="stroke.show" ${l.stroke.show ? 'checked' : ''}><span>외곽선 넣기</span></label>
      ${l.stroke.show ? `
        ${colorField('외곽선 색', 'stroke.color', l.stroke.color)}
        ${slider('굵기', 'stroke.width', l.stroke.width, 0.01, 0.4, 0.005)}` : ''}`)}

    ${group('글자 배경', `
      <div class="seg">
        ${[['none', '없음'], ['solid', '단색'], ['glass', '글래스']].map(([v, t]) => `
          <button class="seg-btn ${l.bg.mode === v ? 'is-active' : ''}" data-set="bg.mode" data-value="${v}" type="button">${t}</button>`).join('')}
      </div>
      ${l.bg.mode === 'none' ? '' : `
        ${colorField(l.bg.mode === 'glass' ? '유리 색조' : '배경색', 'bg.color', l.bg.color)}
        ${slider('불투명도', 'bg.opacity', l.bg.opacity, 0.05, 1, 0.01)}
        ${slider('여백 가로', 'bg.padX', l.bg.padX, 0, 2, 0.05)}
        ${slider('여백 세로', 'bg.padY', l.bg.padY, 0, 2, 0.05)}
        ${slider('모서리', 'bg.radius', l.bg.radius, 0, 0.5, 0.01)}`}`)}

    ${commonGroups(l)}`;
}

/* ── 도형 ────────────────────────────────── */

/* 도형 종류 고르기. 아이콘은 캔버스에 그려지는 모양을 작게 흉내낸 것. */
const SHAPE_ICON = {
  rect: '<rect x="3" y="3" width="14" height="14"/>',
  circle: '<circle cx="10" cy="10" r="7"/>',
  ring: '<circle cx="10" cy="10" r="5.6" fill="none" stroke="currentColor" stroke-width="3"/>',
  triangle: '<path d="M10 3 17.5 17H2.5Z"/>',
  star: '<polygon points="10,2 12,7.3 17.6,7.5 13.2,11.1 14.7,16.5 10,13.4 5.3,16.5 6.8,11.1 2.4,7.5 8,7.3"/>',
  heart: '<path d="M10 17.2S2.8 12.6 2.8 8.3A3.9 3.9 0 0 1 10 6.1a3.9 3.9 0 0 1 7.2 2.2c0 4.3-7.2 8.9-7.2 8.9Z"/>',
  arrow: '<path d="M2.5 7.6h8V3.4L17.5 10l-7 6.6v-4.2h-8Z"/>',
  sparkle: '<path d="M10 2c.7 4.3 3.7 7.3 8 8-4.3.7-7.3 3.7-8 8-.7-4.3-3.7-7.3-8-8 4.3-.7 7.3-3.7 8-8Z"/>',
};

function shapeGrid(current) {
  return `<div class="shape-grid">${SHAPES.map((sh) => `
    <button class="shape-btn ${sh.id === current ? 'is-active' : ''}" data-set="shape"
      data-value="${sh.id}" title="${sh.label}" type="button">
      <svg viewBox="0 0 20 20" aria-hidden="true">${SHAPE_ICON[sh.id]}</svg>
    </button>`).join('')}</div>`;
}

function shapeProps(l) {
  const grad = l.fill.mode === 'gradient';
  return `${title(shapeLabel(l.shape))}
    ${group('종류', shapeGrid(l.shape))}
    ${group('채우기', `
      <div class="seg">
        ${[['solid', '단색'], ['gradient', '그라데이션'], ['glass', '글래스']].map(([v, t]) => `
          <button class="seg-btn ${l.fill.mode === v ? 'is-active' : ''}" data-set="fill.mode" data-value="${v}" type="button">${t}</button>`).join('')}
      </div>
      ${colorField(grad ? '시작 색' : '색상', 'fill.c1', l.fill.c1)}
      ${grad ? `
        ${slider('시작 투명도', 'fill.a1', l.fill.a1, 0, 1, 0.01)}
        ${colorField('끝 색', 'fill.c2', l.fill.c2)}
        ${slider('끝 투명도', 'fill.a2', l.fill.a2, 0, 1, 0.01)}
        ${slider('각도', 'fill.angle', l.fill.angle, 0, 360, 1)}` : ''}
      ${slider('불투명도', 'fill.opacity', l.fill.opacity, 0.05, 1, 0.01)}`)}

    ${group('크기', `
      ${slider('가로', 'w', l.w, 20, 4000, 1)}
      ${slider('세로', 'h', l.h, 20, 4000, 1)}
      ${switchRow('가로세로 비율 유지', 'lockRatio', l.lockRatio)}
      ${l.shape === 'rect' ? slider('모서리', 'radius', l.radius, 0, 0.5, 0.01) : ''}
      ${l.shape === 'ring' ? slider('구멍 크기', 'inner', l.inner, 0.05, 0.95, 0.01) : ''}
      ${l.shape === 'star' ? slider('꼭짓점 수', 'points', l.points, 3, 12, 1) : ''}
      ${l.shape === 'star' ? slider('뾰족함', 'spike', l.spike, 0.1, 0.9, 0.01) : ''}`)}

    ${group('외곽선', `
      <label class="check"><input type="checkbox" data-path="stroke.show" ${l.stroke.show ? 'checked' : ''}><span>외곽선 넣기</span></label>
      ${l.stroke.show ? `
        ${colorField('선 색상', 'stroke.color', l.stroke.color)}
        ${slider('선 굵기', 'stroke.width', l.stroke.width, 1, 60, 1)}` : ''}`)}

    ${commonGroups(l)}`;
}

function stickerProps(l) {
  return `${title('스티커')}
    <div class="sticker-preview"><img src="${l.img.src}" alt=""></div>
    ${group('크기', slider('', 'w', l.w, 40, 6000, 1))}

    ${group('아웃라인', `
      <label class="check"><input type="checkbox" data-path="outline.show" ${l.outline.show ? 'checked' : ''}><span>아웃라인 넣기 (투명 배경이면 피사체 윤곽을 따라감)</span></label>
      ${l.outline.show ? `
        ${colorField('선 색상', 'outline.color', l.outline.color)}
        ${slider('선 굵기', 'outline.width', l.outline.width, 1, 80, 1)}` : ''}`)}

    ${group('효과', stickerFxNote() + effectControls(l.fx, 'fx'))}
    ${commonGroups(l)}`;
}

/* 모든 요소가 함께 쓰는 그룹 */
function commonGroups(l) {
  return `
    ${group('그림자', `
      <label class="check"><input type="checkbox" data-path="shadow.show" ${l.shadow.show ? 'checked' : ''}><span>그림자 넣기</span></label>
      ${l.shadow.show ? `
        ${slider('불투명도', 'shadow.opacity', l.shadow.opacity, 0.05, 1, 0.01)}
        ${slider('번짐 범위', 'shadow.blur', l.shadow.blur, 0.002, 0.08, 0.001)}
        ${slider('빛 방향 °', 'shadow.angle', l.shadow.angle, 0, 359, 1, { cls: 'sun', reset: 'resetShadowAngle' })}
        <p class="block-note">해를 옮기면 그림자가 반대쪽으로 집니다. 0° 는 위쪽입니다.</p>` : ''}`)}

    ${group('회전', slider('각도 °', 'rot', (l.rot * 180) / Math.PI, -180, 180, 1,
      { reset: 'resetRot', scale: Math.PI / 180 }))}

    ${group('캔버스 기준 정렬', `
      <div class="seg">
        <button class="seg-btn" data-action="alignX" type="button">가로 중앙</button>
        <button class="seg-btn" data-action="alignY" type="button">세로 중앙</button>
        <button class="seg-btn" data-action="alignXY" type="button">정중앙</button>
      </div>`)}

    ${group('순서', `
      <div class="field-row">
        <button class="btn" data-action="front" type="button">맨 앞으로</button>
        <button class="btn" data-action="back" type="button">맨 뒤로</button>
      </div>
      <button class="btn btn-ghost" data-action="deleteLayer" type="button">삭제</button>`)}`;
}

const title = (text) => `<div class="prop-title">${text}</div>`;

/* 제목이 있는 묶음은 접을 수 있고, 열고 닫은 상태를 기억한다. */
const openGroups = new Set(['글자 모양', '종류', '채우기', '크기', '효과']);

const group = (heading, body) => {
  if (!heading) return `<div class="prop-group">${body}</div>`;
  return `<details class="prop-group"${openGroups.has(heading) ? ' open' : ''}>
    <summary class="prop-sub">${heading}</summary>
    <div class="prop-body">${body}</div>
  </details>`;
};

/* toggle 은 버블링하지 않으므로 캡처 단계에서 받는다. */
function trackGroupToggles(container) {
  container.addEventListener('toggle', (e) => {
    const details = e.target;
    if (!details.classList?.contains('prop-group')) return;
    const key = details.querySelector('summary')?.textContent;
    if (!key) return;
    if (details.open) openGroups.add(key);
    else openGroups.delete(key);
  }, true);
}

/* opts.reset: 초기화 버튼의 action 이름
   opts.scale: 화면 값 × scale = 상태에 저장할 값 (회전은 도로 보여주고 라디안으로 저장) */
function slider(label, path, value, min, max, step, opts = {}) {
  const head = opts.reset
    ? `<span class="slider-head">
         <span class="slider-label">${label}</span>
         <button class="mini-btn" data-action="${opts.reset}" type="button">초기화</button>
       </span>`
    : label ? `<span class="slider-label">${label}</span>` : '';
  const scale = opts.scale ? ` data-scale="${opts.scale}"` : '';
  const attrs = `data-path="${path}" data-num="1"${scale} min="${min}" max="${max}" step="${step}"`;
  const cls = opts.cls ? ` class="${opts.cls}"` : '';
  return `<div class="slider">${head}
    <span class="slider-row">
      <input type="range"${cls} ${attrs} value="${value}">
      <input type="number" class="num" ${attrs} value="${fmt(value, step)}">
    </span>
  </div>`;
}

/* 한 줄 안의 슬라이더와 숫자 입력은 같은 값을 가리키므로 서로 맞춰준다. */
function syncSliderRow(source, value) {
  const row = source.closest('.slider-row');
  if (!row) return;
  for (const twin of row.querySelectorAll('[data-path]')) {
    if (twin === source || document.activeElement === twin) continue;
    twin.value = twin.type === 'range' ? value : fmt(value, Number(twin.step) || 1);
    if (twin.type === 'range') paintRange(twin);
  }
}

const fmt = (v, step) => {
  const s = Number(step);
  if (s >= 1) return String(Math.round(v));
  return Number(v).toFixed(s < 0.01 ? 3 : 2);
};

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/* ── 속성 입력 처리 ──────────────────────── */

function propTarget() {
  const sel = state.selection;
  if (!sel) return null;
  return sel.kind === 'cell' ? state.photos[sel.index] : selectedLayer();
}

/* 캔버스 전체 효과와 배경 무늬는 고른 사진이 아니라 state 에 저장한다. */
const STATE_PATHS = ['canvasFx.', 'bgPattern.'];
const targetFor = (path) => (STATE_PATHS.some((p) => path.startsWith(p)) ? state : propTarget());

function onPropInput(e) {
  const el = e.target.closest('[data-path]');
  if (!el) return;
  const target = targetFor(el.dataset.path);
  if (!target) return;

  // HEX 입력은 유효할 때만 반영하고 옆 견본을 맞춘다.
  if (el.dataset.hex) {
    const hex = normalizeHex(el.value);
    el.classList.toggle('is-invalid', !hex);
    if (!hex) return;
    setPath(target, el.dataset.path, hex);
    const swatch = el.parentElement.querySelector('input[type="color"]');
    if (swatch) swatch.value = hex;
    render();
    return;
  }

  const raw = el.type === 'checkbox' ? el.checked : el.value;
  const value = el.dataset.num ? Number(raw) : raw;

  // 숫자 칸은 타이핑 도중 범위를 벗어난 값이 잠깐 생긴다. 그때는 반영하지 않고 기다린다.
  if (el.classList.contains('num')) {
    if (raw === '' || Number.isNaN(value)) return;
    if (value < Number(el.min) || value > Number(el.max)) return;
  }

  setPath(target, el.dataset.path, el.dataset.scale ? value * Number(el.dataset.scale) : value);

  if (el.type === 'color') {
    const hexInput = el.parentElement.querySelector('.hex');
    if (hexInput) {
      hexInput.value = el.value.toUpperCase();
      hexInput.classList.remove('is-invalid');
    }
  }

  syncSliderRow(el, value);

  // 폰트를 바꾸면 없는 굵기는 쓸 수 있는 값으로 되돌린다.
  if (el.dataset.path === 'font') {
    const f = findFont(target.font);
    if (!f.weights.includes(target.weight)) {
      target.weight = f.weights.includes(400) ? 400 : f.weights[0];
    }
    render();
    refreshProps(true);
    return;
  }

  applyDerived(target, el.dataset.path);
  // 비율을 잠갔으면 반대쪽 칸도 방금 바뀌었다. 화면에 반영한다.
  if (target.lockRatio && (el.dataset.path === 'w' || el.dataset.path === 'h')) syncPropOutputs();

  render();
  // 체크박스는 보통 하위 옵션이 열리고 닫히므로 패널을 다시 만든다.
  // 스위치처럼 패널이 그대로인 것은 둬야 켜지는 모습이 끝까지 보인다.
  if (el.type === 'checkbox' && !el.dataset.keep) refreshProps(true);
  refreshLayerList();
}

/* 값 하나를 바꾸면 따라 움직여야 하는 것들 */
function applyDerived(target, path) {
  if (target === state) {
    // 배경 사진은 캔버스를 덮는 범위 밖으로 나가지 않게 잡아 둔다.
    if (path.startsWith('bgPattern.')) {
      const { W, H } = getLayout();
      clampBgPan(W, H);
    }
    return;
  }
  if (state.selection?.kind === 'cell') {
    // 자유 배치에서 틀 크기를 바꾼 직후에는 아직 다시 그리기 전이라 칸이 옛 값이다.
    // 그래서 방금 넣은 틀 크기를 바로 보고 이동 한계를 건다.
    clampPan(target, target.free && state.mode === 'free'
      ? { x: 0, y: 0, w: target.free.w, h: target.free.h }
      : getLayout().rects[state.selection.index]);
  }
  if (target.type === 'shape' || target.type === 'sticker') {
    if (path === 'w' && target.type === 'sticker') {
      target.h = target.w * (target.img.height / target.img.width);
    }
    // 비율을 잠그는 순간의 모양을 기억했다가, 한쪽을 바꾸면 다른 쪽을 맞춰 준다.
    if (target.type === 'shape') {
      if (path === 'lockRatio') target._ratio = target.h / target.w;
      else if (target.lockRatio) {
        const k = target._ratio || 1;
        if (path === 'w') target.h = Math.max(20, target.w * k);
        else if (path === 'h') target.w = Math.max(20, target.h / k);
      }
    }
    target._w = target.w;
    target._h = target.h;
  }
}

/* 숫자 칸에서 손을 뗐을 때 범위 안으로 정리한다. */
function onNumCommit(e) {
  const el = e.target.closest('.num[data-path]');
  if (!el) return;
  const target = targetFor(el.dataset.path);
  if (!target) return;

  const min = Number(el.min);
  const max = Number(el.max);
  let v = Number(el.value);
  if (el.value === '' || Number.isNaN(v)) {
    const stored = getPath(target, el.dataset.path);
    v = el.dataset.scale ? stored / Number(el.dataset.scale) : stored;
  }
  v = Math.min(max, Math.max(min, v));

  el.value = fmt(v, Number(el.step) || 1);
  setPath(target, el.dataset.path, el.dataset.scale ? v * Number(el.dataset.scale) : v);
  syncSliderRow(el, v);
  applyDerived(target, el.dataset.path);
  if (target.lockRatio && (el.dataset.path === 'w' || el.dataset.path === 'h')) syncPropOutputs();
  render();
  refreshLayerList();
}

function onPropClick(e, actions) {
  const modeBtn = e.target.closest('[data-fxmode]');
  if (modeBtn) {
    state.fxMode = modeBtn.dataset.fxmode;
    render();                 // 개별 효과와 전체 효과가 서로 자리를 바꾼다
    refreshProps(true);
    refreshPhotoFx(true);
    return;
  }

  const setBtn = e.target.closest('[data-set]');
  const toggleBtn = e.target.closest('[data-toggle]');
  const actionBtn = e.target.closest('[data-action]');
  const target = propTarget();

  if (setBtn) {
    const owner = targetFor(setBtn.dataset.set);
    if (!owner) return;
    const raw = setBtn.dataset.value;
    setPath(owner, setBtn.dataset.set, setBtn.dataset.num ? Number(raw) : raw);
    render();
    refreshProps(true);
    refreshPhotoFx(true);
    refreshBgProps(true);
    refreshLayerList();
    return;
  }
  if (toggleBtn && target) {
    setPath(target, toggleBtn.dataset.toggle, !getPath(target, toggleBtn.dataset.toggle));
    render();
    refreshProps(true);
    return;
  }
  if (!actionBtn) return;

  const act = actionBtn.dataset.action;
  if (act === 'webfontAdd') return void applyWebFont();

  // 배경 무늬는 고른 대상이 없어도 손댈 수 있다.
  if (act === 'bgPatternImage') return void actions.pickBgPattern();
  if (act === 'resetBgPattern') {
    // 고른 사진은 그대로 두고, 이 무늬의 생김새 값만 되돌린다.
    Object.assign(bgOpts(), BG_DEFAULTS[state.bgPattern.kind] || {});
    render();
    refreshBgProps(true);
    return;
  }

  const sel = state.selection;
  if (!sel) return;

  if (act === 'fillCell') return actions.fillCell(sel.index);
  if (act === 'resetPan' && target) { target.panX = 0; target.panY = 0; target.zoom = 1; update(); return; }
  if (act === 'rotate90' && target) {
    target.rot90 = ((target.rot90 || 0) + 1) & 3;
    // 원본 그대로 모드에서는 칸 모양까지 바뀌므로, 새 칸을 잡은 뒤에 이동 한계를 다시 건다.
    render();
    clampPan(target, getLayout().rects[sel.index]);
    update();
    return;
  }
  if (act === 'resetRot' && target) { target.rot = 0; render(); refreshProps(true); return; }
  if (act === 'resetFreeRot' && target?.free) { target.free.rot = 0; render(); refreshProps(true); return; }
  if (act === 'fitFreeBox' && target?.free) {
    // 틀 가로를 그대로 두고, 사진 원본 비율에 맞춰 세로만 다시 잡는다.
    const { w, h } = photoSize(target);
    target.free.h = target.free.w * (h / w);
    update();
    return;
  }
  if ((act === 'photoFront' || act === 'photoBack') && sel.kind === 'cell') {
    movePhoto(sel.index, act === 'photoFront' ? state.photos.length - 1 : 0);
    update();
    return;
  }
  if (act === 'resetShadowAngle' && target) { target.shadow.angle = 0; render(); refreshProps(true); return; }
  if (act === 'removePhoto') {
    // 템플릿 모드에서는 뒤 사진이 앞으로 밀리지 않도록 자리만 비운다.
    if (state.mode === 'template') state.photos[sel.index] = null;
    else state.photos.splice(sel.index, 1);
    state.selection = null;
    update();
    return;
  }
  if (act === 'deleteLayer') { removeLayer(sel.id); update(); return; }

  if (act.startsWith('align') && target) {
    const { W, H } = getLayout();
    if (act !== 'alignY') target.cx = W / 2;
    if (act !== 'alignX') target.cy = H / 2;
    update();
    return;
  }

  if (act === 'front' || act === 'back') {
    const i = state.layers.findIndex((l) => l.id === sel.id);
    if (i < 0) return;
    const [layer] = state.layers.splice(i, 1);
    if (act === 'front') state.layers.push(layer);
    else state.layers.unshift(layer);
    update();
  }
}

function syncPropOutputs() {
  const all = [propsEl, photoPropsEl, photoFxEl, bgPropsEl]
    .flatMap((root) => [...root.querySelectorAll('[data-path]')]);
  for (const el of all) {
    const target = targetFor(el.dataset.path);
    if (!target) continue;
    const stored = getPath(target, el.dataset.path);
    if (stored === undefined) continue;
    const v = el.dataset.scale ? stored / Number(el.dataset.scale) : stored;
    if (el.type === 'checkbox') el.checked = !!stored;
    else if (document.activeElement !== el) el.value = el.dataset.hex ? String(v).toUpperCase() : v;
    if (el.type === 'range') paintRange(el);
    const out = el.parentElement?.querySelector('output');
    if (out) out.textContent = fmt(v, Number(el.step) || 1);
  }
}

/* 마우스 조작 뒤 슬라이더 값을 화면과 맞춘다. */
export function syncFromCanvas() {
  syncPropOutputs();
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/* ── 레이어 목록 ─────────────────────────── */

const KIND_MARK = { text: 'T', shape: '◻', sticker: '▣' };

/* 순서를 바꾸는 중에는 목록을 다시 만들지 않는다. */
let reorder = null;

export function refreshLayerList() {
  if (reorder?.moved) return;

  if (!state.layers.length) {
    layerListEl.innerHTML = '<li class="layers-empty">추가한 요소가 없습니다.</li>';
    return;
  }
  layerListEl.innerHTML = '';
  // 위에 그려진 것이 목록 위로 오도록 뒤집는다.
  [...state.layers].reverse().forEach((l) => {
    const li = document.createElement('li');
    const active = state.selection?.kind === 'layer' && state.selection.id === l.id;
    li.className = 'layer-item' + (active ? ' is-active' : '');
    li.dataset.id = l.id;
    li.innerHTML = `
      <span class="layer-kind">${KIND_MARK[l.type]}</span>
      <span class="layer-name">${escapeHtml(layerName(l))}</span>
      <button class="layer-act" data-dup="${l.id}" type="button" title="복제">⧉</button>
      <button class="layer-act" data-del="${l.id}" type="button" title="삭제">✕</button>`;
    layerListEl.appendChild(li);
  });
}

function layerName(l) {
  if (l.type === 'text') return (l.text || '텍스트').split('\n')[0].slice(0, 24) || '텍스트';
  if (l.type === 'shape') return shapeLabel(l.shape);
  return '스티커';
}

/* 목록을 끌어서 앞뒤 순서를 바꾼다. 끄는 줄은 그대로 두고 나머지가 밀려난다. */
export function initLayerReorder() {
  layerListEl.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { removeLayer(Number(del.dataset.del)); update(); return; }
    const dup = e.target.closest('[data-dup]');
    if (dup) {
      const copy = duplicateLayer(Number(dup.dataset.dup));
      if (copy) state.selection = { kind: 'layer', id: copy.id };
      update();
    }
  });

  layerListEl.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.layer-act')) return;
    const li = e.target.closest('.layer-item');
    if (!li) return;

    const rows = [...layerListEl.querySelectorAll('.layer-item')];
    const index = rows.indexOf(li);
    const step = rows.length > 1
      ? rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top
      : li.getBoundingClientRect().height + 2;

    reorder = { rows, index, target: index, startY: e.clientY, step, li, moved: false };
    // 포인터가 목록 밖으로 나가도 계속 따라오게 한다.
    try { layerListEl.setPointerCapture(e.pointerId); } catch { /* 합성 이벤트 등 */ }
  });

  layerListEl.addEventListener('pointermove', (e) => {
    if (!reorder) return;
    const dy = e.clientY - reorder.startY;
    if (!reorder.moved) {
      if (Math.abs(dy) < 4) return;
      reorder.moved = true;
      reorder.li.classList.add('is-dragging');
      layerListEl.classList.add('is-reordering');
    }
    reorder.li.style.transform = `translateY(${dy}px)`;

    const target = Math.max(0, Math.min(
      reorder.rows.length - 1,
      reorder.index + Math.round(dy / reorder.step),
    ));
    if (target !== reorder.target) {
      reorder.target = target;
      shiftRows();
    }
  });

  const finish = () => {
    if (!reorder) return;
    const { moved, index, target, li, rows } = reorder;

    if (!moved) {
      state.selection = { kind: 'layer', id: Number(li.dataset.id) };
      reorder = null;
      update();
      return;
    }

    // 화면은 위가 앞이므로 뒤집힌 순서에서 옮긴 뒤 되돌린다.
    const display = [...state.layers].reverse();
    const [layer] = display.splice(index, 1);
    display.splice(target, 0, layer);
    state.layers = display.reverse();

    li.classList.remove('is-dragging');
    layerListEl.classList.remove('is-reordering');
    for (const row of rows) row.style.transform = '';
    reorder = null;
    update();
  };

  layerListEl.addEventListener('pointerup', finish);
  layerListEl.addEventListener('pointercancel', finish);
}

function shiftRows() {
  const { rows, index, target, step, li } = reorder;
  rows.forEach((row, i) => {
    if (row === li) return;
    let shift = 0;
    if (index < target && i > index && i <= target) shift = -step;
    else if (index > target && i >= target && i < index) shift = step;
    row.style.transform = shift ? `translateY(${shift}px)` : '';
  });
}

/* ── 작은 도우미 ─────────────────────────── */

function segment(wrap, key, onPick) {
  wrap.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn || btn.disabled) return;
    markActive(wrap, '.seg-btn', (el) => el === btn);
    onPick(btn.dataset[key]);
  });
}

/* 슬라이더와 그 옆 숫자 칸을 하나로 묶는다. */
function rangeControl(range, num, onInput) {
  const min = Number(range.min);
  const max = Number(range.max);

  range.addEventListener('input', () => {
    num.value = range.value;
    onInput(Number(range.value));
  });

  num.addEventListener('input', () => {
    const v = Number(num.value);
    if (num.value === '' || Number.isNaN(v) || v < min || v > max) return;
    range.value = v;
    paintRange(range);
    onInput(v);
  });

  num.addEventListener('change', () => {
    const v = Math.min(max, Math.max(min, Number(num.value) || min));
    num.value = v;
    range.value = v;
    paintRange(range);
    onInput(v);
  });
}

function markActive(wrap, sel, test) {
  wrap.querySelectorAll(sel).forEach((el) => el.classList.toggle('is-active', test(el)));
}
