/* 좌/우 패널 UI. 상태를 바꾸고 다시 그리도록 요청한다. */

import {
  state, RATIOS, TEMPLATES, FONTS, KIND_LABEL, WEIGHT_LABEL, findFont,
  template, selectedLayer, removeLayer, resizeCanvas, applyRatio,
} from './state.js';
import { render, getLayout } from './render.js';
import { clampPan } from './geometry.js';

const $ = (id) => document.getElementById(id);
const propsEl = $('props');
const photoPropsEl = $('photoProps');
const layerListEl = $('layerList');

/* ── 슬라이더 채움 표시 ──────────────────── */

export function paintRange(el) {
  const min = Number(el.min) || 0;
  const max = Number(el.max);
  const v = Number(el.value);
  const pct = max === min ? 0 : ((v - min) / (max - min)) * 100;
  el.style.setProperty('--pct', `${Math.max(0, Math.min(100, pct))}%`);
}

export function paintAllRanges(root = document) {
  root.querySelectorAll('input[type="range"]').forEach(paintRange);
}

document.addEventListener('input', (e) => {
  if (e.target.type === 'range') paintRange(e.target);
}, true);

/* ── 전체 갱신 ───────────────────────────── */

export const photoCount = () => state.photos.filter(Boolean).length;

export function update() {
  render();
  refreshProps();
  refreshLayerList();
  refreshMeta();
}

function refreshMeta() {
  const { W, H } = getLayout();
  $('sizeReadout').textContent =
    `${W} × ${H} px · 사진 ${photoCount()}장 · 요소 ${state.layers.length}개`;
  $('windowMeta').textContent = state.mode === 'template'
    ? `${state.ratioId} · ${W} × ${H}`
    : `원본 비율 · ${state.direction === 'h' ? '가로' : '세로'} · ${W} × ${H}`;
  if (state.mode === 'template') updateTemplateNote();
}

/* ── 왼쪽 패널 ───────────────────────────── */

export function initLeftPanel(actions) {
  buildRatioChips();
  buildTemplates();

  segment($('modeSeg'), 'mode', (v) => {
    state.mode = v;
    state.selection = null;
    // 원본 비율 모드에는 빈 칸 개념이 없으므로 빈 자리를 눌러 없앤다.
    if (v === 'auto') state.photos = state.photos.filter(Boolean);
    syncModeBlocks();
    update();
  });

  segment($('dirSeg'), 'dir', (v) => { state.direction = v; update(); });

  // 비율·크기는 입력을 마쳤을 때 반영한다(타이핑 중간값으로 튀지 않게).
  $('ratioW').addEventListener('change', onRatioInput);
  $('ratioH').addEventListener('change', onRatioInput);
  $('pxW').addEventListener('change', (e) => { resizeCanvas('w', Number(e.target.value)); syncCanvasFields(); update(); });
  $('pxH').addEventListener('change', (e) => { resizeCanvas('h', Number(e.target.value)); syncCanvasFields(); update(); });

  rangeControl($('gap'), $('gapOut'), (v) => { state.gap = v; update(); });
  $('marginOn').addEventListener('change', (e) => { state.margin = e.target.checked; update(); });

  $('borderOn').addEventListener('change', (e) => {
    state.border.show = e.target.checked;
    $('borderOpts').classList.toggle('is-hidden', !e.target.checked);
    update();
  });

  rangeControl($('borderW'), $('borderWOut'), (v) => { state.border.width = v; update(); });
  $('borderColor').addEventListener('input', (e) => { state.border.color = e.target.value; update(); });
  $('borderOuter').addEventListener('change', (e) => { state.border.outer = e.target.checked; update(); });
  $('bgColor').addEventListener('input', (e) => { state.bg = e.target.value; update(); });

  $('addPhoto').addEventListener('click', actions.addPhoto);

  photoPropsEl.addEventListener('input', onPropInput);
  photoPropsEl.addEventListener('click', (e) => onPropClick(e, actions));

  syncModeBlocks();
  syncCanvasFields();
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
  $('ratioW').value = state.ratio.w;
  $('ratioH').value = state.ratio.h;
  $('pxW').value = state.canvasW;
  $('pxH').value = state.canvasH;
}

function syncModeBlocks() {
  const isTemplate = state.mode === 'template';
  $('autoBlock').classList.toggle('is-hidden', isTemplate);
  $('ratioBlock').classList.toggle('is-hidden', !isTemplate);
  $('templateBlock').classList.toggle('is-hidden', !isTemplate);
  if (isTemplate) updateTemplateNote();
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
  for (const r of RATIOS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (r.id === state.ratioId ? ' is-active' : '');
    b.dataset.ratio = r.id;
    b.textContent = r.id;
    b.addEventListener('click', () => {
      applyRatio(r.w, r.h);
      markActive(wrap, '.chip', (el) => el.dataset.ratio === r.id);
      syncCanvasFields();
      update();
    });
    wrap.appendChild(b);
  }
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
  $('addSticker').addEventListener('click', actions.addSticker);
  $('addText').addEventListener('click', actions.addText);
  $('addRect').addEventListener('click', () => actions.addShape('rect'));
  $('addCircle').addEventListener('click', () => actions.addShape('circle'));
  $('exportBtn').addEventListener('click', actions.exportImage);
  $('resetBtn').addEventListener('click', actions.reset);

  segment($('formatSeg'), 'format', (v) => {
    state.exportFormat = v;
    $('qualityWrap').classList.toggle('is-hidden', v === 'png');
  });

  rangeControl($('quality'), $('qualityOut'), (v) => { state.quality = v / 100; });

  propsEl.addEventListener('input', onPropInput);
  propsEl.addEventListener('click', (e) => onPropClick(e, actions));
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
    return `${title('빈 칸')}
      <p class="block-note">이 칸에 넣을 사진을 고르세요.</p>
      <button class="btn" data-action="fillCell" type="button">사진 넣기</button>`;
  }
  return `${title('선택한 칸')}
    ${slider('확대', 'zoom', photo.zoom, 1, 4, 0.01)}
    <div class="field-row">
      <button class="btn" data-action="fillCell" type="button">교체</button>
      <button class="btn" data-action="resetPan" type="button">맞춤</button>
    </div>
    <button class="btn btn-ghost" data-action="removePhoto" type="button">이 사진 빼기</button>`;
}

function layerProps(l) {
  if (!l) return emptyHint();
  if (l.type === 'text') return textProps(l);
  if (l.type === 'shape') return shapeProps(l);
  return stickerProps(l);
}

/* ── 텍스트 ──────────────────────────────── */

function fontOptions(current) {
  return ['sans', 'serif'].map((kind) => {
    const opts = FONTS.filter((f) => f.kind === kind)
      .map((f) => `<option value="${f.id}" ${f.id === current ? 'selected' : ''}>${f.label}</option>`)
      .join('');
    return `<optgroup label="${KIND_LABEL[kind]}">${opts}</optgroup>`;
  }).join('');
}

function weightSeg(l) {
  const font = findFont(l.font);
  const btns = [300, 400, 700].map((w) => {
    const has = font.weights.includes(w);
    return `<button class="seg-btn ${l.weight === w ? 'is-active' : ''}"
      data-set="weight" data-value="${w}" data-num="1" ${has ? '' : 'disabled'}
      type="button">${WEIGHT_LABEL[w]}</button>`;
  }).join('');
  return `<div class="seg">${btns}</div>`;
}

function textProps(l) {
  return `${title('텍스트')}
    <textarea data-path="text" rows="3">${escapeHtml(l.text)}</textarea>
    <label class="field"><span>폰트</span>
      <select data-path="font">${fontOptions(l.font)}</select>
    </label>
    ${weightSeg(l)}
    <div class="icon-row">
      <button class="icon-btn i-italic ${l.italic ? 'is-active' : ''}" data-toggle="italic" type="button">I</button>
      <span class="spacer"></span>
      ${['left', 'center', 'right'].map((a) => `
        <button class="icon-btn ${l.align === a ? 'is-active' : ''}" data-set="align" data-value="${a}" type="button">${a === 'left' ? '⇤' : a === 'right' ? '⇥' : '↔'}</button>`).join('')}
    </div>
    ${slider('크기', 'size', l.size, 12, 400, 1)}
    ${slider('자간', 'letterSpacing', l.letterSpacing, -0.05, 0.4, 0.005)}
    ${slider('행간', 'lineHeight', l.lineHeight, 0.9, 2.4, 0.05)}
    <label class="field field-color"><span>글자색</span><input type="color" data-path="color" value="${l.color}"></label>

    <h3 class="block-title">글자 배경</h3>
    <div class="seg">
      ${[['none', '없음'], ['solid', '단색'], ['glass', '글래스']].map(([v, t]) => `
        <button class="seg-btn ${l.bg.mode === v ? 'is-active' : ''}" data-set="bg.mode" data-value="${v}" type="button">${t}</button>`).join('')}
    </div>
    ${l.bg.mode === 'none' ? '' : `
      <label class="field field-color"><span>${l.bg.mode === 'glass' ? '유리 색조' : '배경색'}</span><input type="color" data-path="bg.color" value="${l.bg.color}"></label>
      ${slider('불투명도', 'bg.opacity', l.bg.opacity, 0.05, 1, 0.01)}
      ${slider('여백 가로', 'bg.padX', l.bg.padX, 0, 2, 0.05)}
      ${slider('여백 세로', 'bg.padY', l.bg.padY, 0, 2, 0.05)}
      ${slider('모서리', 'bg.radius', l.bg.radius, 0, 0.5, 0.01)}`}
    ${commonProps(l)}`;
}

/* ── 도형 ────────────────────────────────── */

function shapeProps(l) {
  const grad = l.fill.mode === 'gradient';
  return `${title(l.shape === 'circle' ? '원' : '사각형')}
    <div class="seg">
      ${[['solid', '단색'], ['gradient', '그라데이션'], ['glass', '글래스']].map(([v, t]) => `
        <button class="seg-btn ${l.fill.mode === v ? 'is-active' : ''}" data-set="fill.mode" data-value="${v}" type="button">${t}</button>`).join('')}
    </div>
    <label class="field field-color"><span>${grad ? '시작 색' : '색상'}</span><input type="color" data-path="fill.c1" value="${l.fill.c1}"></label>
    ${grad ? `
      ${slider('시작 투명도', 'fill.a1', l.fill.a1, 0, 1, 0.01)}
      <label class="field field-color"><span>끝 색</span><input type="color" data-path="fill.c2" value="${l.fill.c2}"></label>
      ${slider('끝 투명도', 'fill.a2', l.fill.a2, 0, 1, 0.01)}
      ${slider('각도', 'fill.angle', l.fill.angle, 0, 360, 1)}` : ''}
    ${slider('불투명도', 'fill.opacity', l.fill.opacity, 0.05, 1, 0.01)}
    ${l.shape === 'rect' ? slider('모서리', 'radius', l.radius, 0, 0.5, 0.01) : ''}
    ${slider('가로', 'w', l.w, 20, 4000, 1)}
    ${slider('세로', 'h', l.h, 20, 4000, 1)}
    <label class="check"><input type="checkbox" data-path="stroke.show" ${l.stroke.show ? 'checked' : ''}><span>외곽선</span></label>
    ${l.stroke.show ? `
      <label class="field field-color"><span>선 색상</span><input type="color" data-path="stroke.color" value="${l.stroke.color}"></label>
      ${slider('선 굵기', 'stroke.width', l.stroke.width, 1, 60, 1)}` : ''}
    ${commonProps(l)}`;
}

function stickerProps(l) {
  return `${title('스티커 사진')}
    ${slider('크기', 'w', l.w, 40, 6000, 1)}
    <label class="check"><input type="checkbox" data-path="outline.show" ${l.outline.show ? 'checked' : ''}><span>아웃라인 (투명 배경이면 피사체 윤곽을 따라감)</span></label>
    ${l.outline.show ? `
      <label class="field field-color"><span>선 색상</span><input type="color" data-path="outline.color" value="${l.outline.color}"></label>
      ${slider('선 굵기', 'outline.width', l.outline.width, 1, 80, 1)}` : ''}
    <label class="check"><input type="checkbox" data-path="shadow" ${l.shadow ? 'checked' : ''}><span>그림자</span></label>
    ${commonProps(l)}`;
}

function commonProps(l) {
  return `${slider('회전', 'rot', l.rot, -Math.PI, Math.PI, 0.01)}
    <div class="field-row">
      <button class="btn" data-action="front" type="button">맨 앞으로</button>
      <button class="btn" data-action="back" type="button">맨 뒤로</button>
    </div>
    <button class="btn btn-ghost" data-action="deleteLayer" type="button">삭제</button>`;
}

const title = (text) => `<div class="prop-title">${text}</div>`;

function slider(label, path, value, min, max, step) {
  return `<label class="slider">
    <span class="slider-label">${label}</span>
    <span class="slider-row">
      <input type="range" data-path="${path}" data-num="1" min="${min}" max="${max}" step="${step}" value="${value}">
      <output>${fmt(value, step)}</output>
    </span>
  </label>`;
}

const fmt = (v, step) => (step >= 1 ? Math.round(v) : Number(v).toFixed(2));

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/* ── 속성 입력 처리 ──────────────────────── */

function propTarget() {
  const sel = state.selection;
  if (!sel) return null;
  return sel.kind === 'cell' ? state.photos[sel.index] : selectedLayer();
}

function onPropInput(e) {
  const el = e.target.closest('[data-path]');
  if (!el) return;
  const target = propTarget();
  if (!target) return;

  const raw = el.type === 'checkbox' ? el.checked : el.value;
  const value = el.dataset.num ? Number(raw) : raw;
  setPath(target, el.dataset.path, value);

  const out = el.parentElement?.querySelector('output');
  if (out) out.textContent = fmt(value, Number(el.step) || 1);

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

  if (state.selection.kind === 'cell') {
    clampPan(target, getLayout().rects[state.selection.index]);
  }
  if (target.type === 'shape' || target.type === 'sticker') {
    if (el.dataset.path === 'w' && target.type === 'sticker') {
      target.h = target.w * (target.img.height / target.img.width);
    }
    target._w = target.w;
    target._h = target.h;
  }

  render();
  // 체크박스는 하위 옵션이 열리고 닫히므로 패널을 다시 만든다.
  if (el.type === 'checkbox') refreshProps(true);
  refreshLayerList();
}

function onPropClick(e, actions) {
  const setBtn = e.target.closest('[data-set]');
  const toggleBtn = e.target.closest('[data-toggle]');
  const actionBtn = e.target.closest('[data-action]');
  const target = propTarget();

  if (setBtn && target) {
    const raw = setBtn.dataset.value;
    setPath(target, setBtn.dataset.set, setBtn.dataset.num ? Number(raw) : raw);
    render();
    refreshProps(true);
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
  const sel = state.selection;
  if (!sel) return;

  if (act === 'fillCell') return actions.fillCell(sel.index);
  if (act === 'resetPan' && target) { target.panX = 0; target.panY = 0; target.zoom = 1; update(); return; }
  if (act === 'removePhoto') {
    // 템플릿 모드에서는 뒤 사진이 앞으로 밀리지 않도록 자리만 비운다.
    if (state.mode === 'template') state.photos[sel.index] = null;
    else state.photos.splice(sel.index, 1);
    state.selection = null;
    update();
    return;
  }
  if (act === 'deleteLayer') { removeLayer(sel.id); update(); return; }
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
  const target = propTarget();
  if (!target) return;
  for (const el of [...propsEl.querySelectorAll('[data-path]'), ...photoPropsEl.querySelectorAll('[data-path]')]) {
    const v = getPath(target, el.dataset.path);
    if (v === undefined) continue;
    if (el.type === 'checkbox') el.checked = !!v;
    else if (document.activeElement !== el) el.value = v;
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

export function refreshLayerList() {
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
    li.innerHTML = `
      <span class="layer-kind">${KIND_MARK[l.type]}</span>
      <span class="layer-name">${escapeHtml(layerName(l))}</span>
      <button class="layer-act" data-del="${l.id}" type="button" title="삭제">✕</button>`;
    li.addEventListener('click', (e) => {
      if (e.target.dataset.del) { removeLayer(l.id); update(); return; }
      state.selection = { kind: 'layer', id: l.id };
      update();
    });
    layerListEl.appendChild(li);
  });
}

function layerName(l) {
  if (l.type === 'text') return (l.text || '텍스트').split('\n')[0].slice(0, 24) || '텍스트';
  if (l.type === 'shape') return l.shape === 'circle' ? '원' : '사각형';
  return '스티커 사진';
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

function rangeControl(input, out, onInput) {
  input.addEventListener('input', () => {
    out.textContent = input.value;
    onInput(Number(input.value));
  });
}

function markActive(wrap, sel, test) {
  wrap.querySelectorAll(sel).forEach((el) => el.classList.toggle('is-active', test(el)));
}
