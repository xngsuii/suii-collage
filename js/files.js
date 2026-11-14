/* 파일 선택과 이미지 로딩. */

const input = document.getElementById('fileInput');
let resolve = null;

function finish(value) {
  const r = resolve;
  resolve = null;
  r?.(value);
}

input.addEventListener('change', async () => {
  const files = Array.from(input.files || []);
  input.value = '';
  if (!files.length) return finish([]);
  finish(await loadImages(files));
});

input.addEventListener('cancel', () => finish([]));

export function pickImages(multiple = true) {
  input.multiple = multiple;
  return new Promise((res) => {
    finish([]);            // 이전 대기 중인 요청이 있으면 정리
    resolve = res;
    input.click();
  });
}

/* 끌어다 놓은 파일처럼 이미 손에 쥔 파일 목록을 이미지로 바꾼다. 이미지가 아닌 파일은 빠진다. */
export async function loadImages(files) {
  const imgs = await Promise.all(Array.from(files).map(loadImage));
  return imgs.filter(Boolean);
}

/* 끌어다 놓을 때 받는 사진 형식(SVG 같은 문서형 이미지는 제외). */
export const isPhotoType = (type) => /^image\/(jpeg|png|webp|gif|avif|bmp)$/.test(type);

function loadImage(file) {
  return new Promise((res) => {
    if (!file.type.startsWith('image/')) return res(null);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => { URL.revokeObjectURL(url); res(null); };
    img.src = url;
  });
}
