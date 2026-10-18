// Раздел «Клавиши»: карта, инспектор, рецепты. Правки — в черновик, запись — полосой снизу.
import { $, $$, esc, on, fmt, keepFocus } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { store, local, same } from "../core/store.js";
import { post } from "../core/api.js";
import { toast, setMsg } from "../core/feedback.js";
import * as D from "../core/drafts.js";
import { undoThis } from "../core/undo.js";
import { createChart, remapView } from "../chart/real.js";
import { mirror } from "../chart/mirror.js";
import {
  CODE_HID, HID_LIMIT, isModifierHid, keys, keyByIndex, keyByHid, fullName, hidName, assignableHids,
  MODS, MEDIA, MOUSE, MACRO_MODES, actionText,
} from "../core/keydata.js";

const LAYERS = { base: "Основной слой", fn: "Fn-слой" };
const TABS = [
  { id: "key", label: "Клавиша" }, { id: "combo", label: "Сочетание" }, { id: "media", label: "Медиа" },
  { id: "mouse", label: "Мышь" }, { id: "macro", label: "Макрос" }, { id: "disabled", label: "Отключить" },
];
const RECIPES = [
  { title: "Caps Lock → Esc", desc: "Esc под мизинцем: Vim, игры, закрытие окон.",
    changes: [{ layer: "base", key: 55, action: { type: "key", hid: 0x29, mods: 0 } }] },
  { title: "Caps Lock → Ctrl", desc: "Ctrl на месте Caps — меньше нагрузки на мизинец.",
    changes: [{ layer: "base", key: 55, action: { type: "key", hid: 0xe0, mods: 0 } }] },
  { title: "Медиа на F7–F12 без Fn", desc: "Треки и громкость одной клавишей, сами F7–F12 — через Fn.",
    changes: [
      ...[["prev", 8], ["play_pause", 9], ["next", 10], ["mute", 11], ["vol_down", 12], ["vol_up", 13]]
        .map(([name, key]) => ({ layer: "base", key, action: { type: "media", name } })),
      ...[8, 9, 10, 11, 12, 13].map((key, i) => ({ layer: "fn", key, action: { type: "key", hid: 0x40 + i, mods: 0 } })),
    ] },
  { title: "Отключить Win", desc: "Чтобы не выпадать из игры случайным нажатием.",
    changes: [{ layer: "base", key: 92, action: { type: "disabled" } }] },
];

let v = null; // состояние раздела, пока он открыт

export default {
  id: "keys", title: "Клавиши", icon: "keys",

  mount(root, ctx) {
    v = { root, ctx, layer: ctx.params.layer === "fn" ? "fn" : "base", sel: null, tab: null, comboMods: 0,
      pendingMacro: ctx.params.macro != null && !ctx.params.key ? +ctx.params.macro : null };
    root.innerHTML = `
      <div class="page">
        <div class="page-head">
          <div><h1>Клавиши</h1>
            <p class="lead" id="keysLead">Нажми клавишу на клавиатуре или выбери её на карте. Изменения копятся черновиком и уходят в клавиатуру одной кнопкой.</p></div>
          <div class="seg" role="tablist" aria-label="Слой" id="layerSeg">
            ${Object.entries(LAYERS).map(([id, t]) => `<button role="tab" data-layer="${id}" aria-selected="${v.layer === id}">${t}</button>`).join("")}
          </div>
        </div>
        <div class="grid-main">
          <section class="panel plate" aria-label="Карта клавиатуры">
            <div id="chartHost"></div>
            <div class="plate-foot">
              <span class="legend-i"><svg viewBox="0 0 18 12"><rect x="2" y="1" width="14" height="10" rx="2.2" fill="#efeee9"/><path d="M5.5 8H12.5" stroke="#9a6a12" stroke-width="1.8" stroke-linecap="round"/></svg>переназначена — подпись золотом</span>
              <span class="legend-i"><svg viewBox="0 0 18 12"><path d="M2 10Q9 0 16 10" fill="none" stroke="var(--gold)" stroke-width="1.2"/></svg>ведёт на другую клавишу</span>
              <span class="legend-i"><svg viewBox="0 0 18 12"><rect x="2" y="1" width="14" height="10" rx="2.2" fill="#efeee9" opacity=".4"/><path d="M5 6H13" stroke="#8d8d89" stroke-width="1.2"/></svg>отключена</span>
              <span class="grow"></span><span class="note">Fn система не видит — её выбирают на карте</span>
            </div>
          </section>
          <aside class="panel inspector" aria-label="Действие клавиши"><div class="panel-body" id="insp"></div></aside>
        </div>
      </div>`;
    v.chart = createChart($("#chartHost", root), {
      label: "Карта клавиатуры: выбери клавишу",
      onSelect: (k) => select(k.key_index, { flash: true, pick: true }),
      onFocusMove: (k) => select(k.key_index, { flash: false }),
    });
    on($("#layerSeg", root), "click", "[data-layer]", (e, b) => setLayer(b.dataset.layer));
    const insp = $("#insp", root);
    on(insp, "click", "[data-tab]", (e, b) => { v.tab = b.dataset.tab; renderInspector(); });
    on(insp, "click", "[data-a=reset]", () => setAction({ type: "default" }, "Клавиша вернётся к заводскому действию"));
    on(insp, "click", "[data-r]", (e, b) => {
      const r = RECIPES[+b.dataset.r];
      D.applyRecipe(r.changes);
      toast(`«${r.title}» в черновике`, { sub: "Проверь на карте и запиши в клавиатуру", undo: undoThis("keymap") });
    });
    const pre = +ctx.params.key;
    if (pre && keyByIndex(pre)) select(pre, { flash: false });
    refresh();
    if (ctx.params.macro != null && v.sel) { v.tab = "macro"; renderInspector(); }
    renderPending();
    // на карте горит то же, что на клавиатуре: её эффект, свои цвета или сигналы сервиса
    const stopMirror = mirror(v.chart);
    return () => { stopMirror(); v.chart.destroy(); v = null; };
  },

  onDraft() { if (v) refresh(); },
  onServer() { if (v) refresh(); },

  // Нажатие настоящей клавиши выбирает её на карте и утапливает клавишу на схеме.
  onKey(e, phase) {
    if (!v) return;
    const isMod = /^(Control|Shift|Alt|Meta)/.test(e.code);
    if (phase === "down" && !isMod) v.modAlone = null;
    if (!isMod && (e.ctrlKey || e.metaKey)) return; // сочетания (Ctrl+S, Ctrl+K…) оставляем приложению
    if (e.code === "Tab") return;                     // Tab всегда ведёт фокус, иначе со страницы не уйти
    // Enter и пробел нажимают кнопку в фокусе (на карте — её саму); подсвечиваем их только когда фокус ни на чём
    const ae = document.activeElement;
    if ((e.code === "Enter" || e.code === "NumpadEnter" || e.code === "Space") && ae && ae !== document.body && ae.id !== "main") return;
    if (document.activeElement?.closest?.(".capture")) return;
    if (document.activeElement?.closest?.(".chart") && e.code.startsWith("Arrow")) return;
    const hid = CODE_HID[e.code]; if (hid == null) return;
    const k = keyByHid(hid); if (!k) return;
    e.preventDefault();
    if (phase === "down") {
      if (e.repeat) return;
      v.chart.hold(k.key_index);
      if (isMod) { v.modAlone = k.key_index; return; }
      select(k.key_index, { flash: false, pick: true });
    } else {
      v.chart.release(k.key_index);
      if (isMod && v.modAlone === k.key_index) { v.modAlone = null; select(k.key_index, { flash: false, pick: true }); }
    }
  },
};

function setLayer(layer) {
  if (!v || v.layer === layer) return;
  v.layer = layer;
  $$("#layerSeg [data-layer]", v.root).forEach((b) => b.setAttribute("aria-selected", b.dataset.layer === layer));
  refresh();
}

// Пришли из «Макросов» с «Назначить на клавишу»: первая выбранная клавиша получает макрос.
function renderPending() {
  const lead = $("#keysLead", v.root), i = v.pendingMacro;
  const m = i != null ? store.server.profile.macros[i] : null;
  if (!m) { v.pendingMacro = null; lead.classList.remove("pending"); lead.textContent = "Нажми клавишу на клавиатуре или выбери её на карте. Изменения копятся черновиком и уходят в клавиатуру одной кнопкой."; return; }
  lead.classList.add("pending");
  lead.innerHTML = `${icon("macros")}<span>Выбери клавишу для макроса <b>«${esc(m.name)}»</b> — нажми её на клавиатуре или на карте.</span><button class="btn small quiet" data-a="pending-cancel">Отмена</button>`;
  $("[data-a=pending-cancel]", lead).onclick = () => { v.pendingMacro = null; renderPending(); };
}

function select(i, { flash, pick = false }) {
  if (!v) return;
  const changed = v.sel !== i;
  v.sel = i;
  if (changed) { v.tab = null; v.comboMods = 0; }
  if (pick && v.pendingMacro != null) {
    const idx = v.pendingMacro, m = store.server.profile.macros[idx];
    v.pendingMacro = null; renderPending();
    if (m && keyByIndex(i)?.name !== "Fn") {
      D.setKeyAction(v.layer, i, { type: "macro", index: idx, mode: 1, count: 1 });
      v.tab = "macro";
      toast(`«${m.name}» на клавише ${fullName(keyByIndex(i))}`, { sub: "В черновике — запиши раскладку в клавиатуру", undo: undoThis("keymap") });
    }
  }
  v.chart.update({ selected: i });
  renderInspector();
  const k = keyByIndex(i);
  if (flash && k && local.get("flashSelect", true) && store.status?.connected) {
    post("/api/live/flash", { keys: [k.light_index], rgb: [216, 189, 132], seconds: .8 }).catch(() => {});
  }
}

function layerMap() { return D.keymapView()[v.layer] || {}; }
function serverAction(i) { return store.server.profile.keymap[v.layer]?.[i] || null; }

function refresh() {
  const { subs, arcs } = remapView(layerMap());
  const states = new Map();
  for (const [i, a] of Object.entries(layerMap())) if (a?.type === "disabled") states.set(+i, "disabled");
  const fn = keys().find((k) => k.name === "Fn");
  if (fn && v.layer === "fn") states.set(fn.key_index, "held");
  const n = Object.keys(layerMap()).length;
  v.chart.update({
    subs, arcs, states, selected: v.sel,
    annot: `98% · ${keys().length} клавиш · ${LAYERS[v.layer].toLowerCase()}${v.layer === "fn" ? " · Fn удерживается" : ""}`,
    annotRight: n ? `переназначено: ${n}` : "заводская раскладка",
  });
  renderInspector();
}

// ---------- инспектор ----------
function renderInspector() {
  const box = $("#insp", v.root); if (!box) return;
  keepFocus(box, () => renderInspectorNow(box));
}
function renderInspectorNow(box) {
  const k = v.sel != null ? keyByIndex(v.sel) : null;
  if (!k) return renderEmpty(box);
  const a = layerMap()[k.key_index] || null;
  const draft = !same(a, serverAction(k.key_index));
  const isFn = k.name === "Fn";
  const tab = v.tab || (a ? (a.type === "key" ? (a.mods ? "combo" : "key") : a.type) : "key");
  v.tab = tab;
  box.innerHTML = `
    <div class="k-title"><h2>${esc(fullName(k))}</h2><span class="annot">${LAYERS[v.layer]}</span></div>
    <div class="k-now">
      <span class="annot">Сейчас ${draft ? `<span class="tag warn" style="margin-left:6px">черновик</span>` : ""}</span>
      <span class="v ${a ? "" : "default"}">${esc(a ? actionText(a, { long: true }) : defaultText(k))}</span>
    </div>
    ${isFn ? `<p class="note">Fn — служебная клавиша прошивки: через неё работают Fn-слой и сброс Fn+Esc. Её не переназначить, зато в Fn-слое можно задать, что делает Fn вместе с любой другой клавишей.</p>` : `
    <div class="tabs" role="tablist">${TABS.map((t) => `<button role="tab" data-tab="${t.id}" aria-selected="${t.id === tab}">${t.label}</button>`).join("")}</div>
    <div id="tabBody"></div>`}
    <div class="row between">
      ${a ? `<button class="btn quiet" data-a="reset">${icon("reset")}Вернуть заводское</button>` : "<span></span>"}
      <span class="msg" id="kMsg"></span>
    </div>`;
  if (!isFn) renderTab($("#tabBody", box), k, a, tab);
}

function defaultText(k) {
  if (v.layer === "fn") return "Как задумано производителем (мультимедиа на F-ряду и т. п.)";
  return `Заводское: ${fullName(k)}`;
}

function setAction(action, note) {
  const k = keyByIndex(v.sel);
  D.setKeyAction(v.layer, k.key_index, action);
  setMsg($("#kMsg", v.root) || document.createElement("i"), note || "В черновике — запиши в клавиатуру", "ok");
}

function renderTab(body, k, a, tab) {
  if (tab === "key" || tab === "combo") {
    const combo = tab === "combo";
    const curHid = a?.type === "key" ? a.hid : null;
    const mods = combo ? (a?.type === "key" ? a.mods || v.comboMods : v.comboMods) : 0;
    v.comboMods = mods;
    body.innerHTML = `
      <div class="stack">
        ${combo ? `<div class="field"><span class="label">Модификаторы</span>
          <div class="modkeys">${MODS.map((m) => `<button data-bit="${m.bit}" aria-pressed="${!!(mods & m.bit)}">${m.name}</button>`).join("")}</div></div>` : ""}
        <div class="field"><span class="label">${combo ? "И клавиша" : "Новая клавиша"}</span>
          <div class="capture" tabindex="0" role="button" data-f="capture" aria-label="Нажми клавишу, чтобы назначить">
            <span>${curHid != null ? `<b>${esc(hidName(curHid))}</b>` : "Нажми клавишу на клавиатуре…"}</span><span class="annot">захват</span></div></div>
        <div class="field"><span class="label">или выбери из списка</span>
          <select class="select" id="hidList"><option value="">—</option>
            ${assignableHids().map((h) => `<option value="${h}" ${h === curHid ? "selected" : ""}>${esc(hidName(h))}</option>`).join("")}
            <optgroup label="Недоступны: клавиатура их не передаёт">${Array.from({ length: 12 }, (_, i) => `<option disabled>F${13 + i}</option>`).join("")}</optgroup>
          </select></div>
        ${combo ? `<p class="note">Сочетание отправится одним нажатием: например, Ctrl+Shift+Esc откроет диспетчер задач.</p>`
          : `<p class="note">F13–F24 в списке есть, но неактивны: клавиатура не передаёт их в систему (проверено).</p>`}
      </div>`;
    const capture = $(".capture", body);
    const choose = (hid) => {
      if (hid > HID_LIMIT && !isModifierHid(hid)) { setMsg($("#kMsg", v.root), `${hidName(hid)} клавиатура не передаёт в систему. Выбери другую клавишу.`, "err"); return; }
      const m = combo ? v.comboMods : 0;
      if (!m && hid === k.hid) { setAction({ type: "default" }, "Это её собственное действие — вернул заводское"); return; }
      setAction({ type: "key", hid, mods: m });
    };
    let lone = null; // модификатор, нажатый один: назначаем на отпускание, иначе Shift+Tab и Ctrl+Z переназначали бы клавишу
    capture.addEventListener("keydown", (e) => {
      if (e.key === "Tab") return; // Tab и Shift+Tab — навигация
      e.preventDefault(); e.stopPropagation();
      const hid = CODE_HID[e.code];
      if (hid == null) { setMsg($("#kMsg", v.root), "Эту клавишу браузер не распознал — выбери её из списка.", "err"); return; }
      if (!combo && isModifierHid(hid)) { if (!e.repeat) lone = hid; return; }
      lone = null;
      if (combo && isModifierHid(hid)) {
        const bit = { 0xe0: 1, 0xe4: 1, 0xe1: 2, 0xe5: 2, 0xe2: 4, 0xe6: 4, 0xe3: 8, 0xe7: 8 }[hid];
        v.comboMods |= bit; renderInspector(); $(".capture", v.root)?.focus(); return;
      }
      choose(hid);
    });
    capture.addEventListener("keyup", (e) => {
      const hid = CODE_HID[e.code];
      if (hid != null && hid === lone) { e.preventDefault(); lone = null; choose(hid); }
    });
    capture.addEventListener("click", () => capture.focus());
    $("#hidList", body).onchange = (e) => e.target.value && choose(+e.target.value);
    on(body, "click", "[data-bit]", (e, b) => {
      v.comboMods ^= +b.dataset.bit;
      if (a?.type === "key") setAction({ type: "key", hid: a.hid, mods: v.comboMods });
      else renderInspector();
    });
    return;
  }
  if (tab === "media" || tab === "mouse") {
    const list = tab === "media" ? MEDIA : MOUSE;
    body.innerHTML = `<div class="tiles">${list.map((m) => `<button class="tile" data-id="${m.id}" aria-pressed="${a?.type === tab && a.name === m.id}">${icon(m.icon)}<span>${esc(m.label)}</span></button>`).join("")}</div>
      ${tab === "media" ? `<p class="note" style="margin-top:10px">Коды взяты из таблицы фирменной программы; на клавиатуре проверены не все.</p>` : `<p class="note" style="margin-top:10px">Клавиша будет работать как кнопка мыши. Проверено по коду программы, на клавиатуре — нет.</p>`}`;
    on(body, "click", "[data-id]", (e, b) => setAction({ type: tab, name: b.dataset.id }));
    return;
  }
  if (tab === "macro") {
    const macros = store.server.profile.macros;
    const pending = !!store.drafts.macros;
    if (pending) { // номера в черновике макросов могли сдвинуться: назначать можно только записанные
      body.innerHTML = `<div class="orn-empty"><p>В «Макросах» есть незаписанные изменения. Запиши их в клавиатуру — тогда макрос можно будет повесить на клавишу.</p>
        <button class="btn" data-go="macros">${icon("macros")}Перейти к макросам</button></div>`;
      $("[data-go]", body).onclick = () => v.ctx.go("macros");
      return;
    }
    if (!macros.length) {
      body.innerHTML = `<div class="orn-empty"><p>${pending ? "Новые макросы ещё не записаны в клавиатуру." : "Макросов в клавиатуре пока нет."} Создай макрос и запиши его — потом его можно повесить на любую клавишу.</p>
        <button class="btn" data-go="macros">${icon("macros")}Перейти к макросам</button></div>`;
      $("[data-go]", body).onclick = () => v.ctx.go("macros");
      return;
    }
    const cur = a?.type === "macro" ? a : null;
    const mode = cur?.mode || 1;
    body.innerHTML = `
      <div class="stack">
        <div class="list-radio">${macros.map((m, i) => `<button data-i="${i}" aria-pressed="${cur?.index === i}"><span>${esc(m.name)}</span><small>${m.actions.length} ${fmt.plural(m.actions.length, "шаг", "шага", "шагов")}</small></button>`).join("")}</div>
        <div class="field"><span class="label">Как проигрывать</span>
          <select class="select" id="mMode">${MACRO_MODES.map((m) => `<option value="${m.id}" ${m.id === mode ? "selected" : ""}>${m.label}${m.sure ? "" : " — не проверено"}</option>`).join("")}</select></div>
        <div class="field" ${mode === 2 ? "" : "hidden"} id="mCountF"><span class="label">Сколько раз</span><input class="input num" id="mCount" type="number" min="1" max="255" value="${cur?.count || 1}"></div>
        ${pending ? `<p class="note warn">В разделе «Макросы» есть незаписанные изменения — здесь видны только записанные макросы.</p>` : ""}
      </div>`;
    const read = () => ({ mode: +$("#mMode", body).value, count: Math.max(1, Math.min(255, +$("#mCount", body).value || 1)) });
    on(body, "click", "[data-i]", (e, b) => setAction({ type: "macro", index: +b.dataset.i, ...read() }));
    $("#mMode", body).onchange = () => { $("#mCountF", body).hidden = +$("#mMode", body).value !== 2; if (cur) setAction({ ...cur, ...read() }); };
    $("#mCount", body).onchange = () => { if (cur) setAction({ ...cur, ...read() }); };
    return;
  }
  if (tab === "disabled") {
    body.innerHTML = `<div class="stack"><p class="muted">Клавиша перестанет что-либо отправлять${v.layer === "fn" ? " вместе с Fn" : ""}. Вернуть — кнопкой «Вернуть заводское».</p>
      <button class="btn ${a?.type === "disabled" ? "" : "danger"}" data-a="dis" ${a?.type === "disabled" ? "disabled" : ""}>${icon("disabled")}${a?.type === "disabled" ? "Уже отключена" : "Отключить клавишу"}</button></div>`;
    $("[data-a=dis]", body).onclick = () => setAction({ type: "disabled" });
  }
}

function renderEmpty(box) {
  box.innerHTML = `
    <div class="orn-empty"><img src="assets/moon.png" alt="" width="92" height="92">
      <h2>Выбери клавишу</h2><p>Щёлкни по ней на карте или просто нажми на клавиатуре — она подсветится здесь и на самой клавиатуре.</p></div>
    <div class="divider"></div>
    <h3>Готовые рецепты</h3>
    <div class="recipes">${RECIPES.map((r, i) => `<div class="recipe"><b>${esc(r.title)}</b><span>${esc(r.desc)}</span><button class="btn small" data-r="${i}">В черновик</button></div>`).join("")}</div>
    <p class="note">Рецепт ничего не пишет сразу: он попадает в черновик, проверяешь на карте и записываешь.</p>`;
}
