/* 웹폰트 임베드 코드를 받아 이 창에서만 쓸 폰트를 늘린다.
   어디에도 저장하지 않으므로 새로고침하면 기본 6종만 남는다. */

import { FONTS } from 'app/state.js';

export const customFonts = [];

export const allFonts = () => [...FONTS, ...customFonts];
export const findFont = (id) => allFonts().find((f) => f.id === id) || FONTS[0];

/* 붙여 넣은 코드를 그대로 페이지에 꽂지는 않는다.
   링크 주소와 @font-face 블록만 뽑아 우리가 만든 태그에 담는다. */
function parse(code) {
  const urls = [];
  const push = (u) => { if (/^https?:\/\//i.test(u) && !urls.includes(u)) urls.push(u); };

  for (const m of code.matchAll(/<link[^>]+href\s*=\s*["']([^"']+)["']/gi)) push(m[1]);
  for (const m of code.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)/gi)) push(m[1]);

  const faces = code.match(/@font-face\s*\{[^}]*\}/gi) || [];
  // 태그도 @font-face 도 없으면 주소만 적어 넣은 것으로 본다.
  if (!urls.length && !faces.length) {
    for (const m of code.matchAll(/https?:\/\/[^\s"'<>]+/gi)) push(m[0]);
  }
  return { urls, css: faces.join('\n') };
}

function loadStylesheet(url) {
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.dataset.webfont = '1';
    link.onload = () => resolve(true);
    link.onerror = () => resolve(false);
    document.head.appendChild(link);
    // 응답이 없어도 붙잡혀 있지 않게 한다.
    setTimeout(() => resolve(false), 8000);
  });
}

/* 지금 문서가 아는 폰트 이름 → 굵기 집합.
   스타일시트에 적힌 @font-face 도 document.fonts 에 들어오므로, 붙이기 전후를
   비교하면 무엇이 새로 들어왔는지 알 수 있다. */
function familyMap() {
  const map = new Map();
  document.fonts?.forEach((f) => {
    const name = String(f.family).replace(/^["']|["']$/g, '');
    if (!map.has(name)) map.set(name, new Set());
    map.get(name).add(f.weight);
  });
  return map;
}

/* 구글 폰트처럼 주소에 이름이 박혀 있으면 거기서도 건져 본다. */
function familiesFromUrl(url) {
  const names = [];
  for (const m of url.matchAll(/family=([^&:]+)/gi)) {
    names.push(decodeURIComponent(m[1]).replace(/\+/g, ' ').trim());
  }
  return names;
}

const STEPS = [300, 400, 700];

function weightsOf(set) {
  if (!set || !set.size) return [400];
  const out = new Set();
  for (const raw of set) {
    const s = String(raw).trim();
    // 가변 폰트는 "100 900" 처럼 범위로 적힌다. 세 단계를 모두 연다.
    if (s.includes(' ')) { STEPS.forEach((w) => out.add(w)); continue; }
    const n = s === 'normal' ? 400 : s === 'bold' ? 700 : parseInt(s, 10);
    if (Number.isNaN(n)) continue;
    out.add(STEPS.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a)));
  }
  const list = STEPS.filter((w) => out.has(w));
  return list.length ? list : [400];
}

export async function addWebFont(code) {
  const { urls, css } = parse(code);
  if (!urls.length && !css) {
    return { ok: false, error: '링크 주소나 @font-face 를 찾지 못했습니다.' };
  }

  const before = familyMap();

  if (css) {
    const style = document.createElement('style');
    style.dataset.webfont = '1';
    style.textContent = css;
    document.head.appendChild(style);
  }
  await Promise.all(urls.map(loadStylesheet));
  try { await document.fonts.ready; } catch { /* 지원하지 않으면 그냥 넘어간다 */ }

  const after = familyMap();
  const fromUrl = [...new Set(urls.flatMap(familiesFromUrl))].filter(Boolean);

  let added = [...after.keys()].filter((name) => !before.has(name));
  if (!added.length) added = fromUrl.filter((name) => !before.has(name));

  if (!added.length) {
    // 이미 넣어 둔 폰트를 다시 붙인 경우와, 아예 못 찾은 경우를 갈라 알려 준다.
    const known = fromUrl.filter((name) => allFonts().some((f) => f.id === name));
    if (known.length) return { ok: false, error: `${known.join(', ')} — 이미 목록에 있습니다.` };
    return { ok: false, error: '새로 들어온 폰트를 찾지 못했습니다. 주소가 맞는지 확인해 주세요.' };
  }

  const fresh = [];
  for (const name of added) {
    if (allFonts().some((f) => f.id === name)) continue;
    customFonts.push({ id: name, label: name, kind: 'custom', weights: weightsOf(after.get(name)) });
    fresh.push(name);
  }
  if (!fresh.length) return { ok: false, error: '이미 들어 있는 폰트입니다.' };

  // 이름만 등록됐을 수 있으니 실제로 받아 둔다. 실패해도 목록에는 남긴다.
  await Promise.all(fresh.map((name) => document.fonts.load(`400 16px "${name}"`, '가').catch(() => {})));
  return { ok: true, added: fresh };
}
