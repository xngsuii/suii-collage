/* 상태와 상수 정의. 다른 모듈은 여기서 state를 읽고 쓴다. */

export const RATIOS = [
  { id: '1:1',  w: 1,  h: 1  },
  { id: '4:5',  w: 4,  h: 5  },
  { id: '5:4',  w: 5,  h: 4  },
  { id: '9:16', w: 9,  h: 16 },
  { id: '16:9', w: 16, h: 9  },
  { id: '3:4',  w: 3,  h: 4  },
  { id: '4:3',  w: 4,  h: 3  },
  { id: '2:3',  w: 2,  h: 3  },
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

/* weights 에 없는 굵기는 고를 수 없다(브라우저가 흉내내는 대신 단계를 숨긴다). */
export const FONTS = [
  { id: 'Pretendard',     label: '프리텐다드', kind: 'sans',  weights: [300, 400, 700] },
  { id: 'Noto Sans KR',   label: '본고딕',     kind: 'sans',  weights: [300, 400, 700] },
  { id: 'ChosunGu',       label: '조선굴림체', kind: 'sans',  weights: [400, 700] },
  { id: 'Noto Serif KR',  label: '본명조',     kind: 'serif', weights: [300, 400, 700] },
  { id: 'Nanum Myeongjo', label: '나눔명조',   kind: 'serif', weights: [400, 700] },
  { id: 'Gowun Batang',   label: '고운바탕',   kind: 'serif', weights: [400, 700] },
];

export const KIND_LABEL = { sans: '산세리프', serif: '세리프' };
export const WEIGHT_LABEL = { 300: 'Light', 400: 'Medium', 700: 'Bold' };

export const findFont = (id) => FONTS.find((f) => f.id === id) || FONTS[0];

/* 캔버스 긴 변의 기본 해상도 */
export const BASE_SIZE = 1600;
export const MAX_SIZE = 12000;
/* 브라우저가 감당할 만한 총 픽셀 수 상한 */
export const MAX_AREA = 40e6;

let nextId = 1;
export const newId = () => nextId++;

export const state = {
  mode: 'auto',            // 'auto' | 'template'
  direction: 'v',          // auto 모드에서 'h' | 'v'
  ratio: { w: 1, h: 1 },   // template 모드 캔버스 비율
  ratioId: '1:1',
  canvasW: BASE_SIZE,      // 비율에 묶인 실제 픽셀 크기
  canvasH: BASE_SIZE,
  templateId: 'grid4',

  gap: 0,
  margin: false,           // 바깥 여백도 gap 만큼 줄지
  bg: '#ffffff',
  border: { show: false, width: 4, color: '#000000', outer: true },

  photos: [],              // { img, panX, panY, zoom }
  layers: [],              // sticker | text | shape

  selection: null,         // { kind: 'cell', index } | { kind: 'layer', id }

  // 정렬을 돕는 안내선. 미리보기에만 그리고 내보낸 이미지에는 남지 않는다.
  grid: { show: false, snap: false, cols: 3, rows: 3 },

  exportFormat: 'png',
  quality: 0.92,
};

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
  for (const key of ['bg', 'fill', 'stroke', 'outline']) {
    if (src[key]) copy[key] = { ...src[key] };
  }
  state.layers.splice(i + 1, 0, copy);
  return copy;
}

/* 비율을 유지한 채 픽셀 크기를 맞춘다. side 는 바꾼 쪽. */
export function resizeCanvas(side, value) {
  const { w: rw, h: rh } = state.ratio;
  const v = Math.max(80, Math.min(MAX_SIZE, Math.round(value) || 80));
  if (side === 'w') {
    state.canvasW = v;
    state.canvasH = Math.max(80, Math.round(v * rh / rw));
  } else {
    state.canvasH = v;
    state.canvasW = Math.max(80, Math.round(v * rw / rh));
  }
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

/* ── 레이어 생성 ─────────────────────────── */

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
    shadow: false,
    _w: 10, _h: 10,
  };
}

export function makeShape(shape, cx, cy, size) {
  return {
    id: newId(), type: 'shape', shape,          // 'rect' | 'circle'
    cx, cy, rot: 0,
    w: size, h: size,
    radius: shape === 'rect' ? 0.08 : 0,        // 짧은 변 대비 비율
    fill: { mode: 'solid', c1: '#0038ff', c2: '#ffffff', a1: 1, a2: 0, angle: 90, opacity: 1 },
    stroke: { show: false, color: '#000000', width: 4 },
    shadow: false,
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
    outline: { show: false, color: '#ffffff', width: 14 },
    shadow: false,
    _w: w, _h: h,
  };
}
