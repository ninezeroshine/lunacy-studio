// Раздел «Сигналы»: клавиатура подсказывает и сообщает, не отвлекая.
// Подсказчик горячих клавиш, индикатор раскладки, Claude Code, фокус-таймер, тепловая карта.
// Всё это рисует сервис поверх подсветки, пока он запущен.
import { $, $$, esc, on, fmt, hex, keepFocus, fresh } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { store, local, on as onTopic } from "../core/store.js";
import { get, post } from "../core/api.js";
import { toast, toastError, act, confirmDialog, setMsg } from "../core/feedback.js";
import { createChart } from "../chart/real.js";
import { keys, keyByHid, fullName } from "../core/keydata.js";

// имена клавиш из hotkeys.json → HID: таблицу отдаёт сервис (NAME_TO_HID в studio/keys.py)
const nameHid = (name) => store.server.hotkeys.name_hid?.[name];
const MOD_HIDS = { ctrl: [0xe0, 0xe4], shift: [0xe1, 0xe5], alt: [0xe2, 0xe6], win: [0xe3] };
const MOD_LABEL = { ctrl: "Ctrl", shift: "Shift", alt: "Alt", win: "Win" };
const comboText = (c) => c.split("+").map((m) => MOD_LABEL[m] || m).join("+");
const keyText = (name) => ({ Right: "→", Left: "←", Up: "↑", Down: "↓", Space: "Пробел", Delete: "Del", PageUp: "PgUp", PageDown: "PgDn" })[name] || name;
const CLAUDE = {
  idle: ["Не занят", "Claude Code сейчас ничего не делает."],
  working: ["Работает", "Пока Claude думает, клавиатура не отвлекает. Если включена живая подсветка, по F-ряду идёт тусклая волна."],
  attention: ["Ждёт тебя", "Нужно разрешение или ответ: верхний ряд и Enter мигают оранжевым, пока не нажмёшь любую клавишу (до 2 минут)."],
  done: ["Готово", "Ответ готов: короткая зелёная волна по клавиатуре."],
  error: ["Ошибка", "Запрос оборвался: короткий коралловый пульс по F-ряду и Esc."],
};

let v = null;

export default {
  id: "signals", title: "Сигналы", icon: "signals",

  mount(root, ctx) {
    const apps = store.server.hotkeys.apps;
    v = { root, ctx, view: ctx.params.view === "heat" ? "heat" : ctx.params.find ? "hk" : local.get("sigView", "hk"),
      app: apps[local.get("sigApp")] ? local.get("sigApp") : "common", combo: local.get("sigCombo", "ctrl"), held: null,
      q: "", hooks: store.server.claude_hooks || null, timerMin: local.get("timerMin", 25) };
    root.innerHTML = `
      <div class="page">
        <div class="page-head">
          <div><h1>Сигналы</h1>
            <p class="lead">Клавиатура подсказывает и сообщает, не отвлекая. Сигналы рисует сервис поверх подсветки, пока он запущен.</p></div>
        </div>
        <div class="sig-grid">
          <div class="stack">
            <section class="panel plate">
              <div class="panel-head"><div class="seg" role="tablist" id="sigView">
                <button role="tab" data-view="hk">${icon("star")}Созвездия сочетаний</button><button role="tab" data-view="heat">${icon("light")}Тепловая карта</button></div>
                <span class="annot" id="sigHint"></span></div>
              <div id="chartHost"></div>
              <div class="plate-foot" id="sigFoot"></div>
            </section>
            <section class="panel" id="sigLower"></section>
          </div>
          <div class="cards" id="sigCards"></div>
        </div>
      </div>`;
    v.chart = createChart($("#chartHost", root), { label: "Карта сочетаний", interactive: true, onSelect: (k) => pickKey(k) });
    on($("#sigView", root), "click", "[data-view]", (e, b) => setView(b.dataset.view));
    on(root, "click", "[data-a]", (e, b) => cardAction(b.dataset.a, b));
    on(root, "change", "[data-smart]", (e, inp) => setSmart(inp.dataset.smart, inp.checked, inp));
    renderCards();
    setView(v.view, true);
    if (ctx.params.find) $("#hkFind", root)?.focus(); // из палитры: «Найти сочетание клавиш»
    get("/api/claude/hooks").then((h) => { if (v) { v.hooks = h; renderClaude(); } }).catch(() => {});
    const off = onTopic("status", (st) => { if (v) live(st); });
    return () => { off(); v.chart.destroy(); v = null; };
  },
  onServer() { if (v) { renderCards(); setView(v.view, true); } },

  // зажатый настоящий модификатор показывает свои сочетания, как сам подсказчик на клавиатуре
  onKey(e, phase) {
    if (!v || v.view !== "hk") return;
    if (!/^(Control|Shift|Alt|Meta)/.test(e.code)) return;
    if (e.code.startsWith("Alt")) e.preventDefault();
    const mods = ["ctrl", "alt", "shift", "win"].filter((m) => ({ ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, win: e.metaKey })[m]);
    const combo = orderCombo(mods);
    if (phase === "down" && combo && combosFor(v.app).includes(combo)) { v.held ??= v.combo; v.combo = combo; renderHk(); }
    if (phase === "up" && v.held && !combo) { v.combo = v.held; v.held = null; renderHk(); }
  },
};

const orderCombo = (mods) => ["ctrl", "alt", "shift", "win"].filter((m) => mods.includes(m)).join("+");

function setView(view, force) {
  if (!v || (!force && v.view === view)) return;
  v.view = view; local.set("sigView", view);
  $$("#sigView [data-view]", v.root).forEach((b) => b.setAttribute("aria-selected", b.dataset.view === view));
  view === "heat" ? renderHeat() : renderHk();
}

// ================= созвездия горячих клавиш =================
function combosFor(app) {
  const A = store.server.hotkeys.apps, set = new Set(Object.keys(A.common.combos));
  if (app !== "common") Object.keys(A[app].combos).forEach((c) => set.add(c));
  const order = ["ctrl", "alt", "shift", "win", "ctrl+shift", "ctrl+alt", "alt+shift", "ctrl+win", "shift+win", "ctrl+alt+shift"];
  return [...set].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
}
// общие сочетания, поверх — сочетания программы (как keys_for в live.py)
function entries(app, combo) {
  const A = store.server.hotkeys.apps, out = new Map();
  for (const name of ["common", app]) {
    for (const [key, cat, label] of A[name]?.combos?.[combo] || []) {
      const k = keyByHid(nameHid(key));
      if (k) out.set(k.light_index, { k, key, cat, label, app: name });
    }
  }
  return [...out.values()];
}

function renderHk() {
  const H = store.server.hotkeys, cats = H.categories, combos = combosFor(v.app);
  if (!combos.includes(v.combo)) v.combo = combos[0];
  local.set("sigApp", v.app); local.set("sigCombo", v.combo);
  const list = entries(v.app, v.combo);
  const fills = new Map(list.map((e) => [e.k.light_index, cats[e.cat]?.rgb || [255, 255, 255]]));
  const subs = new Map(list.map((e) => [e.k.key_index, e.label]));
  const states = new Map();
  for (const m of v.combo.split("+")) for (const h of MOD_HIDS[m] || []) { const k = keyByHid(h); if (k) { states.set(k.key_index, "held"); } }
  const groups = Object.keys(cats).map((c) => ({ color: hex(cats[c].rgb), keys: list.filter((e) => e.cat === c).map((e) => e.k.key_index) })).filter((g) => g.keys.length > 1);
  v.chart.update({ fills, fillAlpha: .7, subs, states, constellation: groups, selected: null, arcs: [],
    annot: `${H.apps[v.app].label} · ${comboText(v.combo)}`, annotRight: `${list.length} ${fmt.plural(list.length, "сочетание", "сочетания", "сочетаний")}` });
  $("#sigHint", v.root).textContent = "зажми Ctrl, Alt или Shift — карта переключится";
  const used = new Set(list.map((e) => e.cat));
  $("#sigFoot", v.root).innerHTML = `<div class="cat-legend">${Object.entries(cats).map(([id, c]) => `<span ${used.has(id) ? "" : 'style="opacity:.4"'}><i style="background:${hex(c.rgb)}"></i>${esc(c.label)}</span>`).join("")}</div>`;

  const apps = Object.entries(H.apps);
  $("#sigLower", v.root).innerHTML = `
    <div class="panel-body stack">
      <div class="row between wrap">
        <div class="field" style="min-width:220px"><label for="hkApp">Программа</label>
          <select class="select" id="hkApp">${apps.map(([id, a]) => `<option value="${id}" ${id === v.app ? "selected" : ""}>${esc(a.label)}</option>`).join("")}</select></div>
        <div class="field"><span class="label">Модификатор</span>
          <div class="seg" id="hkCombo">${combos.map((c) => `<button data-c="${c}" aria-pressed="${c === v.combo}">${comboText(c)}</button>`).join("")}</div></div>
      </div>
      <div class="field"><label for="hkFind">Найти сочетание</label>
        <input class="input" id="hkFind" type="search" placeholder="Например: копировать, вкладка, слой" value="${esc(v.q)}" autocomplete="off"></div>
      <div class="hk-list" id="hkList"></div>
      <p class="note">Подсказчик на клавиатуре сам узнаёт программу в фокусе${store.status?.live?.app ? ` (сейчас: ${esc(store.status.live.app)})` : ""}. Щелчок по строке — показать клавишу на клавиатуре.</p>
    </div>`;
  $("#hkApp", v.root).onchange = (e) => { v.app = e.target.value; v.held = null; renderHk(); };
  on($("#hkCombo", v.root), "click", "[data-c]", (e, b) => { v.combo = b.dataset.c; v.held = null; renderHk(); });
  const find = $("#hkFind", v.root);
  find.oninput = () => { v.q = find.value; renderList(); };
  on($("#hkList", v.root), "click", "[data-li]", (e, b) => showOne(b));
  on($("#hkList", v.root), "pointerover", "[data-li]", (e, b) => v.chart.update({ selected: +b.dataset.ki }));
  $("#hkList", v.root).addEventListener("pointerleave", () => v.chart.update({ selected: null }));
  renderList();
}

function renderList() {
  const box = $("#hkList", v.root), cats = store.server.hotkeys.categories, q = v.q.trim().toLowerCase();
  let rows;
  if (q) {
    rows = [];
    for (const [app, a] of Object.entries(store.server.hotkeys.apps)) for (const [combo, list] of Object.entries(a.combos)) {
      for (const [key, cat, label] of list) if (label.toLowerCase().includes(q) || key.toLowerCase() === q) {
        const k = keyByHid(nameHid(key)); if (k) rows.push({ app, combo, key, cat, label, k });
      }
    }
  } else rows = entries(v.app, v.combo).map((e) => ({ ...e, combo: v.combo })).sort((a, b) => a.cat.localeCompare(b.cat) || a.label.localeCompare(b.label, "ru"));
  box.innerHTML = rows.length ? rows.slice(0, 80).map((r) => `
    <button data-li="${r.k.light_index}" data-ki="${r.k.key_index}" data-app="${r.app}" data-combo="${r.combo}">
      <kbd>${esc(comboText(r.combo))}+${esc(keyText(r.key))}</kbd>
      <span>${esc(r.label)}${q && r.app !== "common" ? ` <span class="muted">· ${esc(store.server.hotkeys.apps[r.app].label)}</span>` : ""}</span>
      <i style="background:${hex(cats[r.cat]?.rgb || [255, 255, 255])}" title="${esc(cats[r.cat]?.label || "")}"></i>
    </button>`).join("") : `<p class="note" style="padding:8px 10px">${q ? "Ничего не нашлось. Попробуй другое слово: «вставить», «новая», «закрыть»." : "Для этого модификатора сочетаний нет."}</p>`;
}

function showOne(b) {
  const combo = b.dataset.combo, app = b.dataset.app;
  if (v.q && (combo !== v.combo || (app !== "common" && app !== v.app))) {
    v.combo = combo; if (app !== "common") v.app = app;
    const q = v.q; renderHk(); v.q = q;
  }
  v.chart.update({ selected: +b.dataset.ki });
  flashKeys([+b.dataset.li, ...combo.split("+").flatMap((m) => (MOD_HIDS[m] || []).slice(0, 1)).map((h) => keyByHid(h)?.light_index).filter((x) => x != null)], [216, 189, 132], 1.6);
}

function pickKey(k) {
  if (v.view !== "hk") return;
  const e = entries(v.app, v.combo).find((x) => x.k.key_index === k.key_index);
  v.chart.update({ selected: k.key_index });
  if (e) toast(`${comboText(v.combo)}+${keyText(e.key)} — ${e.label}`);
}

function flashKeys(lis, rgb, seconds = 1.2) {
  if (!store.status?.connected) { toast("Клавиатура не подключена", { sub: "Сочетание показано только на карте" }); return; }
  post("/api/live/flash", { keys: lis, rgb, seconds }).catch(toastError);
}

// ================= тепловая карта =================
function heatData() {
  const heat = store.status?.heatmap || store.server.heatmap || {};
  const total = Object.values(heat).reduce((a, b) => a + b, 0);
  const top = Math.max(1, ...Object.values(heat));
  return { heat, total, top };
}

function renderHeat() {
  const { heat, total, top } = heatData(), counting = !!store.server.profile.smart.heatmap_count;
  const byLi = new Map(keys().map((k) => [k.light_index, k]));
  const fills = new Map(Object.entries(heat).map(([li, n]) => [+li, heatColor(n / top)]));
  const subs = new Map(Object.entries(heat).filter(([, n]) => n / top > .02).map(([li, n]) => [byLi.get(+li)?.key_index, compact(n)]));
  v.chart.update({ fills, fillAlpha: .85, subs, states: new Map(), constellation: [], selected: null, arcs: [],
    annot: "тепловая карта", annotRight: total ? `${fmt.int(total)} ${fmt.plural(total, "нажатие", "нажатия", "нажатий")}` : "пусто" });
  $("#sigHint", v.root).textContent = store.server.heatmap_since ? `с ${fmt.date(store.server.heatmap_since)}` : "";
  $("#sigFoot", v.root).innerHTML = `<div class="heat-scale"><span>реже</span><i></i><span>чаще</span></div><span class="grow"></span>
    <span class="note">Считается только количество нажатий каждой клавиши — без порядка и без текста.</span>`;
  const rows = Object.entries(heat).sort((a, b) => b[1] - a[1]).slice(0, 10);
  $("#sigLower", v.root).innerHTML = `
    <div class="panel-body stack">
      <div class="row between wrap">
        <div class="row"><label class="toggle"><input type="checkbox" id="heatOn" aria-labelledby="heatT" ${counting ? "checked" : ""}><i></i></label><span id="heatT">Считать нажатия</span></div>
        <div class="row"><span class="msg" id="heatMsg"></span>
          <button class="btn small quiet" data-a="heat-live">${icon("light")}Показать на клавиатуре</button>
          <button class="btn small quiet" data-a="heat-reset" ${total ? "" : "disabled"}>${icon("trash")}Обнулить</button></div>
      </div>
      ${total ? `<div><h3>Чаще всего</h3><div class="top-keys">${rows.map(([li, n], i) => `<div><span>${i + 1}. <b>${esc(fullName(byLi.get(+li)) || "#" + li)}</b></span><span class="num">${fmt.int(n)} · ${Math.round(n / total * 100)}%</span></div>`).join("")}</div></div>`
        : `<div class="orn-empty"><p>${counting ? "Подсчёт включён. Попечатай немного — карта начнёт теплеть." : "Подсчёт выключен. Включи его — и через день карта покажет, какие клавиши работают больше всех. Это подсказка, куда поставить макросы и что переназначить."}</p></div>`}
    </div>`;
  $("#heatOn", v.root).onchange = async (e) => {
    const on_ = e.target.checked;
    const r = await act(null, $("#heatMsg", v.root), async () => { await post("/api/smart", { heatmap_count: on_ }); return { message: on_ ? "Считаю" : "Подсчёт остановлен" }; });
    if (r) {
      store.server.profile.smart.heatmap_count = on_;
      if (on_ && !store.server.heatmap_since) store.server.heatmap_since = new Date().toISOString().slice(0, 10);
      renderHeat();
      setMsg($("#heatMsg", v.root), on_ ? "Считаю нажатия" : "Подсчёт остановлен", "ok"); // после перерисовки, иначе сообщение пропадёт
    } else e.target.checked = !on_;
  };
}

const compact = (n) => (n >= 10000 ? Math.round(n / 1000) + "k" : n >= 1000 ? (n / 1000).toFixed(1).replace(".0", "") + "k" : String(n));
// та же формула, что рисует клавиатура (live.py): оттенок от синего к красному, яркость растёт как √x
function heatColor(x) {
  const h = (1 - x) * .66, vv = .08 + .92 * Math.sqrt(x), i = Math.floor(h * 6), f = h * 6 - i;
  const p = 0, q = vv * (1 - f), t = vv * f;
  const [r, g, b] = [[vv, t, p], [q, vv, p], [p, vv, t], [p, q, vv], [t, p, vv], [vv, p, q]][i % 6];
  return [r * 255 | 0, g * 255 | 0, b * 255 | 0];
}

// ================= карточки справа =================
// Полоска колпачков: что загорится на клавиатуре — показано, а не описано. keys: [подпись, цвет?, класс?].
function strip(keys, cls, label) {
  return `<div class="demo-strip ${cls}" role="img" aria-label="${esc(label)}">${keys.map(([t, c, k], i) =>
    `<kbd class="${k || ""}" style="--i:${i}${c ? `;--c:${c}` : ""}">${esc(t)}</kbd>`).join("")}</div>`;
}
const HINT_DEMO = [["Ctrl", null, "mod"], ["A", "#3d7bff", "lit"], ["Z", "#3d7bff", "lit"], ["X", "#3d7bff", "lit"], ["C", "#3d7bff", "lit"],
  ["V", "#3d7bff", "lit"], ["S", "#2fd27a", "lit"], ["W", "#ff4a3d", "lit"], ["T", "#ffa23d", "lit"], ["F", "#2fd6d6", "lit"]];
const LANG_DEMO = ["Й", "Ц", "У", "К", "Е", "Н", "Г", "Ш", "Щ", "З"].map((t) => [t, null, "lit"]);
const CLAUDE_DEMO = [["Esc", null, "esc"], ...Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, null, "f"]), ["Enter", null, "ent"]];

function renderCards() {
  const sm = store.server.profile.smart;
  $("#sigCards", v.root).innerHTML = `
    <section class="panel"><div class="panel-body stack">
      <div class="row between"><h2>Подсказчик</h2><label class="toggle"><input type="checkbox" data-smart="hints" aria-label="Подсказчик горячих клавиш" ${sm.hints ? "checked" : ""}><i></i></label></div>
      <p class="muted">Зажми Ctrl, Alt, Shift или Win — через мгновение загорятся клавиши, у которых есть сочетание, цветом по смыслу.</p>
      ${strip(HINT_DEMO, `hint${sm.hints ? "" : " off"}`, "Пример: зажат Ctrl, клавиши сочетаний горят цветами групп")}
      <div class="ctl-row" ${sm.hints ? "" : 'style="opacity:.5"'}><div class="row between"><h3>Задержка</h3><span class="annot num" id="hdV">${sm.hint_delay_ms} мс</span></div>
        <input class="range" type="range" min="0" max="1000" step="50" id="hintDelay" value="${sm.hint_delay_ms}" style="--p:${sm.hint_delay_ms / 10}%">
        <p class="note">Меньше — подсказка сразу; больше — не мелькает при быстрых сочетаниях.</p></div>
      <span class="msg" data-msg="hints"></span>
    </div></section>

    <section class="panel"><div class="panel-body stack">
      <div class="row between"><h2>Язык ввода</h2><label class="toggle"><input type="checkbox" data-smart="layout_flash" aria-label="Вспышка при смене языка" ${sm.layout_flash ? "checked" : ""}><i></i></label></div>
      <p class="muted">При смене языка буквы вспыхивают: русская — тёплым, английская — холодным.</p>
      ${strip(LANG_DEMO, `lang${sm.layout_flash ? "" : " off"}`, "Пример: буквы вспыхивают тёплым, потом холодным")}
      <div class="row"><button class="btn small" data-a="flash-ru"><i class="dot" style="background:#ff461e"></i>Показать RU</button><button class="btn small" data-a="flash-en"><i class="dot" style="background:#1e6eff"></i>Показать EN</button>
        <span class="msg" data-msg="layout_flash"></span></div>
    </div></section>

    <section class="panel" id="claudeCard"></section>

    <section class="panel" id="timerCard"></section>`;
  const cards = $("#sigCards", v.root);
  const hd = $("#hintDelay", cards);
  hd.oninput = () => { $("#hdV", cards).textContent = hd.value + " мс"; hd.style.setProperty("--p", hd.value / 10 + "%"); };
  hd.onchange = () => setSmart("hint_delay_ms", +hd.value);
  renderClaude(); renderTimer();
}

async function setSmart(key, val, inp) {
  const msg = $(`[data-msg="${key}"]`, v.root) || $(`[data-msg="hints"]`, v.root);
  const r = await act(null, msg, async () => { await post("/api/smart", { [key]: val }); return { message: "Сохранено" }; });
  if (r) { store.server.profile.smart[key] = val; if (key === "hints") renderCards(); if (key === "claude") renderClaude(); }
  else if (inp) inp.checked = !val;
}

async function cardAction(a, b) {
  const letters = keys().filter((k) => k.hid >= 0x04 && k.hid <= 0x1d).map((k) => k.light_index);
  switch (a) {
    case "flash-ru": return flashKeys(letters, [255, 70, 30], 1.2);
    case "flash-en": return flashKeys(letters, [30, 110, 255], 1.2);
    case "claude-test-attention": if (claudeOff()) return; return post("/api/claude", { event: "attention" }).then(() => toast("На клавиатуре: «ждёт тебя»", { sub: "Нажми любую клавишу, чтобы погасить" })).catch(toastError);
    case "claude-test-done": if (claudeOff()) return; return post("/api/claude", { event: "done" }).then(() => toast("На клавиатуре: «готово»")).catch(toastError);
    case "claude-install": return installHooks(b);
    case "claude-uninstall": return uninstallHooks(b);
    case "timer-start": return act(b, $("#timerMsg", v.root), async () => { const r = await post("/api/timer", { minutes: v.timerMin }); store.status && (store.status.timer = r.timer); renderTimer(); return { message: `Таймер на ${v.timerMin} мин` }; }, { busy: "Запускаю…" });
    case "timer-cancel": return act(b, $("#timerMsg", v.root), async () => { const r = await post("/api/timer", { cancel: true }); store.status && (store.status.timer = r.timer); renderTimer(); return { message: "Таймер остановлен" }; }, { busy: "Останавливаю…" });
    case "heat-live": {
      const r = await act(b, $("#heatMsg", v.root), async () => { await post("/api/smart", { software: "heatmap" }); return { message: "Клавиатура показывает тепловую карту" }; }, { busy: "Включаю…" });
      if (r) { store.server.profile.smart.software = "heatmap"; toast("Тепловая карта горит на клавиатуре", { sub: "Выключить — «Подсветка» → «Живая»", undo: () => post("/api/smart", { software: null }).then(() => { store.server.profile.smart.software = null; }).catch(toastError) }); }
      return;
    }
    case "heat-reset": {
      const { total } = heatData();
      const ok = await confirmDialog({ title: "Обнулить тепловую карту?", body: `Будет удалено ${fmt.int(total)} ${fmt.plural(total, "нажатие", "нажатия", "нажатий")}. Вернуть их нельзя; подсчёт начнётся заново с сегодняшнего дня.`, confirm: "Обнулить", danger: true });
      if (!ok) return;
      return act(b, $("#heatMsg", v.root), async () => {
        await post("/api/heatmap/reset", {});
        store.server.heatmap = {}; if (store.status) store.status.heatmap = {}; store.server.heatmap_since = new Date().toISOString().slice(0, 10);
        renderHeat(); return { message: "Обнулено" };
      }, { busy: "Обнуляю…" });
    }
  }
}

// ---------- Claude Code ----------
function claudeOff() {
  if (store.server.profile.smart.claude) return false;
  toast("Сигналы Claude Code выключены", { sub: "Включи переключатель в этой карточке — тогда клавиатура покажет сигнал" });
  return true;
}
function renderClaude() { if (v) keepFocus($("#claudeCard", v.root), renderClaudeNow); }
function renderClaudeNow() {
  const box = v && $("#claudeCard", v.root); if (!box) return;
  const sm = store.server.profile.smart, hk = v.hooks, st = store.status?.live || store.server.live || {};
  const s = st.claude || "idle", [title, desc] = CLAUDE[s] || CLAUDE.idle;
  const hooksLine = !hk ? `<span class="note">Проверяю подключение…</span>`
    : hk.error ? `<p class="note warn">Не удалось прочитать ${esc(hk.path)}: ${esc(hk.error)}. Файл не трогаю, пока он не исправлен.</p>`
    : hk.installed ? `<div class="row between"><span class="tag ok">${icon("check")}Подключено</span><button class="btn small quiet" data-a="claude-uninstall">Отключить</button></div>`
    : `<div class="row between wrap"><span class="note">${hk.partial ? "Подключено не полностью." : "Claude Code пока не знает про клавиатуру."}</span><button class="btn small primary" data-a="claude-install">${icon("link")}Подключить к Claude Code</button></div>`;
  box.innerHTML = `<div class="panel-body stack">
    <div class="row between"><h2>Claude Code</h2><label class="toggle"><input type="checkbox" data-smart="claude" aria-label="Сигналы Claude Code" ${sm.claude ? "checked" : ""}><i></i></label></div>
    ${strip(CLAUDE_DEMO, `claude s-${s}${sm.claude ? "" : " off"}`, `Сейчас на клавиатуре: ${title}`)}
    <div class="claude-state" data-s="${s}" aria-live="polite"><span class="lamp"></span><div><b>${title}</b><div class="note">${desc}</div></div>
      ${st.claude_at ? `<span class="annot" style="margin-left:auto" data-tip="Последнее событие: ${esc(st.claude_event || "")}">${esc(fmt.dateTime(st.claude_at))}</span>` : ""}</div>
    ${hooksLine}
    <div class="row wrap"><span class="annot">Проверить</span>
      <button class="btn small quiet" data-a="claude-test-attention">«Ждёт тебя»</button>
      <button class="btn small quiet" data-a="claude-test-done">«Готово»</button></div>
    <span class="msg" data-msg="claude"></span>
  </div>`;
}

async function installHooks(b) {
  let hk;
  try { hk = v.hooks || await get("/api/claude/hooks"); }
  catch (e) { toast(`Не удалось прочитать настройки Claude Code: ${e.message}`, { kind: "err" }); return; }
  if (!v) return;
  const ok = await confirmDialog({
    title: "Подключить к Claude Code",
    body: `В ${hk.path} добавятся хуки: при событиях Claude Code сообщает о них этому сервису на 127.0.0.1. Остальные настройки не меняются, прежний файл сохраняется рядом копией.`,
    code: hk.preview, confirm: "Подключить",
  });
  if (!ok) return;
  await act(b, $(`[data-msg="claude"]`, v.root), async () => {
    const r = await post("/api/claude/hooks/install", {});
    v.hooks = await get("/api/claude/hooks"); renderClaude();
    return r;
  }, { busy: "Подключаю…" });
}
async function uninstallHooks(b) {
  const ok = await confirmDialog({ title: "Отключить от Claude Code?", body: "Наши хуки уберутся из настроек Claude Code, чужие останутся. Прежний файл сохранится копией.", confirm: "Отключить" });
  if (!ok) return;
  await act(b, $(`[data-msg="claude"]`, v.root), async () => {
    const r = await post("/api/claude/hooks/uninstall", {});
    v.hooks = await get("/api/claude/hooks"); renderClaude();
    return { message: "Отключено" + (r.backup ? " · копия сохранена" : "") };
  }, { busy: "Отключаю…" });
}

// ---------- фокус-таймер ----------
function renderTimer() { if (v) keepFocus(() => $("#timerCard", v.root), renderTimerNow); }
function renderTimerNow() {
  const old = v && $("#timerCard", v.root); if (!old) return;
  const box = fresh(old); box.dataset.busy = old.dataset.busy || ""; // чистый контейнер: обработчики не копятся
  const t = store.status?.timer || store.server.timer || {};
  const busy = t.running || t.ringing;
  box.innerHTML = `<div class="panel-body stack">
    <h2>Фокус-таймер</h2>
    <div class="timer-face">
      <svg viewBox="0 0 96 96" aria-hidden="true"><circle class="track" cx="48" cy="48" r="42"/>
        <circle class="arc" cx="48" cy="48" r="42" transform="rotate(-90 48 48)" stroke-dasharray="263.9" stroke-dashoffset="263.9"/>
        <text class="t" x="48" y="49"></text></svg>
      <div class="stack tight">
        <p class="muted" id="timerDesc"></p>
        ${busy ? `<button class="btn" data-a="timer-cancel">${icon("stop")}Остановить</button>`
          : `<div class="seg" id="tmSeg">${[15, 25, 50].map((m) => `<button data-m="${m}" aria-pressed="${v.timerMin === m}">${m} мин</button>`).join("")}
              <label class="seg-input"><input class="input num" type="number" min="1" max="180" id="tmOwn" value="${[15, 25, 50].includes(v.timerMin) ? "" : v.timerMin}" placeholder="своё" aria-label="Своё время, минут"></label></div>
             <button class="btn primary" data-a="timer-start">${icon("timer")}Старт</button>`}
        <span class="msg" id="timerMsg"></span>
      </div>
    </div>
    <p class="note">Старт — F-ряд заполняется и гаснет. Каждые 5 минут — короткая полоска прогресса. Конец — волна, потом пульсирует Esc, пока не нажмёшь любую клавишу.</p>
  </div>`;
  on(box, "click", "[data-m]", (e, b) => { v.timerMin = +b.dataset.m; local.set("timerMin", v.timerMin); $$("[data-m]", box).forEach((x) => x.setAttribute("aria-pressed", x === b)); const o = $("#tmOwn", box); if (o) o.value = ""; tickTimer(t); });
  const own = $("#tmOwn", box);
  if (own) own.oninput = () => { const m = Math.max(1, Math.min(180, Math.round(+own.value || 0))); if (own.value && m) { v.timerMin = m; local.set("timerMin", m); $$("[data-m]", box).forEach((x) => x.setAttribute("aria-pressed", "false")); tickTimer(t); } };
  tickTimer(t);
}

function tickTimer(t) {
  const box = v && $("#timerCard", v.root); if (!box) return;
  const arc = $(".arc", box), txt = $(".t", box), desc = $("#timerDesc", box);
  const C = 263.9;
  if (t.ringing) { arc.style.strokeDashoffset = 0; txt.textContent = "0:00"; desc.textContent = "Время вышло. Нажми любую клавишу на клавиатуре, чтобы погасить сигнал."; return; }
  if (t.running) {
    arc.style.strokeDashoffset = (C * (t.left_s / Math.max(1, t.total_s))).toFixed(1);
    txt.textContent = fmt.left(t.left_s); desc.textContent = `Идёт таймер на ${Math.round(t.total_s / 60)} мин. Остаток виден и в шапке программы.`;
    return;
  }
  arc.style.strokeDashoffset = C; txt.textContent = `${v.timerMin}:00`; desc.textContent = "Время для одной задачи без отвлечений.";
}

// ---------- живые обновления из /api/status ----------
function live(st) {
  const lamp = $("#claudeCard .claude-state", v.root);
  if (lamp && lamp.dataset.s !== (st.live?.claude || "idle")) renderClaude();
  const tc = $("#timerCard", v.root);
  const t = st.timer || {}, was = tc?.dataset.busy === "1", busy = !!(t.running || t.ringing);
  if (tc) { if (was !== busy) { tc.dataset.busy = busy ? "1" : "0"; renderTimer(); } else tickTimer(t); }
  if (v.view === "heat" && store.server.profile.smart.heatmap_count) {
    const sum = Object.values(st.heatmap || {}).reduce((a, b) => a + b, 0);
    if (sum !== v.heatSum) { v.heatSum = sum; keepFocus($("#sigLower", v.root), renderHeat); } // фокус не слетает с «Обнулить»
  }
}
