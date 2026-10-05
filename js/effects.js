/* 사진과 스티커에 거는 색 보정.

   결과를 캔버스에 한 번 구워 두고 파라미터가 바뀔 때만 다시 만든다.
   render() 는 드래그하는 동안 매 프레임 불리므로 매번 다시 굽지 않는 게 중요하다.

   미리보기는 작게 구워 슬라이더를 끄는 동안에도 버벅이지 않게 하고,
   내보낼 때만 원본 해상도로 다시 굽는다(setFullRes). */

export const EFFECTS = [
  { id: 'none',   label: '없음' },
  { id: 'mono',   label: '흑백' },
  { id: 'sepia',  label: '세피아' },
  { id: 'warm',   label: '웜' },
  { id: 'cool',   label: '쿨' },
  { id: 'pixel',  label: '픽셀화' },
  { id: 'chroma', label: '색수차' },
  { id: 'half',   label: '하프톤' },
];

/* 처음 골랐을 때 이름값을 하도록 강도를 꽤 높게 잡아 둔다.
   0.6 쯤이면 '흑백'을 골라도 색이 남아 있어 고른 대로 안 보인다.
   강도는 효과마다 따로 기억한다 — 흑백을 0.1 로 두고 웜을 0.5 로 올린 뒤
   다시 흑백을 누르면 0.1 로 돌아온다. */
const DEFAULT_AMOUNT = 0.8;

/* amounts  — 효과별 강도. 픽셀화·하프톤에서는 칸 크기 노릇을 한다.
   dot       — 하프톤 점 굵기
   brightness·contrast — 효과와 상관없이 늘 걸리는 밝기·대비 보정 */
export const newFx = () => ({
  mode: 'none',
  amounts: Object.fromEntries(EFFECTS.filter((e) => e.id !== 'none').map((e) => [e.id, DEFAULT_AMOUNT])),
  dot: 1,
  brightness: 0,
  contrast: 0,
  grain: 0,
});

export const cloneFx = (fx) => ({ ...fx, amounts: { ...fx.amounts } });

export const amountOf = (fx) => fx.amounts?.[fx.mode] ?? DEFAULT_AMOUNT;

/* 그레인과 밝기·대비는 다른 효과와 겹쳐 쓰는 것이라 따로 둔다.
   효과를 '없음'으로 둔 채 보정만 거는 것도 된다. */
export const hasEffect = (fx) => !!fx
  && (fx.mode !== 'none' || fx.grain > 0 || !!fx.brightness || !!fx.contrast);

const PREVIEW_MAX = 1800;
const EXPORT_MAX = 4096;

let fullRes = false;
export function setFullRes(on) { fullRes = on; }
const sizeLimit = () => (fullRes ? EXPORT_MAX : PREVIEW_MAX);

/* 효과를 먹인 캔버스를 돌려준다. 효과가 없으면 원본 이미지를 그대로 돌려주므로
   부르는 쪽은 결과를 그냥 drawImage 하면 된다.
   owner(사진 또는 레이어)에 결과를 매달아 두고 열쇠가 같으면 재사용한다. */
export function filtered(owner, img, fx) {
  if (!hasEffect(fx) || !img.width) return img;

  const key = `${fx.mode}|${amountOf(fx)}|${fx.dot}|${fx.brightness}|${fx.contrast}|${fx.grain}|${sizeLimit()}`;
  if (owner._fxImg === img && owner._fxKey === key && owner._fxCanvas) return owner._fxCanvas;

  // 캔버스를 매번 새로 만들면 슬라이더를 끄는 동안 쓰레기가 쌓인다. 하나를 계속 쓴다.
  if (!owner._fxCanvas) owner._fxCanvas = document.createElement('canvas');

  const s = Math.min(1, sizeLimit() / Math.max(img.width, img.height));
  bake(img, fx,
    Math.max(1, Math.round(img.width * s)),
    Math.max(1, Math.round(img.height * s)),
    owner._fxCanvas);

  owner._fxImg = img;
  owner._fxKey = key;
  return owner._fxCanvas;
}

/* 복제본이 원본의 구워 둔 캔버스를 함께 쓰면, 한쪽 효과를 바꿀 때 둘 다 바뀐다. */
export function clearFxCache(owner) {
  delete owner._fxCanvas;
  delete owner._fxKey;
  delete owner._fxImg;
  delete owner._fxRead;
}

/* 캔버스 전체에 거는 효과. 그린 결과가 매 프레임 달라지므로 구워 둘 수 없고
   부를 때마다 다시 계산한다. */
const wholeNormal = document.createElement('canvas');

export function applyCanvasEffect(ctx, fx) {
  const cv = ctx.canvas;
  if (!hasEffect(fx) || !cv.width || !cv.height) return;

  const out = bake(cv, fx, cv.width, cv.height, wholeNormal);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(out, 0, 0);
  ctx.restore();
}

function bake(img, fx, w, h, canvas) {
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const a = Math.max(0, Math.min(1, amountOf(fx)));

  // 밝기·대비는 어느 효과에나 함께 걸리므로 필터 문자열 앞에 붙여 한 번에 처리한다.
  const adjust = adjustFilter(fx);

  if (fx.mode === 'chroma') {
    drawChroma(ctx, img, w, h, a, adjust);
  } else {
    ctx.filter = [adjust, cssFilter(fx.mode, a)].filter(Boolean).join(' ') || 'none';
    ctx.drawImage(img, 0, 0, w, h);
    ctx.filter = 'none';
    if (fx.mode === 'warm' || fx.mode === 'cool') tint(ctx, w, h, fx.mode, a);
    if (fx.mode === 'pixel') pixelate(ctx, w, h, a);
    if (fx.mode === 'half') halftone(ctx, w, h, a, fx.dot);
  }

  if (fx.grain > 0) grain(ctx, w, h, fx.grain);

  // 투명 배경 스티커는 위 과정에서 바깥쪽이 칠해질 수 있다. 원본 알파로 되돌린다.
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(img, 0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';

  return canvas;
}

/* 밝기·대비는 -1 ~ 1 로 받아 CSS 필터의 0 ~ 2 배로 옮긴다. 0 이면 아무것도 붙이지 않는다. */
function adjustFilter(fx) {
  const b = Math.max(-1, Math.min(1, fx.brightness || 0));
  const c = Math.max(-1, Math.min(1, fx.contrast || 0));
  const parts = [];
  if (b) parts.push(`brightness(${(1 + b).toFixed(3)})`);
  if (c) parts.push(`contrast(${(1 + c).toFixed(3)})`);
  return parts.join(' ');
}

function cssFilter(mode, a) {
  if (mode === 'mono') return `grayscale(${a})`;
  if (mode === 'sepia') return `sepia(${a})`;
  if (mode === 'warm') return `saturate(${1 + a * 0.35}) contrast(${1 + a * 0.06})`;
  if (mode === 'cool') return `saturate(${1 - a * 0.15}) hue-rotate(${-a * 10}deg)`;
  return '';
}

/* 색조를 두 겹으로 넣는다.
   soft-light 만 쓰면 색이 도는 대신 전체가 밝아지기만 해서 웜·쿨 구분이 약하다.
   곱하기로 반대쪽 채널을 눌러 줘야 화이트밸런스를 옮긴 것처럼 보인다. */
function tint(ctx, w, h, mode, a) {
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = Math.min(1, a * 0.7);
  ctx.fillStyle = mode === 'warm' ? '#ff9a3c' : '#3d8bff';
  ctx.fillRect(0, 0, w, h);

  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = Math.min(1, a * 0.55);
  ctx.fillStyle = mode === 'warm' ? '#ffe4bc' : '#c8e0ff';
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/* 픽셀화 — 작게 줄였다 그대로 다시 키운다. 줄일 때는 평균이 나오게 두고
   키울 때만 보간을 꺼야 칸이 흐려지지 않고 또렷한 모자이크가 된다.
   칸 크기는 '구운 판의 짧은 변 대비' 로 잡아 미리보기와 내보낸 결과를 맞춘다. */
const pxSmall = document.createElement('canvas');

function pixelate(ctx, w, h, a) {
  const cell = Math.max(2, Math.min(w, h) * (0.004 + a * 0.036));
  const cw = Math.max(1, Math.round(w / cell));
  const ch = Math.max(1, Math.round(h / cell));

  pxSmall.width = cw;
  pxSmall.height = ch;
  const s = pxSmall.getContext('2d');
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.clearRect(0, 0, cw, ch);
  s.imageSmoothingEnabled = true;
  s.drawImage(ctx.canvas, 0, 0, cw, ch);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(pxSmall, 0, 0, w, h);
  ctx.restore();
}

/* 하프톤 — 그려 둔 그림을 망점 격자로 다시 찍는다.
   강도는 망점의 굵기다. 올릴수록 점이 굵어지고 그만큼 거칠게 보인다.
   칸 크기는 '구운 판의 짧은 변 대비' 로 잡으므로 미리보기와 내보낸 결과가 같다.

   점마다 색을 바꿔 가며 칠하면 수만 번 fillStyle 을 갈아 끼우게 돼 느리다.
   대신 점 모양만 한 판에 한 번에 찍어 두고, 그 모양대로 원본을 오려 낸다.
   그러면 점 색이 원본에서 그대로 따라오므로 사진 색이 살아 있다. */
const htSmall = document.createElement('canvas');
const htCtx = htSmall.getContext('2d', { willReadFrequently: true });
const htMask = document.createElement('canvas');

/* 인쇄 망점처럼 살짝 기울여 찍는다. 격자가 가로세로로 반듯하면 사진의 결과
   간섭무늬(모아레)가 생기기 쉽다. */
const HT_ANGLE = (15 * Math.PI) / 180;

function halftone(ctx, w, h, a, dotScale = 1) {
  // 뒤 항은 점 개수의 바닥 — 아무리 곱게 잡아도 한 변 260 줄쯤에서 멈춘다.
  const cell = Math.max(2, Math.hypot(w, h) / 260, Math.min(w, h) * (0.004 + a * 0.020));
  const cw = Math.max(1, Math.round(w / cell));
  const ch = Math.max(1, Math.round(h / cell));

  // 칸 평균색은 축소본에서 집는다. 원본을 통째로 읽는 것보다 훨씬 가볍다.
  htSmall.width = cw;
  htSmall.height = ch;
  htCtx.setTransform(1, 0, 0, 1, 0, 0);
  htCtx.clearRect(0, 0, cw, ch);
  htCtx.drawImage(ctx.canvas, 0, 0, cw, ch);
  const px = htCtx.getImageData(0, 0, cw, ch).data;

  const cos = Math.cos(HT_ANGLE);
  const sin = Math.sin(HT_ANGLE);
  const n = Math.ceil(Math.hypot(w, h) / cell) + 2;

  const dots = new Path2D();
  for (let j = 0; j < n; j++) {
    const ly = (j - n / 2 + 0.5) * cell;
    for (let i = 0; i < n; i++) {
      const lx = (i - n / 2 + 0.5) * cell;
      // 격자만 기울었으므로 점 자리를 원래 좌표로 되돌려 색을 집는다.
      const x = w / 2 + lx * cos - ly * sin;
      const y = h / 2 + lx * sin + ly * cos;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;

      const col = Math.min(cw - 1, (x / w * cw) | 0);
      const row = Math.min(ch - 1, (y / h * ch) | 0);
      const o = (row * cw + col) * 4;
      if (px[o + 3] < 8) continue;

      // 어두울수록 점이 커진다. 제곱근을 쓰면 점의 넓이가 어두움에 비례한다.
      const lum = (px[o] * 0.299 + px[o + 1] * 0.587 + px[o + 2] * 0.114) / 255;
      const r = cell * 0.72 * Math.sqrt(Math.max(0, 1 - lum)) * dotScale;
      if (r < 0.15) continue;

      dots.moveTo(lx + r, ly);
      dots.arc(lx, ly, r, 0, Math.PI * 2);
    }
  }

  // 점 모양을 한 판에 한 번에 찍는다.
  htMask.width = w;
  htMask.height = h;
  const m = htMask.getContext('2d');
  m.setTransform(1, 0, 0, 1, 0, 0);
  m.clearRect(0, 0, w, h);
  m.translate(w / 2, h / 2);
  m.rotate(HT_ANGLE);
  m.fillStyle = '#000000';
  m.fill(dots);

  // 그 모양대로 원본을 오려 내고, 뚫린 자리는 흰 종이로 받친다.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(htMask, 0, 0);
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/* 색수차 — R·G·B 를 따로 뽑아 조금씩 어긋나게 겹친다.
   채널 분리는 곱하기 합성으로 한다(빨강만 남기려면 #f00 을 곱한다). */
function drawChroma(ctx, img, w, h, a, adjust = '') {
  const off = Math.max(1, Math.min(w, h) * 0.01 * a);
  const parts = [
    ['#ff0000', -off],
    ['#00ff00', 0],
    ['#0000ff', off],
  ];

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  parts.forEach(([color, dx], i) => ctx.drawImage(channel(img, w, h, color, i, adjust), dx, 0));
  ctx.restore();
}

/* 세 채널이 동시에 필요하므로 판을 세 장 돌려 쓴다.
   매번 새로 만들면 캔버스 전체 효과에서 한 프레임에 수십 MB 씩 버리게 된다. */
const chPool = [0, 1, 2].map(() => document.createElement('canvas'));

function channel(img, w, h, color, slot, adjust = '') {
  const canvas = chPool[slot];
  canvas.width = w;          // 크기를 넣으면 판이 지워지고 상태도 초기화된다
  canvas.height = h;
  const c = canvas.getContext('2d');
  c.filter = adjust || 'none';
  c.drawImage(img, 0, 0, w, h);
  c.filter = 'none';
  c.globalCompositeOperation = 'multiply';
  c.fillStyle = color;
  c.fillRect(0, 0, w, h);
  // 곱하기가 투명한 곳까지 칠하므로 원본 알파로 되돌린다.
  c.globalCompositeOperation = 'destination-in';
  c.drawImage(img, 0, 0, w, h);
  c.globalCompositeOperation = 'source-over';
  return canvas;
}

/* 필름 그레인 — 회색 잡음 타일을 overlay 로 덮는다.
   타일을 캔버스 크기에 맞춰 늘려야 미리보기와 내보낸 결과의 입자가 같아진다. */
let noiseTile = null;

function noise() {
  if (noiseTile) return noiseTile;
  const n = document.createElement('canvas');
  n.width = 128;
  n.height = 128;
  const c = n.getContext('2d');
  const d = c.createImageData(128, 128);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = 110 + Math.random() * 36;   // 중간 회색 언저리
    d.data[i] = v;
    d.data[i + 1] = v;
    d.data[i + 2] = v;
    d.data[i + 3] = 255;
  }
  c.putImageData(d, 0, 0);
  noiseTile = n;
  return n;
}

function grain(ctx, w, h, amount) {
  const pattern = ctx.createPattern(noise(), 'repeat');
  if (!pattern) return;
  const scale = Math.max(1, w / PREVIEW_MAX);
  try { pattern.setTransform(new DOMMatrix([scale, 0, 0, scale, 0, 0])); } catch { /* 미지원 브라우저 */ }

  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = Math.min(1, amount * 0.9);
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
