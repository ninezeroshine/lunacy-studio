// Сцена проигрывания макроса: та же иллюстрация клавиатуры, что на «Клавишах», и окно «что напечатается».
// Клавиши макроса светятся приглушённым золотом, клавиша запуска обведена. «Проиграть» показывает макрос
// в его собственном ритме: колпачки нажимаются и вспыхивают, текст печатается по буквам.
// Это модель, а не перехват клавиатуры: сам макрос проигрывает прошивка по назначенной клавише.
import { createChart } from "../chart/real.js";
import { keyByHid, keyByIndex, fullName } from "../core/keydata.js";

const FAST_STEP = 90;                    // макрос без пауз прошивка играет мгновенно — для глаз по 90 мс на шаг
const USED = [255, 158, 36], HELD = [110, 255, 190];      // золото — клавиши макроса, мята — нажата сейчас

// События макроса во времени: [{t, k, val, i}], i — номер шага.
export function timeline(acts) {
  const evs = []; let t = 0;
  acts.forEach(([k, val], i) => { if (k === "delay") t += Math.max(10, +val); else evs.push({ t, k, val, i }); });
  const slow = t === 0;
  if (slow) evs.forEach((e, n) => { e.t = n * FAST_STEP; });
  const end = (evs.length ? evs[evs.length - 1].t : 0) + 450;
  return { evs, end, slow };
}

export function mountStage(host, { acts, triggers, typedAt, picked = null, picking = false, onPick }) {
  const txt = host.querySelector(".m-typed .txt"), bar = host.querySelector(".m-prog i");
  const used = new Map();
  acts.forEach(([k, val]) => { if (k === "down") { const key = keyByHid(val); if (key) used.set(key.key_index, key.light_index); } });
  const chart = createChart(host.querySelector(".m-chart"), { compact: true, onSelect: (k) => onPick?.(k),
    label: picking ? "Выбери клавишу для запуска макроса" : "Клавиши макроса на клавиатуре" });
  host.classList.toggle("picking", picking);
  const trig = triggers.map((i) => keyByIndex(i)).filter(Boolean);
  const base = () => new Map([...used.values()].map((li) => [li, USED]));
  chart.update({ fills: base(), fillAlpha: 1, selected: picked ?? (picking ? null : trig[0]?.key_index ?? null),
    annot: "", annotRight: picking ? "выбери клавишу" : trig.length ? `запуск: ${trig.map((k) => fullName(k)).join(", ")}` : "" });
  const tl = timeline(acts);
  let raf = 0, t0 = 0, held = new Set();

  function frame(now) {
    const t = now - t0, down = new Map();
    let last = -1;
    for (const e of tl.evs) {
      if (e.t > t) break;
      last = e.i;
      const key = (e.k === "down" || e.k === "up") ? keyByHid(e.val) : null;
      if (!key) continue;
      if (e.k === "down") down.set(key.key_index, key.light_index); else down.delete(key.key_index);
    }
    const now2 = new Set(down.keys());
    for (const i of now2) if (!held.has(i)) chart.hold(i);
    for (const i of held) if (!now2.has(i)) chart.release(i);
    if (now2.size !== held.size || [...now2].some((i) => !held.has(i))) {
      const f = base(); for (const li of down.values()) f.set(li, HELD);
      chart.update({ fills: f, fillAlpha: 1 });
    }
    held = now2;
    txt.textContent = last >= 0 ? typedAt(last) : "";
    bar.style.width = `${Math.min(100, (t / tl.end) * 100)}%`;
    if (t < tl.end) raf = requestAnimationFrame(frame);
    else finish();
  }

  function finish() {
    raf = 0;
    for (const i of held) chart.release(i);
    held = new Set();
    chart.update({ fills: base(), fillAlpha: 1 });
    host.classList.remove("playing");
  }

  txt.textContent = acts.length ? typedAt(acts.length - 1) : "";
  return {
    play() {
      if (!tl.evs.length) return;
      cancelAnimationFrame(raf); t0 = performance.now(); host.classList.add("playing");
      const reduce = document.documentElement.dataset.motion === "reduce"
        || (matchMedia("(prefers-reduced-motion: reduce)").matches && document.documentElement.dataset.motion !== "full");
      if (reduce) { txt.textContent = typedAt(acts.length - 1); bar.style.width = "100%"; host.classList.remove("playing"); return; }
      raf = requestAnimationFrame(frame);
    },
    stop() { cancelAnimationFrame(raf); finish(); },
    destroy() { cancelAnimationFrame(raf); chart.destroy(); },
    slow: tl.slow, duration: tl.end,
  };
}
