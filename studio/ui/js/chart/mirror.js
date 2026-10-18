// Зеркало подсветки: на карте горит то же, что на клавиатуре.
// Когда сервис рисует сам (подсказки горячих клавиш, язык ввода, Claude Code, таймер, живые режимы),
// берём его настоящий кадр из GET /api/live/frame. Когда сервис молчит, горит то, что сохранено в клавиатуре:
// встроенный эффект (приближённое превью, chart/effects.js) или свои цвета. Нет связи с клавиатурой — карта не светится.
import { store } from "../core/store.js";
import { get } from "../core/api.js";
import { liveEffectColor, geometry } from "./effects.js";
import { reduceMotion } from "../core/dom.js";
export function mirror(chart, { alpha = .62, fps = 15, poll = 160 } = {}) {
  const g = geometry();
  let live = null, ver = 0, raf = 0, last = 0, timer = 0, stopped = false, shown = "";

  async function pull() {
    if (stopped) return;
    if (document.visibilityState === "visible" && store.status?.connected !== false) {
      try { live = (await get("/api/live/frame")).frame; } catch { live = null; }
      ver++;
    }
    if (!stopped) timer = setTimeout(pull, poll);
  }

  function frame(now) {
    if (stopped) return;
    raf = requestAnimationFrame(frame);
    if (now - last < 1000 / fps) return;
    last = now;
    const connected = (store.status || store.server)?.connected;
    const L = store.server.profile.lighting;
    let fills = null, key = "";
    if (!connected) key = "off";
    else if (live) { fills = new Map(Object.entries(live).map(([li, c]) => [+li, c])); key = "live"; }
    else if (L.kind === "user") {
      const k = Math.max(0, Math.min(5, +(L.user_brightness ?? 5))) / 5;
      fills = new Map(Object.entries(L.user_colors || {}).map(([li, c]) => [+li, c.map((v) => v * k)]));
      key = "user" + k;
    } else if (+L.mode && +L.brightness) {
      const t = reduceMotion() ? 1.2 : now / 1000, p = { ...L, mode: +L.mode };
      fills = new Map();
      for (const k of g.keys) { const c = liveEffectColor(p.mode, k, t, p); if (Math.max(c[0], c[1], c[2]) > 6) fills.set(k.li, c); }
      key = "fx";
    } else key = "dark";
    // статичные состояния не перерисовываем каждый кадр
    const sig = key === "fx" ? key + now : key === "live" ? key + ver : key;
    if (sig === shown) return;
    shown = sig;
    chart.update({ fills: fills || new Map(), fillAlpha: alpha });
  }

  pull();
  raf = requestAnimationFrame(frame);
  return () => { stopped = true; clearTimeout(timer); cancelAnimationFrame(raf); };
}
