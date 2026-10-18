// Небольшие помощники DOM. Разметка собирается шаблонными строками, всё внешнее экранируется через esc().
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function h(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.childElementCount === 1 ? t.content.firstElementChild : t.content;
}

// Делегирование событий: on(root, "click", "[data-act]", (e, el) => …)
export function on(root, type, selector, fn, opts) {
  const handler = (e) => {
    const el = e.target.closest(selector);
    if (el && root.contains(el)) fn(e, el);
  };
  root.addEventListener(type, handler, opts);
  return () => root.removeEventListener(type, handler, opts);
}

export const fmt = {
  int: (n) => Number(n || 0).toLocaleString("ru-RU"),
  bytes: (n) => `${Number(n).toLocaleString("ru-RU")} байт`,
  ms: (n) => (n >= 1000 ? `${(n / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} с` : `${n} мс`),
  date: (iso) => { if (!iso) return ""; const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }); },
  dateTime: (iso) => { if (!iso) return ""; const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); },
  left: (s) => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60); return m >= 1 ? `${m}:${String(s % 60).padStart(2, "0")}` : `${s} с`; },
  plural: (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many; },
};

// Тот же элемент без обработчиков: для контейнеров, которые перерисовываются целиком и вешают делегирование заново.
export function fresh(el) { const n = el.cloneNode(false); el.replaceWith(n); return n; }

// Перерисовать кусок разметки, не потеряв фокус клавиатуры: тот же элемент ищется по id или первому data-атрибуту.
// root — элемент или функция, которая его находит (если fn заменяет сам контейнер).
export function keepFocus(rootOf, fn) {
  const get = typeof rootOf === "function" ? rootOf : () => rootOf;
  const root = get(), a = document.activeElement;
  let sel = null;
  if (root && a && a !== root && root.contains(a)) {
    if (a.id) sel = "#" + CSS.escape(a.id);
    else {   // по всем data-*: у кнопок одной группы первый атрибут общий (data-set="debounce"), различает второй
      const d = Object.entries(a.dataset).filter(([k]) => k !== "tip");
      if (d.length) sel = d.map(([k, val]) => `[data-${k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}="${CSS.escape(val)}"]`).join("");
    }
  }
  fn();
  if (sel) get()?.querySelector(sel)?.focus({ preventScroll: true });
}

export const hex = (c) => "#" + c.map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, "0")).join("");
export const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

export const reduceMotion = () =>
  document.documentElement.dataset.motion === "reduce" ||
  (document.documentElement.dataset.motion !== "full" && matchMedia("(prefers-reduced-motion: reduce)").matches);

// Плавная смена DOM через View Transitions, если браузер умеет и движение не выключено.
// В скрытом окне браузер пропускает переход — тогда меняем DOM сразу, чтобы раздел точно смонтировался.
// Если окно не рисуется (перекрыто, панель свёрнута), браузер не вызовет обновление вовсе: через 600 мс делаем его сами.
export function transition(update) {
  let ran = false;
  const run = () => { if (!ran) { ran = true; update(); } };
  if (!document.startViewTransition || reduceMotion() || document.visibilityState !== "visible") { run(); return Promise.resolve(); }
  const vt = document.startViewTransition(run);
  vt.ready.catch(() => {});
  const guard = new Promise((r) => setTimeout(() => { if (!ran) { try { vt.skipTransition(); } catch {} run(); } r(); }, 600));
  return Promise.race([vt.finished.catch(() => {}), guard]);
}
