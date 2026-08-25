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
  const imgs = await Promise.all(files.map(loadImage));
  finish(imgs.filter(Boolean));
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
