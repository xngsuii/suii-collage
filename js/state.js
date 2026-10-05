/* 상태와 상수 정의. 다른 모듈은 여기서 state를 읽고 쓴다. */

import { newFx, cloneFx, clearFxCache } from 'app/effects.js';

export const RATIOS = [
  { id: '1:1',  w: 1,  h: 1  },
  { id: '4:5',  w: 4,  h: 5  },
  { id: '5:4',  w: 5,  h: 4  },
  { id: '9:16', w: 9,  h: 16 },
  { id: '16:9', w: 16, h: 9  },
  { id: '3:4',  w: 3,  h: 4  },
  { id: '4:3',  w: 4,  h: 3  },
];

/* 템플릿 칸은 0..1 상대 좌표 [x, y, w, h] */
export const TEMPLATES = [
  { id: '1',       cells: [[0, 0, 1, 1]] },
  { id: '2v',      cells: [[0, 0, .5, 1], [.5, 0, .5, 1]] },
  { id: '2h',      cells: [[0, 0, 1, .5], [0, .5, 1, .5]] },
  { id: '3v',      cells: [[0, 0, 1/3, 1], [1/3, 0, 1/3, 1], [2/3, 0, 1/3, 1]] },
  { id: '3h',      cells: [[0, 0, 1, 1/3], [0, 1/3, 1, 1/3], [0, 2/3, 1, 1/3]] },
  { id: 'grid4',   cells: [[0, 0, .5, .5], [.5, 0, .5, .5], [0, .5, .5, .5], [.5, .5, .5, .5]] },
  { id: 'bigTop',  cells: [[0, 0, 1, .6], [0, .6, .5, .4], [.5, .6, .5, .4]] },
  { id: 'bigLeft', cells: [[0, 0, .6, 1], [.6, 0, .4, .5], [.6, .5, .4, .5]] },
  { id: 'bigBtm',  cells: [[0, 0, .5, .4], [.5, 0, .5, .4], [0, .4, 1, .6]] },
  { id: 'l5',      cells: [[0, 0, .6, .5], [.6, 0, .4, .5], [0, .5, .4, .5], [.4, .5, .3, .5], [.7, .5, .3, .5]] },
  { id: 'grid6',   cells: Array.from({ length: 6 }, (_, i) => [(i % 3) / 3, Math.floor(i / 3) / 2, 1/3, 1/2]) },
  { id: 'grid9',   cells: Array.from({ length: 9 }, (_, i) => [(i % 3) / 3, Math.floor(i / 3) / 3, 1/3, 1/3]) },
];

/* 얹을 수 있는 도형. 예전에는 사각형·원을 따로 추가했지만 하나로 묶고 종류를 늘렸다. */
export const SHAPES = [
  { id: 'rect',     label: '사각형' },
  { id: 'circle',   label: '원' },
  { id: 'ring',     label: '속 빈 원' },
  { id: 'triangle', label: '삼각형' },
  { id: 'star',     label: '별' },
  { id: 'heart',    label: '하트' },
  { id: 'arrow',    label: '화살표' },
  { id: 'sparkle',  label: '스파클' },
];

export const shapeLabel = (id) => (SHAPES.find((s) => s.id === id) || SHAPES[0]).label;

/* 배경 무늬. 'none' 은 배경색만 쓴다는 뜻이고, 투명하게 두려면 state.bgOn 을 끈다.
   'pixel'·'halftone' 은 따로 고른 사진을 각각 모자이크와 망점으로 다시 찍는다. */
export const BG_PATTERNS = [
  { id: 'none',     label: '단색' },
  { id: 'grid',     label: '모눈' },
  { id: 'dot',      label: '도트' },
  { id: 'checker',  label: '체커' },
  { id: 'gingham',  label: '깅엄' },
  { id: 'gradient', label: '그라데이션' },
  { id: 'pixel',    label: '픽셀화' },
  { id: 'halftone', label: '하프톤' },
];

/* 가로세로를 비율에 묶지 않고 따로 정하는 상태. 비율 칩의 id 로도 쓴다. */
export const FREE_RATIO = 'free';

/* 무늬마다 '이 값이면 제 모양이 나온다' 싶은 기본값.
   값은 무늬마다 따로 들고 있으므로(state.bgPattern.by) 모눈을 만지작거려도
   도트로 넘어가면 도트가 쓰던 값이 그대로 남아 있다.
   '기본값으로' 버튼은 그 무늬 칸만 이 표로 덮어쓴다. 고른 사진(img)은 함께 쓴다. */
const BG_BASE = {
  size: 40, weight: 0.5, angle: 0, color: '#1f6b70', opacity: 1,
  x: 0, y: 0, zoom: 1, tint: 0, brightness: 0, contrast: 0,
};

export const BG_DEFAULTS = {
  grid:     { ...BG_BASE, size: 50, weight: 0.10 },
  dot:      { ...BG_BASE, size: 40, weight: 0.30 },
  checker:  { ...BG_BASE, size: 50 },
  gingham:  { ...BG_BASE, size: 40 },
  gradient: { ...BG_BASE, angle: 90 },
  pixel:    { ...BG_BASE, size: 15, weight: 1 },
  halftone: { ...BG_BASE, size: 15 , angle: 20 },
};

/* weights 에 없는 굵기는 고를 수 없다(브라우저가 흉내내는 대신 단계를 숨긴다). */
export const FONTS = [
  { id: 'Pretendard',     label: '프리텐다드', kind: 'sans',  weights: [300, 400, 700] },
  { id: 'Noto Sans KR',   label: '본고딕',     kind: 'sans',  weights: [300, 400, 700] },
  { id: 'ChosunGu',       label: '조선굴림체', kind: 'sans',  weights: [400, 700] },
  { id: 'Noto Serif KR',  label: '본명조',     kind: 'serif', weights: [300, 400, 700] },
  { id: 'Nanum Myeongjo', label: '나눔명조',   kind: 'serif', weights: [400, 700] },
  { id: 'Gowun Batang',   label: '고운바탕',   kind: 'serif', weights: [400, 700] },
];

export const KIND_LABEL = { sans: '산세리프', serif: '세리프', custom: '웹폰트 (이 창에서만)' };
export const WEIGHT_LABEL = { 300: 'Light', 400: 'Medium', 700: 'Bold' };

export const findFont = (id) => FONTS.find((f) => f.id === id) || FONTS[0];

/* 캔버스 긴 변의 기본 해상도 */
export const BASE_SIZE = 1600;
export const MAX_SIZE = 12000;
/* 브라우저가 감당할 만한 총 픽셀 수 상한 */
export const MAX_AREA = 40e6;
/* 미리보기 배율의 위아래 한계. 1 = 캔버스 1px 이 화면 1px(100%). */
export const MAX_VIEW = 8;
export const MIN_VIEW = 0.05;

let nextId = 1;
export const newId = () => nextId++;

export const state = {
  mode: 'auto',            // 'auto' | 'template' | 'free'
  direction: 'v',          // auto 모드에서 'h' | 'v'
  ratio: { w: 1, h: 1 },   // template 모드 캔버스 비율
  ratioId: '1:1',
  canvasW: BASE_SIZE,      // 비율에 묶인 실제 픽셀 크기
  canvasH: BASE_SIZE,
  templateId: 'grid4',

  /* 사진마다 바깥에 둘러지는 테. 사진이 맞붙는 자리에서는 두 장의 테가 만나
     그만큼 서로 떨어지므로, 예전의 '간격' 과 '테두리' 를 이 하나가 겸한다.
     mode 'fill' 은 테를 색으로 칠하고, 'bg' 는 비워 둬 배경이 비치게 한다. */
  outline: { width: 0, mode: 'fill', color: '#ffffff', outer: true },

  bg: '#ffffff',
  bgOn: true,              // 끄면 배경색도 무늬도 깔지 않아 캔버스가 투명해진다

  /* 배경색 위에 깔리는 무늬. 사진 뒤에 들어가고 내보낸 이미지에도 함께 나간다.
     조절값은 무늬마다 따로(by) 들고 있고, 고른 사진(img)만 함께 쓴다.
     size 는 무늬 한 칸(또는 망점 간격) 픽셀, weight 는 그 칸 대비 선·점 굵기,
     x/y 는 무늬를 밀어 놓은 양(캔버스 바탕을 끌어도 움직인다). */
  bgPattern: {
    kind: 'none',
    img: null,
    by: Object.fromEntries(Object.entries(BG_DEFAULTS).map(([k, v]) => [k, { ...v }])),
  },

  photos: [],              // makePhoto() 참고
  layers: [],              // sticker | text | shape

  selection: null,         // { kind: 'cell', index } | { kind: 'layer', id }

  // 미리보기에서 글자를 고쳐 쓰는 중인 텍스트 레이어. 캔버스에는 글자를 그리지 않는다.
  editingId: null,

  /* 효과를 거는 방식. 둘은 함께 걸리지 않고 하나만 산다.
     'each' — 사진·스티커마다 따로 건 효과만 적용
     'all'  — 개별 효과는 무시하고 캔버스 전체 효과만 적용 */
  fxMode: 'each',
  canvasFx: newFx(),

  // 정렬을 돕는 안내선. 미리보기에만 그리고 내보낸 이미지에는 남지 않는다.
  grid: { show: false, snap: false, cols: 3, rows: 3 },

  /* 미리보기를 들여다보는 배율. 결과물에는 영향을 주지 않는다.
     fit 이면 창에 맞춰 자동으로 잡고, 아니면 scale 을 그대로 쓴다(1 = 100%). */
  view: { fit: true, scale: 1, x: 0, y: 0 },

  exportFormat: 'png',
  quality: 0.92,
};

/* 지금 고른 무늬의 조절값. '단색'일 때는 쓸 일이 없지만 호출부가 편하도록
   아무 칸이나 하나 돌려준다. */
export const bgOpts = () => state.bgPattern.by[state.bgPattern.kind] || state.bgPattern.by.grid;

export function template() {
  return TEMPLATES.find((t) => t.id === state.templateId) || TEMPLATES[5];
}

export function selectedLayer() {
  if (!state.selection || state.selection.kind !== 'layer') return null;
  return state.layers.find((l) => l.id === state.selection.id) || null;
}

export function removeLayer(id) {
  state.layers = state.layers.filter((l) => l.id !== id);
  if (state.selection?.kind === 'layer' && state.selection.id === id) state.selection = null;
}

/* 원본 바로 위에 복제본을 끼워 넣고 그 복제본을 돌려준다.
   스티커의 img 는 같은 이미지를 함께 쓴다(다시 읽을 필요가 없다). */
export function duplicateLayer(id) {
  const i = state.layers.findIndex((l) => l.id === id);
  if (i < 0) return null;
  const src = state.layers[i];
  const copy = { ...src, id: newId(), cx: src.cx + 40, cy: src.cy + 40 };
  for (const key of ['bg', 'fill', 'stroke', 'outline', 'shadow']) {
    if (src[key]) copy[key] = { ...src[key] };
  }
  // fx 는 강도 표가 중첩돼 있고, 구워 둔 캔버스는 함께 쓰면 안 된다.
  if (src.fx) copy.fx = cloneFx(src.fx);
  clearFxCache(copy);
  state.layers.splice(i + 1, 0, copy);
  return copy;
}

/* 비율을 유지한 채 픽셀 크기를 맞춘다. side 는 바꾼 쪽.
   자유 비율이면 건드린 쪽만 바꾸고 다른 쪽은 그대로 둔다. */
export function resizeCanvas(side, value) {
  const { w: rw, h: rh } = state.ratio;
  const v = Math.max(80, Math.min(MAX_SIZE, Math.round(value) || 80));
  if (state.ratioId === FREE_RATIO) {
    if (side === 'w') state.canvasW = v;
    else state.canvasH = v;
    return;
  }
  if (side === 'w') {
    state.canvasW = v;
    state.canvasH = Math.max(80, Math.round(v * rh / rw));
  } else {
    state.canvasH = v;
    state.canvasW = Math.max(80, Math.round(v * rw / rh));
  }
}

/* 가로·세로를 따로 정하는 상태로 바꾼다. 지금 크기는 그대로 둔다. */
export function freeRatio() {
  state.ratioId = FREE_RATIO;
}

/* 비율이 바뀌면 긴 변 길이를 유지한 채 다시 계산한다. */
export function applyRatio(rw, rh) {
  const longSide = Math.max(state.canvasW, state.canvasH) || BASE_SIZE;
  state.ratio = { w: rw, h: rh };
  state.ratioId = `${rw}:${rh}`;
  if (rw >= rh) {
    state.canvasW = longSide;
    state.canvasH = Math.max(80, Math.round(longSide * rh / rw));
  } else {
    state.canvasH = longSide;
    state.canvasW = Math.max(80, Math.round(longSide * rw / rh));
  }
}

/* 썸네일을 끌어 순서를 바꿀 때 쓴다. 템플릿 모드에는 빈 자리가 있을 수 있어
   먼저 자리를 채운 뒤 옮기고, 뒤에 남은 빈 자리는 정리한다. */
export function movePhoto(from, to) {
  const need = Math.max(state.photos.length, from + 1, to + 1);
  while (state.photos.length < need) state.photos.push(null);

  const [photo] = state.photos.splice(from, 1);
  state.photos.splice(to, 0, photo);
  while (state.photos.length && state.photos[state.photos.length - 1] == null) state.photos.pop();

  // 고른 칸이 사진을 따라가게 한다.
  if (state.selection?.kind === 'cell') state.selection = { kind: 'cell', index: to };
}

/* ── 사진과 레이어 생성 ──────────────────── */

export function makePhoto(img) {
  // rot90 은 시계 방향 90도 횟수(0~3).
  // free 는 자유 배치 모드에서 쓰는 틀 { cx, cy, w, h, rot }. 다른 모드에서는 쓰지 않는다.
  return {
    img, panX: 0, panY: 0, zoom: 1, rot90: 0, flipH: false, flipV: false,
    free: null, fx: newFx(),
  };
}

export function makeText(cx, cy, size) {
  return {
    id: newId(), type: 'text',
    text: '텍스트를 입력하세요',
    cx, cy, rot: 0,
    font: 'Pretendard', size, weight: 400, italic: false,
    align: 'center', lineHeight: 1.35, letterSpacing: 0,
    color: '#000000',
    stroke: { show: false, color: '#ffffff', width: 0.08 },   // 글자 크기 대비 비율
    bg: { mode: 'none', color: '#ffffff', opacity: 0.9, padX: 0.5, padY: 0.3, radius: 0.15 },
    shadow: { show: false, opacity: 0.32, blur: 0.014, angle: 0 },   // blur 는 캔버스 짧은 변 대비 비율, angle 은 빛 방향(0 = 위)
    _w: 10, _h: 10,
  };
}

export function makeShape(shape, cx, cy, size) {
  return {
    id: newId(), type: 'shape', shape,          // SHAPES 의 id
    cx, cy, rot: 0,
    w: size, h: size,
    lockRatio: false,                           // 켜면 한쪽을 바꿔도 비율이 유지된다
    _ratio: 1,                                  // 비율을 잠근 순간의 세로/가로
    radius: 0,                                  // 사각형 모서리 — 짧은 변 대비 비율
    inner: 0.55,                                // 속 빈 원의 구멍 크기
    points: 5,                                  // 별 꼭짓점 수
    spike: 0.45,                                // 별 안쪽 반지름 비율 — 작을수록 뾰족하다
    fill: { mode: 'solid', c1: '#0038ff', c2: '#ffffff', a1: 1, a2: 0, angle: 90, opacity: 1 },
    stroke: { show: false, color: '#000000', width: 4 },
    shadow: { show: false, opacity: 0.32, blur: 0.014, angle: 0 },   // blur 는 캔버스 짧은 변 대비 비율, angle 은 빛 방향(0 = 위)
    _w: size, _h: size,
  };
}

export function makeSticker(img, cx, cy, size) {
  const scale = size / Math.max(img.width, img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  return {
    id: newId(), type: 'sticker', img,
    cx, cy, rot: 0, w, h,
    fx: newFx(),
    outline: { show: false, color: '#ffffff', width: 14 },
    shadow: { show: false, opacity: 0.32, blur: 0.014, angle: 0 },   // blur 는 캔버스 짧은 변 대비 비율, angle 은 빛 방향(0 = 위)
    _w: w, _h: h,
  };
}
