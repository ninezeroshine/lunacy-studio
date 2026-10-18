// Приближённые превью встроенных эффектов подсветки. Не эмулятор прошивки: показать характер эффекта,
// чтобы его было легко найти в галерее. Номера режимов — как в store.server.effects.
// ponytail: формы выведены из названий режимов, а глазами сверены только режимы 11 и 13. Потолок: превью
// может не совпасть с клавиатурой. Апгрейд: после сверки названий поправить формулу конкретного режима.
import { keys, CODE_HID, keyByHid } from "../core/keydata.js";

const hsv = (h, s, v) => {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  return [r * 255, g * 255, b * 255];
};
const scale = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

let geo = null;
export function geometry() {
  if (geo && geo.n === keys().length) return geo;
  const ks = keys();
  const minX = Math.min(...ks.map((k) => k.x)), minY = Math.min(...ks.map((k) => k.y));
  const W = Math.max(...ks.map((k) => k.x + k.w)) - minX, H = Math.max(...ks.map((k) => k.y + k.h)) - minY;
  geo = {
    n: ks.length, W, H,
    keys: ks.map((k) => ({ k, li: k.light_index, nx: (k.x + k.w / 2 - minX) / W, ny: (k.y + k.h / 2 - minY) / H,
      rx: (k.x - minX) / W, ry: (k.y - minY) / H, rw: k.w / W, rh: k.h / H, col: k.col, row: k.row })),
  };
  return geo;
}

// Цвет клавиши для эффекта mode в момент t (секунды). p: {rgb, colorful, brightness 0..5, speed 0..5, direction 0|1}
export function effectColor(mode, key, t, p) {
  const sp = 0.25 + (p.speed ?? 3) * 0.28;
  const dir = p.direction ? -1 : 1;
  const T = t * sp;
  const base = p.colorful ? null : p.rgb;
  const pick = (h) => (base ? base : hsv(h, 1, 1));
  const { nx, ny } = key;
  let c = [0, 0, 0];
  switch (mode) {
    case 0: c = [0, 0, 0]; break;
    case 1: c = pick(nx * .85); break;                                         // статичный
    case 2: { const ph = hash(key.li + Math.floor(T * 1.4) * 97); const age = (T * 1.4) % 1;   // загорается при нажатии
      c = ph > .9 ? scale(pick(hash(key.li)), 1 - age) : [0, 0, 0]; break; }
    case 3: { const ph = hash(key.li + Math.floor(T * 1.4) * 97); const age = (T * 1.4) % 1;   // затухает при нажатии
      c = scale(pick(nx), ph > .9 ? age : 1); break; }
    case 4: { const tw = Math.max(0, Math.sin(T * 2.2 + hash(key.li) * 40)); c = scale(pick(hash(key.li * 3)), tw ** 6); break; } // звёзды
    case 5: { const col = key.col + hash(key.col) * 3, y = (T * .9 + hash(col) * 7) % 1.4 - .2;  // дождь
      const d = ny - y; c = scale(pick(hash(col)), d < 0 && d > -.35 ? 1 + d / .35 : 0); break; }
    case 6: c = hsv(hash(key.li * 7.3), 1, 1); break;                          // разноцветный
    case 7: c = scale(pick(T * .05), .15 + .85 * (.5 + .5 * Math.sin(T * 2.6))); break; // дыхание
    case 8: c = hsv(T * .12, 1, 1); break;                                     // цикл
    case 9: case 15: { const cx = .5 + .35 * Math.sin(Math.floor(T * .7) * 2.1), cy = .5; // рябь
      const r = ((T * .7) % 1) * 1.1, d = Math.hypot((nx - cx) * 2.2, ny - cy);
      const w = Math.max(0, 1 - Math.abs(d - r) / .12); c = scale(pick(d * .6 + T * .1), mode === 15 ? w : .12 + w * .88); break; }
    case 10: c = pick(ny * .8 - T * .25 * dir); if (!base) c = hsv(ny * .8 - T * .25 * dir, 1, 1); break; // вертикальная радуга
    case 11: c = hsv(nx * .9 - T * .3 * dir, 1, 1); if (base) c = scale(base, .4 + .6 * (.5 + .5 * Math.sin((nx * 6 - T * 3 * dir)))); break; // горизонтальная
    case 12: { const a = Math.atan2(ny - .5, (nx - .5) * 2.4) / (Math.PI * 2); c = hsv(a + T * .2 * dir, 1, 1); if (base) c = scale(base, .5 + .5 * Math.sin((a + T * .2) * Math.PI * 4)); break; } // вращающаяся
    case 13: { const d = Math.hypot((nx - .5) * 2.4, ny - .5), r = (T * .8) % 1.2;           // взрывы
      c = scale(pick(d + T * .1), Math.max(0, 1 - Math.abs(d - r) / .18)); break; }
    case 14: { const y = key.row, x = (T * .9 + hash(y) * 3) % 1.4 - .2;                     // горизонтальные разряды
      const d = (dir > 0 ? nx - x : x - nx); c = scale(pick(hash(y * 5)), d < 0 && d > -.4 ? 1 + d / .4 : 0); break; }
    case 16: c = hsv((nx + ny) * .6 - T * .2 * dir, 1, 1); if (base) c = scale(base, .3 + .7 * (.5 + .5 * Math.sin((nx + ny) * 7 - T * 3 * dir))); break; // поток
    case 17: { const x = ((T * .55 * dir) % 1 + 1) % 1; const d = Math.min(Math.abs(nx - x), 1 - Math.abs(nx - x)); // волна
      c = scale(pick(x), Math.max(.06, 1 - d / .18)); break; }
    case 18: { const s = ((nx * .8 + ny * .35 - T * .5 * dir) % 1 + 1) % 1; c = scale(pick(s), Math.max(.06, Math.sin(s * Math.PI) ** 6)); break; } // наклонённая волна
    case 19: { const x = .5 + .5 * Math.sin(T * 1.6); const d = Math.abs(nx - x);              // курсирующий
      c = scale(pick(nx), Math.max(.05, 1 - d / .12)); break; }
    default: c = pick(nx);
  }
  const k = Math.max(0, Math.min(5, p.brightness ?? 5)) / 5;
  return scale(c, k * (mode === 0 ? 0 : 1));
}

// Режимы, которые отвечают на нажатия: 2 — клавиша загорается, 3 — гаснет. На большой карте и в зеркале их зажигают
// настоящие нажатия (пока окно программы в фокусе), а не выдуманные, как в мини-превью галереи.
export const REACTIVE = { 2: "on", 3: "off" };
const hits = new Map(); // light_index → время нажатия, с
document.addEventListener("keydown", (e) => {
  const hid = CODE_HID[e.code], k = hid != null && keyByHid(hid);
  if (k) hits.set(k.light_index, performance.now() / 1000);
}, true);
export function liveEffectColor(mode, key, t, p) {
  const react = REACTIVE[mode];
  if (!react) return effectColor(mode, key, t, p);
  const life = 0.3 + (5 - (+p.speed || 0)) * 0.14;            // медленнее скорость — дольше след
  const age = performance.now() / 1000 - (hits.get(key.li) ?? -99), q = age < life ? age / life : 1;
  return effectColor(1, key, t, p).map((x) => x * (react === "on" ? 1 - q : q));
}

// Мини-превью: одна петля rAF на все видимые canvas, ~24 кадра в секунду.
const minis = new Set();
let raf = 0, last = 0;
const io = new IntersectionObserver((es) => es.forEach((e) => { const m = [...minis].find((x) => x.cv === e.target); if (m) m.visible = e.isIntersecting; }));

export function mountMini(cv, mode, paramsFn) {
  const m = { cv, mode, paramsFn, visible: true, ctx: cv.getContext("2d") };
  const dpr = Math.min(2, devicePixelRatio || 1);
  const r = cv.getBoundingClientRect();
  cv.width = Math.max(1, Math.round((r.width || 190) * dpr)); cv.height = Math.max(1, Math.round((r.height || 70) * dpr));
  minis.add(m); io.observe(cv);
  if (!raf) raf = requestAnimationFrame(loop);
  return () => { minis.delete(m); io.unobserve(cv); };
}

function loop(now) {
  raf = minis.size ? requestAnimationFrame(loop) : 0;
  if (now - last < 40) return;
  last = now;
  const t = now / 1000, g = geometry();
  for (const m of minis) {
    if (!m.visible) continue;
    const { ctx, cv } = m, W = cv.width, H = cv.height, pad = W * .04;
    const p = m.paramsFn();
    ctx.fillStyle = "#050912"; ctx.fillRect(0, 0, W, H);
    for (const key of g.keys) {
      const c = effectColor(m.mode, key, t, p);
      const x = pad + key.rx * (W - 2 * pad), y = pad + key.ry * (H - 2 * pad);
      const w = key.rw * (W - 2 * pad) - 1.2, h = key.rh * (H - 2 * pad) - 1.2;
      const lit = Math.max(c[0], c[1], c[2]) > 8;
      ctx.fillStyle = lit ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : "#111a30";
      ctx.fillRect(x, y, w, h);
    }
  }
}
