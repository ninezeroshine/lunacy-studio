// Раздел «Обзор» — первая страница: всё главное одним взглядом.
// Сверху «пульт телеметрии» (overview-rig.js, набор anatomy) — живые приборы нагрузки компьютера и темпа печати,
// рядом клавиатура с переназначенными клавишами. Ниже плитки: печать за час, нагрузка за 5 минут, макросы,
// подсветка, экран, фокус-таймер, Claude Code, активная программа, профили. Каждая плитка ведёт в свой раздел.
// Данные: /api/status (раз в секунду, уже опрашивает каркас), /api/stats?history=1 (раз в 2 с), /api/library.
import { $, $$, esc, on, fmt } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { store, on as subscribe } from "../core/store.js";
import { get, post } from "../core/api.js";
import { toast, toastError } from "../core/feedback.js";
import { ensureIsoCss } from "../core/iso-theme.js";
import { createChart } from "../chart/real.js";
import { keyByIndex, macroBytes, MACRO_LIMIT } from "../core/keydata.js";
import { mountRig } from "./overview-rig.js";

let v = null;
const loadHist = { t: [], cpu: [], gpu: [], ram: [] };     // последняя история с сервиса: переживает уход со страницы

export default {
  id: "overview", title: "Обзор", icon: "telescope",
  onServer() { if (v) { renderHead(); renderKb(); renderTiles(); } },

  mount(root, ctx) {
    ensureIsoCss();
    v = { root, ctx, offs: [], timers: [], stats: null, lib: null, lastToday: null, chart: null, rig: null };
    root.innerHTML = `
      <div class="page ov">
        <div class="page-head">
          <div><h1 id="ovHello">Обзор</h1><p class="lead" id="ovLead"></p></div>
          <div class="ov-chips" id="ovChips"></div>
        </div>
        <div class="ov-top">
          <section class="panel ov-rig" aria-labelledby="ovRigT">
            <div class="iso iso-dash ov-plate">
              <div class="ov-corners" aria-hidden="true"><span data-c="fig">Пульт</span><span data-c="title" id="ovRigT">Телеметрия</span>
                <span data-c="hint">Стрелки, колбы и клавиша — живые</span><span data-c="readout" id="ovReadout">…</span></div>
              <div class="ov-stage" id="ovRig"></div>
            </div>
            <div class="ov-legend" id="ovLegend"></div>
          </section>
          <section class="panel ov-kb ov-link" data-go="keys" aria-labelledby="ovKbT"><div class="panel-body stack">
            <div class="row between"><h2 id="ovKbT">Клавиатура</h2><span class="ov-more">${icon("right")}</span></div>
            <div class="ov-kbchart" id="ovKbChart"></div>
            <div class="ov-kbfacts" id="ovKbFacts"></div>
          </div></section>
        </div>
        <div class="ov-tiles" id="ovTiles"></div>
      </div>`;
    // клавиатура: переназначенные клавиши золотом, Fn-слой — серебром
    v.chart = createChart($("#ovKbChart", root), { compact: true, interactive: false, persist: false, label: "Переназначенные клавиши" });
    v.rig = mountRig($("#ovRig", root));

    v.offs.push(
      subscribe("status", onStatus),
      on(root, "click", "[data-go]", (e, el) => { if (e.target.closest("button:not([data-go]), a")) return; ctx.go(el.dataset.go); }),
      on(root, "keydown", "[data-go]", (e, el) => { if ((e.key === "Enter" || e.key === " ") && e.target === el) { e.preventDefault(); ctx.go(el.dataset.go); } }),
      on(root, "click", "[data-timer]", (e, el) => timer(el)),
      on(root, "pointermove", ".spark", sparkHover),
      on(root, "pointerleave", ".spark", sparkLeave, true),
    );
    pollStats(); v.timers.push(setInterval(pollStats, 2000));
    get("/api/library").then((r) => { if (v) { v.lib = r.items; renderTiles(); } }).catch(() => {});
    renderHead(); renderKb(); renderTiles(); renderRig();
    if (store.status) onStatus(store.status);
    return () => { v.offs.forEach((f) => f()); v.timers.forEach(clearInterval); v.rig?.destroy(); v.chart?.destroy?.(); v = null; };
  },
};

// ---------- данные ----------
async function pollStats() {
  const cur = v;
  try {
    const s = await get("/api/stats?history=1");
    if (v !== cur) return;
    v.stats = s; Object.assign(loadHist, s.history || {});
    renderRig(); renderTiles();
  } catch { if (v === cur) { v.stats = null; renderRig(); } }
}

function onStatus(st) {
  if (!v) return;
  const a = st.activity;
  if (a) {
    if (v.lastToday != null && a.today > v.lastToday) v.rig.taps(a.today - v.lastToday);
    v.lastToday = a.today;
    v.rig.today(a.today);
  }
  renderHead(); renderTiles();
}

// ---------- шапка ----------
function renderHead() {
  const h = new Date().getHours();
  $("#ovHello", v.root).textContent = h < 5 ? "Доброй ночи" : h < 12 ? "Доброе утро" : h < 18 ? "Добрый день" : "Добрый вечер";
  const st = store.status || store.server, dev = store.server.device || {};
  const conn = !st?.connected ? "клавиатура не подключена" : st.wireless ? "клавиатура на связи по радио" : "клавиатура на связи по кабелю";
  const lead = `Lunacy In Space — ${conn}${dev.firmware ? `, прошивка ${dev.firmware}` : ""}.`;
  const el = $("#ovLead", v.root); if (el.textContent !== lead) el.textContent = lead;
  const chips = [
    st?.connected ? `<span class="tag ok">${icon("plug")}${st.wireless ? "Радио" : "USB"}</span>` : `<span class="tag warn">${icon("plug")}Нет связи</span>`,
    store.server.active_profile ? `<span class="tag">${icon("layers")}${esc(store.server.active_profile)}</span>` : "",
    st?.vendor_app ? `<span class="tag warn">${icon("warn")}Открыта фирменная программа</span>` : "",
  ].join("");
  const c = $("#ovChips", v.root); if (c.innerHTML !== chips) c.innerHTML = chips;
}

// ---------- пульт ----------
function renderRig() {
  const s = v.stats;
  const ramTotal = s?.ram_total_gb, vramTotal = s?.vram_total_gb;
  v.rig.set({ cpu: s ? s.cpu / 100 : 0, gpu: s?.gpu != null ? s.gpu / 100 : 0,
    ram: s?.ram != null ? s.ram / 100 : 0, vram: s?.vram_gb != null && vramTotal ? s.vram_gb / vramTotal : 0 });
  const num = (x, d = 1) => x == null ? "—" : x.toFixed(d).replace(".", ",");
  $("#ovReadout", v.root).textContent = s ? `CPU ${Math.round(s.cpu)} % · GPU ${s.gpu == null ? "—" : Math.round(s.gpu) + " %"}${s.gpu_temp != null ? ` · ${Math.round(s.gpu_temp)} °C` : ""}` : "нет данных";
  const today = store.status?.activity?.today;
  const items = [
    ["mid", "CPU", s ? `${Math.round(s.cpu)} %` : "—", "левый прибор"],
    ["mid", "GPU", s?.gpu != null ? `${Math.round(s.gpu)} %` : "нет данных", "правый прибор"],
    ["hi", "RAM", s ? `${num(s.ram_gb)} из ${num(ramTotal, 0)} ГБ` : "—", "левая колба"],
    ["hi", "Видеопамять", s?.vram_gb != null ? `${num(s.vram_gb)} из ${num(vramTotal, 0)} ГБ` : "нет данных", "правая колба"],
    ["lit", "Печать", today != null ? `${today.toLocaleString("ru-RU")} нажатий сегодня` : "—", "клавиша и табло"],
  ];
  const html = items.map(([m, t, val, where]) => `<span class="ov-key"><i class="ov-sw" data-m="${m}"></i><b>${t}</b><span>${esc(val)}</span><small>${where}</small></span>`).join("");
  const box = $("#ovLegend", v.root); if (box.innerHTML !== html) box.innerHTML = html;
}

// ---------- клавиатура ----------
function renderKb() {
  const km = store.server.profile.keymap || {}, fills = new Map();
  let base = 0, fn = 0;
  for (const [idx] of Object.entries(km.fn || {})) { const k = keyByIndex(+idx); if (k) { fills.set(k.light_index, [158, 172, 206]); fn++; } }
  for (const [idx] of Object.entries(km.base || {})) { const k = keyByIndex(+idx); if (k) { fills.set(k.light_index, [224, 196, 140]); base++; } }
  v.chart.update({ fills, fillAlpha: 1, annot: "", annotRight: "" });
  const trig = (store.server.profile.triggers || []).length, macros = (store.server.profile.macros || []).length;
  $("#ovKbFacts", v.root).innerHTML = `
    <div class="ov-fact"><i class="ov-dot" style="--c:#e0c48c"></i><b>${base}</b><span>${fmt.plural(base, "клавиша переназначена", "клавиши переназначены", "клавиш переназначено")}</span></div>
    <div class="ov-fact"><i class="ov-dot" style="--c:#9eacce"></i><b>${fn}</b><span>в Fn-слое</span></div>
    <div class="ov-fact"><i class="ov-dot hollow"></i><b>${macros}</b><span>${fmt.plural(macros, "макрос", "макроса", "макросов")}${trig ? `, ${trig} на сочетаниях` : ""}</span></div>`;
}

// ---------- плитки ----------
const sig = new Map();
function tile(id, go, title, ic, body) {
  return `<article class="panel ov-tile ov-link" data-tile="${id}" data-go="${go}" tabindex="0" aria-label="${esc(title)} — открыть раздел">
    <div class="ov-tile-h">${icon(ic)}<h3>${title}</h3><span class="ov-more">${icon("right")}</span></div>${body}</article>`;
}

function renderTiles() {
  const box = $("#ovTiles", v.root); if (!box) return;
  const html = [typingTile(), loadTile(), macrosTile(), lightTile(), screenTile(), timerTile(), claudeTile(), appTile(), profileTile()].join("");
  if (sig.get(box) === html) return;
  // не перерисовывать под курсором: подсказка графика живёт внутри плитки
  if (box.querySelector(".spark.hovering")) return;
  sig.set(box, html); box.innerHTML = html;
}

function typingTile() {
  const a = store.status?.activity, kpm = a?.kpm || [];
  const now = kpm.length ? kpm[kpm.length - 1] : 0, hour = kpm.reduce((s, x) => s + x, 0);
  const peak = Math.max(0, ...kpm);
  return tile("typing", "signals", "Печать", "keys", `
    <div class="ov-big"><b>${hour.toLocaleString("ru-RU")}</b><span>${fmt.plural(hour, "нажатие", "нажатия", "нажатий")} за час</span></div>
    ${spark(kpm, { max: Math.max(10, peak), unit: "в мин", label: "Нажатий в минуту за последний час", ago: (i, n) => n - 1 - i, agoUnit: "мин" })}
    <p class="ov-sub">Сейчас ${now} в мин · пик ${peak} · сегодня ${(a?.today || 0).toLocaleString("ru-RU")}</p>
    <p class="ov-note">Считается только число нажатий, без того какие клавиши; в памяти, пока работает Studio.</p>`);
}

function loadTile() {
  const s = v.stats, h = loadHist, n = h.t.length;
  const row = (label, arr, val) => `<div class="ov-load"><span class="ov-load-l">${label}</span>
    ${spark(arr, { max: 100, unit: "%", label: `${label} за 5 минут`, ago: (i) => h.t[i], agoUnit: "с", small: true })}<b>${val}</b></div>`;
  return tile("load", "signals", "Нагрузка", "cpu", `
    ${row("CPU", h.cpu, s ? `${Math.round(s.cpu)}%` : "—")}
    ${row("GPU", h.gpu, s?.gpu != null ? `${Math.round(s.gpu)}%` : "—")}
    ${row("RAM", h.ram, s?.ram != null ? `${Math.round(s.ram)}%` : "—")}
    <p class="ov-sub">${n ? `За ${Math.round((h.t[0] || 0) / 60) || 1} мин` : "Собираю данные"}${s?.gpu_temp != null ? ` · GPU ${Math.round(s.gpu_temp)} °C` : ""} · режим «Нагрузка» показывает это на подсветке</p>`);
}

function macrosTile() {
  const list = store.server.profile.macros || [], used = macroBytes(list), pct = Math.min(100, used / MACRO_LIMIT * 100);
  const km = store.server.profile.keymap || {}, onKeys = ["base", "fn"].reduce((s, l) => s + Object.values(km[l] || {}).filter((a) => a?.type === "macro").length, 0);
  const trig = (store.server.profile.triggers || []).length;
  return tile("macros", "macros", "Макросы", "macros", `
    <div class="ov-big"><b>${list.length}</b><span>${fmt.plural(list.length, "макрос", "макроса", "макросов")}</span></div>
    <div class="ov-meter" role="img" aria-label="Память макросов: ${used} из ${MACRO_LIMIT} байт"><i style="width:${pct.toFixed(1)}%"></i></div>
    <p class="ov-sub">${used.toLocaleString("ru-RU")} из ${MACRO_LIMIT.toLocaleString("ru-RU")} байт памяти · ${onKeys} на клавишах${trig ? ` · ${trig} на сочетаниях` : ""}</p>
    ${list.length ? `<ul class="ov-list">${list.slice(0, 3).map((m, i) => `<li>${esc(m.name || `Макрос ${i + 1}`)}<small>${(m.actions || []).length} ${fmt.plural((m.actions || []).length, "шаг", "шага", "шагов")}</small></li>`).join("")}</ul>` : `<p class="ov-note">Пока пусто — запиши первый макрос.</p>`}`);
}

function lightTile() {
  const l = store.server.profile.lighting || {}, eff = store.server.effects || [];
  const name = l.kind === "user" ? "Свои цвета" : (store.server.profile.effect_names?.[l.mode] || eff[l.mode] || `Эффект ${l.mode}`);
  const rgb = l.colorful ? null : l.rgb || [255, 255, 255];
  const bri = l.kind === "user" ? l.user_brightness : l.brightness;
  const live = store.status?.live?.overlay;
  return tile("light", "light", "Подсветка", "light", `
    <div class="ov-light"><i class="ov-swatch${rgb ? "" : " rainbow"}" style="${rgb ? `--c:rgb(${rgb.join(",")})` : ""}"></i>
      <div><b>${esc(name)}</b><span>${rgb ? "один цвет" : "все цвета"}</span></div></div>
    <div class="ov-pips" role="img" aria-label="Яркость ${bri ?? 0} из 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= (bri ?? 0) ? "on" : ""}"></i>`).join("")}<span>яркость ${bri ?? 0} из 5</span></div>
    <p class="ov-sub">${live ? `Сейчас поверх: ${esc(live)}` : "Живых сигналов поверх нет"}</p>`);
}

function screenTile() {
  const sc = store.server.profile.screen || {}, slot = store.server.slots?.[String(sc.slot || 2)];
  const mode = { clock: "Часы и статус", gif: "Анимация", live: "Живые числа" }[sc.display] || sc.display || "—";
  const thumb = slot?.thumb ? `<img src="${esc(slot.thumb)}?v=${esc(slot.uploaded_at || "")}" alt="">` : `<span>${sc.slot === 1 ? "заводская анимация" : "пусто"}</span>`;
  return tile("screen", "screen", "Экран", "screen", `
    <div class="ov-screen"><div class="ov-lcd">${thumb}</div>
      <div><b>${esc(mode)}</b><span>слот ${sc.slot || 2}${slot?.name ? ` · ${esc(slot.name)}` : ""}</span></div></div>
    <p class="ov-sub">${v.lib ? `В «Моих видео»: ${v.lib.length}` : "Мои видео — загружаю…"}</p>`);
}

function timerTile() {
  const t = store.status?.timer || {};
  const left = t.left_s || 0, total = t.total_s || 0, pct = total ? 1 - left / total : 0;
  const mm = Math.floor(left / 60), ss = String(Math.floor(left % 60)).padStart(2, "0");
  const R = 26, C = 2 * Math.PI * R;
  return tile("timer", "signals", "Фокус-таймер", "timer", `
    <div class="ov-timer"><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="${R}" class="trk"/>
      <circle cx="32" cy="32" r="${R}" class="arc" style="stroke-dasharray:${C.toFixed(1)};stroke-dashoffset:${(C * (1 - pct)).toFixed(1)}"/></svg>
      <div><b>${t.running ? `${mm}:${ss}` : t.ringing ? "Время!" : "Не идёт"}</b><span>${t.running ? `из ${Math.round(total / 60)} мин` : "F-ряд покажет прогресс"}</span></div></div>
    <div class="row ov-act">${t.running || t.ringing ? `<button class="btn small" data-timer="cancel">${icon("stop")}Остановить</button>`
      : `<button class="btn small" data-timer="25">${icon("play")}25 мин</button><button class="btn small quiet" data-timer="50">50 мин</button>`}</div>`);
}

function claudeTile() {
  const l = store.status?.live || {}, st = l.claude || "idle";
  const [title, sub] = { idle: ["Не занят", "Ничего не делает"], working: ["Работает", "Клавиатура не отвлекает"], attention: ["Ждёт тебя", "Верхний ряд мигает оранжевым"],
    done: ["Готово", "Короткая зелёная волна"], error: ["Ошибка", "Коралловый пульс по F-ряду"] }[st] || [st, ""];
  return tile("claude", "signals", "Claude Code", "sparkle", `
    <div class="ov-state" data-s="${esc(st)}"><i></i><div><b>${title}</b><span>${sub}</span></div></div>
    <p class="ov-sub">${l.claude_at ? `Последнее событие ${esc(fmt.dateTime(l.claude_at))}` : "Событий ещё не было"}</p>`);
}

function appTile() {
  const l = store.status?.live || {};
  const app = (l.app || "").replace(/\.exe$/i, "") || "—";
  return tile("app", "signals", "Сейчас в фокусе", "eye", `
    <div class="ov-big small"><b>${esc(app)}</b><span>${l.app_profile ? `подсказки: ${esc(l.app_profile)}` : "общие подсказки"}</span></div>
    <div class="ov-lang"><span class="${l.lang === "RU" ? "on" : ""}">RU</span><span class="${l.lang === "EN" ? "on" : ""}">EN</span><small>раскладка ввода</small></div>`);
}

function profileTile() {
  const list = store.server.profiles || [], act = store.server.active_profile;
  return tile("profiles", "settings", "Профили", "layers", `
    <div class="ov-big small"><b>${act ? esc(act) : "Без профиля"}</b><span>${list.length} ${fmt.plural(list.length, "сохранён", "сохранено", "сохранено")}</span></div>
    ${list.length ? `<ul class="ov-list">${list.slice(0, 3).map((p) => `<li>${esc(p.name)}<small>${p.counts?.keys ?? 0} кл · ${p.counts?.macros ?? 0} мкр</small></li>`).join("")}</ul>` : `<p class="ov-note">Сохрани настройку профилем — в «Настройках».</p>`}`);
}

async function timer(el) {
  const val = el.dataset.timer;
  try {
    await post("/api/timer", val === "cancel" ? { cancel: true } : { minutes: +val });
    toast(val === "cancel" ? "Таймер остановлен" : `Фокус на ${val} минут`, { sub: val === "cancel" ? "" : "F-ряд показывает прогресс" });
  } catch (e) { toastError(e); }
}

// ---------- график-строка: одна серия, без легенды, наведение показывает значение ----------
function spark(arr, { max = 100, unit = "", label = "", ago, agoUnit = "", small = false }) {
  const vals = arr.map((x) => (x == null ? null : +x));
  const Wd = 240, Hd = small ? 28 : 54, n = vals.length;
  if (n < 2) return `<div class="spark empty${small ? " small" : ""}" style="height:${Hd}px">собираю…</div>`;
  const X = (i) => (i / (n - 1)) * Wd, Y = (x) => Hd - 2 - (Math.min(max, x) / max) * (Hd - 4);
  let d = "", area = "", open = false;
  vals.forEach((x, i) => {
    if (x == null) { open = false; return; }
    d += `${open ? "L" : "M"}${X(i).toFixed(1)} ${Y(x).toFixed(1)}`; open = true;
  });
  const firstI = vals.findIndex((x) => x != null), lastI = n - 1 - [...vals].reverse().findIndex((x) => x != null);
  if (firstI >= 0) area = `M${X(firstI).toFixed(1)} ${Hd}` + vals.map((x, i) => x == null || i < firstI || i > lastI ? "" : `L${X(i).toFixed(1)} ${Y(x).toFixed(1)}`).join("") + `L${X(lastI).toFixed(1)} ${Hd}Z`;
  const data = esc(JSON.stringify({ v: vals, unit, max, a: vals.map((_, i) => ago(i, n)), au: agoUnit }));
  return `<div class="spark${small ? " small" : ""}" data-spark="${data}" role="img" aria-label="${esc(label)}">
    <svg viewBox="0 0 ${Wd} ${Hd}" preserveAspectRatio="none"><path class="sa" d="${area}"/><path class="sl" d="${d}"/>
    <line class="sx" x1="0" x2="0" y1="0" y2="${Hd}" hidden/><circle class="sd" r="3" hidden/></svg><span class="stip" hidden></span></div>`;
}

function sparkHover(e, el) {
  const info = JSON.parse(el.dataset.spark || "null"); if (!info) return;
  el.classList.add("hovering");
  const svg = $("svg", el), r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal, n = info.v.length;
  const i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1))));
  const val = info.v[i], x = (i / (n - 1)) * vb.width;
  const line = $(".sx", el), dot = $(".sd", el), tip = $(".stip", el);
  line.hidden = false; line.setAttribute("x1", x); line.setAttribute("x2", x);
  if (val == null) { dot.hidden = true; tip.textContent = "нет данных"; }
  else {
    dot.hidden = false; dot.setAttribute("cx", x); dot.setAttribute("cy", vb.height - 2 - (Math.min(info.max, val) / info.max) * (vb.height - 4));
    const a = info.a[i];
    tip.textContent = `${Math.round(val)} ${info.unit} · ${a ? `${a} ${info.au} назад` : "сейчас"}`;
  }
  tip.hidden = false; tip.style.left = `${Math.min(r.width - 8, Math.max(8, (i / (n - 1)) * r.width))}px`;
}
function sparkLeave(e, el) {
  el.classList.remove("hovering");
  $$(".sx, .sd, .stip", el).forEach((x) => { x.hidden = true; });
}
