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
  { id: 'poster', label: '계조화' },
  { id: 'chroma', label: '색수차' },
];

/* 처음 골랐을 때 이름값을 하도록 강도를 꽤 높게 잡아 둔다.
   0.6 쯤이면 '흑백'을 골라도 색이 남아 있어 고른 대로 안 보인다.
   강도는 효과마다 따로 기억한다 — 흑백을 0.1 로 두고 웜을 0.5 로 올린 뒤
   다시 흑백을 누르면 0.1 로 돌아온다. */
const DEFAULT_AMOUNT = 0.8;

export const newFx = () => ({
  mode: 'none',
  amounts: Object.fromEntries(EFFECTS.filter((e) => e.id !== 'none').map((e) => [e.id, DEFAULT_AMOUNT])),
  grain: 0,
});

export const cloneFx = (fx) => ({ ...fx, amounts: { ...fx.amounts } });

export const amountOf = (fx) => fx.amounts?.[fx.mode] ?? DEFAULT_AMOUNT;

/* 그레인은 다른 효과와 겹쳐 쓰는 것이라 따로 둔다. */
export const hasEffect = (fx) => !!fx && (fx.mode !== 'none' || fx.grain > 0);

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

  const key = `${fx.mode}|${amountOf(fx)}|${fx.grain}|${sizeLimit()}`;
  if (owner._fxImg === img && owner._fxKey === key && owner._fxCanvas) return owner._fxCanvas;

  // 캔버스를 매번 새로 만들면 슬라이더를 끄는 동안 쓰레기가 쌓인다. 하나를 계속 쓴다.
  // 다만 willReadFrequently 는 처음 만들 때만 먹으므로 필요가 달라지면 새로 만든다.
  const needRead = fx.mode === 'poster';
  if (!owner._fxCanvas || owner._fxRead !== needRead) {
    owner._fxCanvas = document.createElement('canvas');
    owner._fxRead = needRead;
  }

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
   부를 때마다 다시 계산한다. 계조화는 픽셀을 직접 읽어 조금 무겁다.
   willReadFrequently 가 캔버스마다 고정이라 두 장을 나눠 쓴다. */
const wholeNormal = document.createElement('canvas');
const wholeRead = document.createElement('canvas');

export function applyCanvasEffect(ctx, fx) {
  const cv = ctx.canvas;
  if (!hasEffect(fx) || !cv.width || !cv.height) return;

  const out = bake(cv, fx, cv.width, cv.height, fx.mode === 'poster' ? wholeRead : wholeNormal);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(out, 0, 0);
  ctx.restore();
}

function bake(img, fx, w, h, canvas) {
  canvas.width = w;
  canvas.height = h;
  // 계조화만 픽셀을 직접 읽는다. 나머지는 필터와 합성으로 처리한다.
  const ctx = canvas.getContext('2d', { willReadFrequently: fx.mode === 'poster' });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const a = Math.max(0, Math.min(1, amountOf(fx)));

  if (fx.mode === 'chroma') {
    drawChroma(ctx, img, w, h, a);
  } else {
    ctx.filter = cssFilter(fx.mode, a);
    ctx.drawImage(img, 0, 0, w, h);
    ctx.filter = 'none';
    if (fx.mode === 'warm' || fx.mode === 'cool') tint(ctx, w, h, fx.mode, a);
    if (fx.mode === 'poster') posterize(ctx, w, h, a);
  }

  if (fx.grain > 0) grain(ctx, w, h, fx.grain);

  // 투명 배경 스티커는 위 과정에서 바깥쪽이 칠해질 수 있다. 원본 알파로 되돌린다.
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(img, 0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';

  return canvas;
}

function cssFilter(mode, a) {
  if (mode === 'mono') return `grayscale(${a})`;
  if (mode === 'sepia') return `sepia(${a})`;
  if (mode === 'warm') return `saturate(${1 + a * 0.35}) contrast(${1 + a * 0.06})`;
  if (mode === 'cool') return `saturate(${1 - a * 0.15}) hue-rotate(${-a * 10}deg)`;
  return 'none';
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

/* 계조화 — 각 채널을 몇 단계로만 남긴다. 256칸 표를 미리 만들어 픽셀마다 찾아 쓴다. */
function posterize(ctx, w, h, a) {
  const levels = Math.max(2, Math.round(12 - a * 10));
  const step = 255 / (levels - 1);
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = Math.round(Math.round(i / step) * step);

  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    px[i] = lut[px[i]];
    px[i + 1] = lut[px[i + 1]];
    px[i + 2] = lut[px[i + 2]];
  }
  ctx.putImageData(data, 0, 0);
}

/* 색수차 — R·G·B 를 따로 뽑아 조금씩 어긋나게 겹친다.
   채널 분리는 곱하기 합성으로 한다(빨강만 남기려면 #f00 을 곱한다). */
function drawChroma(ctx, img, w, h, a) {
  const off = Math.max(1, Math.min(w, h) * 0.01 * a);
  const parts = [
    ['#ff0000', -off],
    ['#00ff00', 0],
    ['#0000ff', off],
  ];

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  parts.forEach(([color, dx], i) => ctx.drawImage(channel(img, w, h, color, i), dx, 0));
  ctx.restore();
}

/* 세 채널이 동시에 필요하므로 판을 세 장 돌려 쓴다.
   매번 새로 만들면 캔버스 전체 효과에서 한 프레임에 수십 MB 씩 버리게 된다. */
const chPool = [0, 1, 2].map(() => document.createElement('canvas'));

function channel(img, w, h, color, slot) {
  const canvas = chPool[slot];
  canvas.width = w;          // 크기를 넣으면 판이 지워지고 상태도 초기화된다
  canvas.height = h;
  const c = canvas.getContext('2d');
  c.drawImage(img, 0, 0, w, h);
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
