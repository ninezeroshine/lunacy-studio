// Раздел «Макросы»: цепочки нажатий, пауз и кликов, которые клавиатура проигрывает сама.
// Правки копятся черновиком (drafts.js) и уходят в клавиатуру одной кнопкой в нижней полосе.
import { $, $$, esc, h, on, fmt } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { store, local, blockReason } from "../core/store.js";
import { post } from "../core/api.js";
import { toast, toastError, confirmDialog, setMsg, wireDialog } from "../core/feedback.js";
import { undoThis } from "../core/undo.js";
import * as D from "../core/drafts.js";
import { CODE_HID, HID_LIMIT, isModifierHid, hidName, keyByIndex, keyByHid, fullName, actionText, macroPreview, macroDuration, macroBytes, MACRO_LIMIT } from "../core/keydata.js";
import { mountStage } from "./macros-stage.js";

const MAX = 100;
const REC_LIMIT = 600;              // шагов за одну запись
const MOUSE_BTNS = [{ v: 1, label: "левая" }, { v: 2, label: "правая" }, { v: 4, label: "средняя" }]; // коды из программы производителя, на клавиатуре не сверены
const TEMPO = [{ ms: 12, label: "Быстро", d: "12 мс" }, { ms: 30, label: "Обычно", d: "30 мс" }, { ms: 70, label: "Как человек", d: "70 мс" }];
const CHORD_MODS = { 0xe0: "Ctrl", 0xe4: "Ctrl", 0xe2: "Alt", 0xe6: "Alt", 0xe3: "Win", 0xe7: "Win" };

let v = null;
const list = () => D.macrosView();
const cur = () => list()[v.sel];

export default {
  id: "macros", title: "Макросы", icon: "macros",

  mount(root, ctx) {
    v = { root, ctx, sel: 0, capture: null, insertAt: null, rec: null, focusAfter: null, drag: null, freshIdx: null,
      ro: new ResizeObserver(() => drawTimeline()), roBox: null };
    v.sel = clampSel(ctx.params.i != null ? +ctx.params.i : local.get("macroSel", 0));
    root.innerHTML = `
      <div class="page">
        <div class="page-head">
          <div><h1>Макросы</h1>
            <p class="lead">Цепочка нажатий, пауз и кликов, которую клавиатура проигрывает сама — даже без этой программы. Собери макрос, запиши в клавиатуру и повесь на любую клавишу.</p></div>
          <button class="btn" data-a="new">${icon("plus")}Новый макрос</button>
        </div>
        <div id="mBody"></div>
      </div>`;
    const off = bind(root);
    render();
    return () => { stopRec(); v.ro.disconnect(); v.stage?.destroy(); off(); v = null; };
  },
  onDraft() { if (v && !v.rec) { v.sel = clampSel(v.sel); render(); } },
  onServer() { if (v && !v.rec) render(); },
};

const clampSel = (i) => Math.max(0, Math.min(list().length - 1, i | 0));

// ================= отрисовка =================
function render() {
  if (!v) return;
  const body = $("#mBody", v.root), ms = list();
  const newBtn = $("[data-a=new]", v.root);
  newBtn.toggleAttribute("disabled", ms.length >= MAX);
  if (ms.length >= MAX) newBtn.dataset.tip = "В клавиатуре помещается 100 макросов"; else newBtn.removeAttribute("data-tip");
  if (!ms.length) { body.innerHTML = emptyState(); return; }

  // сохранить фокус и прокрутку шагов между перерисовками
  const a = document.activeElement, fkey = v.focusAfter || (a && v.root.contains(a) ? a.dataset.f : null);
  const caret = a?.dataset?.f && "selectionStart" in a ? [a.selectionStart, a.selectionEnd] : null;
  const scroll = $(".steps", body)?.scrollTop || 0;
  v.focusAfter = null;

  body.innerHTML = `
    <div class="m-layout">
      <aside class="panel" aria-label="Список макросов">
        <div class="panel-head"><h2>Макросы</h2><span class="annot">${ms.length} из ${MAX}</span></div>
        ${memHtml(ms)}
        <div class="m-list" role="listbox" aria-label="Макросы">${ms.map(itemHtml).join("")}</div>
      </aside>
      <section class="panel" aria-label="Редактор макроса"><div class="panel-body stack" id="mEd">${editorHtml()}</div></section>
    </div>`;

  const steps = $(".steps", body);
  if (steps) steps.scrollTop = scroll;
  if (fkey) {
    const n = body.querySelector(`[data-f="${fkey}"]`);
    if (n) { n.focus({ preventScroll: true }); if (caret && n.setSelectionRange) try { n.setSelectionRange(...caret); } catch {} }
  }
  drawTimeline();
  mountStageFor();
}

// Сцена проигрывания пересоздаётся при каждой перерисовке редактора: шаги могли поменяться.
function mountStageFor() {
  v.stage?.destroy(); v.stage = null;
  const host = $("#mStage", v.root), m = cur();
  if (!host || !m) return;
  const acts = m.actions;
  v.stage = mountStage(host, { acts, triggers: assignedIdx(v.sel), typedAt: (i) => describe(acts.slice(0, i + 1)),
    picked: v.pick?.key ?? null, picking: !!v.pick, onPick: (k) => { if (v.pick) pickKey(k.key_index); } });
}

function emptyState() {
  return `
    <section class="panel"><div class="empty-state center">
      <img class="orn" src="assets/moon.png" alt="">
      <h2>Макросов пока нет</h2>
      <p>Выбери, с чего начать. Готовый макрос появится в списке, а в клавиатуру уйдёт, когда нажмёшь «Записать в клавиатуру».</p>
      <div class="sources" style="grid-template-columns:repeat(3,minmax(0,1fr));width:min(100%,760px)">
        <button class="source" data-a="start-text">${icon("text")}<b>Из текста</b><span>Подпись, адрес, частая фраза</span></button>
        <button class="source" data-a="start-rec">${icon("record")}<b>Записать нажатия</b><span>Нажми клавиши — паузы сохранятся</span></button>
        <button class="source" data-a="start-empty">${icon("plus")}<b>По шагам</b><span>Сочетания, паузы, клики</span></button>
      </div>
    </div></section>`;
}

function itemHtml(m, i) {
  const keysOn = assigned(i), n = m.actions.length;
  const meta = n ? `${n} ${fmt.plural(n, "шаг", "шага", "шагов")} · ${fmt.ms(macroDuration(m.actions))}` : "пустой";
  return `<div class="m-item" role="option" tabindex="${i === v.sel ? 0 : -1}" data-i="${i}" aria-current="${i === v.sel}" aria-selected="${i === v.sel}">
    <b>${esc(m.name || `Макрос ${i + 1}`)}</b>
    <span class="annot">${meta}${keysOn.length ? ` · ${esc(keysOn.join(", "))}` : ""}</span></div>`;
}

function memHtml(ms) {
  const used = macroBytes(ms), lim = MACRO_LIMIT, p = Math.min(1, used / lim), over = used > lim;
  const C = 2 * Math.PI * 28, ang = -Math.PI / 2 + p * 2 * Math.PI;
  return `<div class="mem${over ? " over" : ""}">
    <svg viewBox="0 0 76 76" aria-hidden="true">
      <circle class="orbit" cx="38" cy="38" r="35"/><circle class="track" cx="38" cy="38" r="28"/>
      <circle class="fill" cx="38" cy="38" r="28" stroke-dasharray="${(p * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 38 38)"/>
      <circle class="sat" cx="${(38 + 28 * Math.cos(ang)).toFixed(1)}" cy="${(38 + 28 * Math.sin(ang)).toFixed(1)}" r="3"/>
      <circle class="core" cx="38" cy="38" r="9"/>
    </svg>
    <div><b class="num">${fmt.int(used)} из ${fmt.int(lim)} байт</b>
      <p class="note">${over ? "Не помещается в память клавиатуры: убери шаги или паузы." : "Общая память клавиатуры на все макросы. Шаг — 4 байта."}</p></div>
  </div>`;
}

function editorHtml() {
  const m = cur(), i = v.sel;
  if (v.rec) return recHtml();
  const acts = m.actions, keysOn = assigned(i), savedOn = assigned(i, store.server.profile.keymap);
  const typed = describe(acts), typedRu = describe(acts, true);
  const warns = warnings(m);
  return `
    <div class="m-head">
      <input class="input m-name" data-f="name" maxlength="40" value="${esc(m.name)}" aria-label="Имя макроса" placeholder="Макрос ${i + 1}">
      <div class="row">
        <button class="btn small ${keysOn.length ? "" : "primary"}" data-a="assign" aria-pressed="${!!v.pick}">${icon("keys")}${v.pick ? "Выбираю клавишу…" : keysOn.length ? "Назначить ещё" : "Назначить на клавишу"}</button>
        <button class="btn small quiet icon" data-a="dup" aria-label="Дублировать" data-tip="Дублировать" ${list().length >= MAX ? "disabled" : ""}>${icon("layers")}</button>
        <button class="btn small quiet icon" data-a="del" aria-label="Удалить макрос" data-tip="Удалить макрос">${icon("trash")}</button>
      </div>
    </div>
    <div class="m-stage" id="mStage">
      <div class="m-stage-kb">
        <div class="m-chart"></div>
        <div class="m-legend"><span><i class="lg used"></i>клавиши макроса</span><span><i class="lg held"></i>нажата сейчас</span>
          <span><i class="lg trig"></i>${v.pick ? "выбранная клавиша" : keysOn.length ? "клавиша запуска" : "не назначен"}</span></div>
        <div class="m-assign" id="mAssign">${assignHtml()}</div>
      </div>
      <div class="m-out">
        <div class="row between"><span class="m-out-l">Что напечатается</span>
          <button class="btn small primary" data-a="play" ${acts.length ? "" : "disabled"}>${icon("play")}Проиграть</button></div>
        <div class="m-typed" aria-live="off">${typed ? `<span class="txt"></span><i class="caret"></i>` : `<span class="txt"></span><span class="muted">${acts.length ? "текста нет — только сочетания и клики" : "шагов пока нет"}</span>`}</div>
        <div class="m-prog" aria-hidden="true"><i></i></div>
        <p class="note">${acts.length ? `${acts.length} ${fmt.plural(acts.length, "шаг", "шага", "шагов")} · ${macroDuration(acts) ? fmt.ms(macroDuration(acts)) : "без пауз — всё сразу"}${macroDuration(acts) ? "" : ". На превью шаги растянуты, чтобы их было видно"}` : "Набери текст, запиши нажатия или добавь шаг вручную."}</p>
        ${typedRu && typedRu !== typed && /[а-яё]/i.test(typedRu) ? `<p class="note ru" data-tip="Макрос нажимает клавиши, а не буквы: в русской раскладке те же клавиши дадут другие буквы">В русской раскладке: ${esc(typedRu)}</p>` : ""}
      </div>
    </div>
    <div class="timeline" id="tl" aria-hidden="true"></div>
    <div class="row between wrap">
      <div class="row"><h3>Шаги</h3><span class="annot">${acts.length ? `${acts.length} · ${fmt.ms(macroDuration(acts))}` : ""}</span></div>
      <div class="row">
        <button class="btn small" data-a="text">${icon("text")}Из текста</button>
        <button class="btn small" data-a="rec" data-tip="Отсчёт 3-2-1, потом нажатия клавиш станут шагами">${icon("record")}Записать нажатия</button>
        ${acts.some((x) => x[0] === "delay") ? `<button class="btn small quiet" data-a="tempo" data-tip="Сделать все паузы одинаковыми">${icon("timer")}Ровный темп</button>` : ""}
      </div>
    </div>
    ${acts.length ? `<div class="steps" role="list" aria-label="Шаги макроса">${acts.map(stepHtml).join("")}${v.insertAt === acts.length ? insertRow() : ""}</div>` :
      `<div class="orn-empty"><p>Шагов пока нет. Набери текст, запиши нажатия или добавь шаг вручную.</p></div>`}
    <div class="row add-row"><span class="annot">Добавить в конец</span>
      <button class="btn small quiet" data-add="key" data-at="end">${icon("keys")}Клавишу</button>
      <button class="btn small quiet" data-add="combo" data-at="end">${icon("command")}Сочетание</button>
      <button class="btn small quiet" data-add="pause" data-at="end">${icon("timer")}Паузу</button>
      <button class="btn small quiet" data-add="click" data-at="end">${icon("mouse")}Клик</button>
    </div>
    ${warns.length ? `<ul class="warns">${warns.map((w) => `<li class="${w.kind}">${icon("warn")}<span>${esc(w.text)}</span></li>`).join("")}</ul>` : ""}
    ${!store.drafts.macros && savedOn.length ? `<div class="field"><label for="mTry">Проверка</label>
      <input class="input" id="mTry" placeholder="Поставь курсор сюда и нажми ${esc(savedOn[0])}" autocomplete="off"></div>` : ""}`;
}

function stepHtml(a, i) {
  const [k, val] = a, acts = cur().actions;
  let kind, value = "";
  if (k === "delay") {
    kind = `<i class="pause"></i>Пауза`;
    value = `<span class="row tight"><input class="input num" type="number" min="10" max="65535" step="10" value="${val}" data-delay="${i}" data-f="d${i}" aria-label="Пауза, мс"><span class="annot">мс</span></span>`;
  } else if (k === "down" || k === "up") {
    const capturing = v.capture === i;
    kind = `<i class="${k === "up" ? "up" : ""}"></i>${k === "down" ? "Нажать" : "Отпустить"}
      <button class="keycap${capturing ? " capturing" : ""}" data-cap="${i}" data-f="c${i}" aria-label="${capturing ? "Жду нажатия клавиши" : `Клавиша ${esc(hidName(val))}, нажми, чтобы заменить`}">${capturing ? "нажми клавишу · Tab — отмена" : esc(hidName(val))}</button>`;
  } else {
    kind = `<i class="mouse"></i>${k === "mdown" ? "Мышь: нажать" : "Мышь: отпустить"}`;
    value = `<select class="select small" data-btn="${i}" aria-label="Кнопка мыши">${MOUSE_BTNS.map((b) => `<option value="${b.v}" ${+val === b.v ? "selected" : ""}>${b.label}</option>`).join("")}</select>`;
  }
  return `<div class="step" role="listitem" data-s="${i}">
      <button class="grip" data-f="g${i}" aria-label="Шаг ${i + 1}: перетащи или двигай стрелками вверх и вниз">${icon("grip")}</button>
      <span class="ix">${i + 1}</span><span class="kind">${kind}</span>${value || "<span></span>"}
      <span class="acts">
        <button class="btn small quiet icon" data-ins="${i + 1}" aria-label="Вставить шаг ниже" data-tip="Вставить ниже">${icon("plus")}</button>
        <button class="btn small quiet icon" data-del="${i}" aria-label="Удалить шаг" data-tip="Удалить шаг">${icon("close")}</button>
      </span>
    </div>${v.insertAt === i + 1 && i + 1 < acts.length ? insertRow() : ""}`;
}

function insertRow() {
  return `<div class="ins-row" role="group" aria-label="Вставить шаг"><span class="annot">Вставить сюда</span>
    <button class="btn small quiet" data-add="key">${icon("keys")}Клавишу</button>
    <button class="btn small quiet" data-add="combo">${icon("command")}Сочетание</button>
    <button class="btn small quiet" data-add="pause">${icon("timer")}Паузу</button>
    <button class="btn small quiet" data-add="click">${icon("mouse")}Клик</button>
    <button class="btn small quiet icon" data-a="ins-close" aria-label="Не вставлять">${icon("close")}</button></div>`;
}

// ---------- что наберёт: текст + сочетания вида [Ctrl+C] ----------
function describe(acts, ru = false) {
  const held = new Set(); let shift = false, out = "";
  for (const [k, val] of acts) {
    if (k === "mdown") { out += "[клик]"; continue; }
    if (k !== "down" && k !== "up") continue;
    if (val === 0xe1 || val === 0xe5) { shift = k === "down"; continue; }
    if (CHORD_MODS[val]) { k === "down" ? held.add(CHORD_MODS[val]) : held.delete(CHORD_MODS[val]); continue; }
    if (k !== "down") continue;
    if (held.size) { out += `[${[...held, ...(shift ? ["Shift"] : [])].join("+")}+${hidName(val)}]`; continue; }
    out += macroPreview(shift ? [["down", 0xe1], ["down", val]] : [["down", val]], ru);
  }
  return out;
}

function warnings(m) {
  const out = [], down = new Map();
  for (const [k, val] of m.actions) {
    if (k === "down" || k === "mdown") down.set(k + val, k === "down" ? hidName(val) : "кнопка мыши");
    if (k === "up" || k === "mup") down.delete((k === "up" ? "down" : "mdown") + val);
  }
  if (down.size) out.push({ kind: "warn", text: `Не отпускается: ${[...down.values()].join(", ")}. После макроса клавиша останется зажатой — добавь «Отпустить».` });
  if (m.actions.some((x) => x[0] === "mdown" || x[0] === "mup")) out.push({ kind: "info", text: "Клики мышью в макросе собраны по программе производителя и на этой клавиатуре ещё не проверены." });
  if (macroBytes(list()) > MACRO_LIMIT) out.push({ kind: "err", text: "Все макросы вместе не помещаются в память клавиатуры — запись не пройдёт." });
  return out;
}

// ---------- запуск: на какую клавишу повесить ----------
// Прошивка вешает макрос на одну физическую клавишу — в основном слое или в Fn-слое (то есть «Fn + клавиша»).
// Сочетание вроде Ctrl+Shift+M ловит сама Studio (studio/combos.py): глотает его и печатает макрос через Windows.
// Поэтому оно работает, пока Studio запущена, и в клавиатуру не пишется.
const MODS = [["ctrl", "Ctrl"], ["shift", "Shift"], ["alt", "Alt"], ["win", "Win"]];
const MOD_OF_HID = { 0xe0: "ctrl", 0xe4: "ctrl", 0xe1: "shift", 0xe5: "shift", 0xe2: "alt", 0xe6: "alt", 0xe3: "win", 0xe7: "win" };
// занятые сочетания: после назначения они перестанут работать везде, пока запущена Studio
const BUSY = { "ctrl+C": "Копировать", "ctrl+V": "Вставить", "ctrl+X": "Вырезать", "ctrl+Z": "Отменить", "ctrl+Y": "Повторить",
  "ctrl+A": "Выделить всё", "ctrl+S": "Сохранить", "ctrl+F": "Найти", "ctrl+P": "Печать", "ctrl+N": "Новое окно", "ctrl+O": "Открыть",
  "ctrl+W": "Закрыть вкладку", "ctrl+T": "Новая вкладка", "alt+F4": "Закрыть окно", "alt+Tab": "Переключение окон",
  "ctrl+shift+Esc": "Диспетчер задач", "win+D": "Рабочий стол", "win+E": "Проводник", "win+R": "Выполнить", "win+V": "Буфер обмена" };
const comboText = (mods, hid) => [...MODS.filter(([m]) => mods.includes(m)).map(([, t]) => t), hidName(hid)].join(" + ");
const triggers = () => store.server.profile.triggers || [];

function assignHtml() {
  const km = D.keymapView(), here = [];
  for (const layer of ["base", "fn"]) for (const [idx, a] of Object.entries(km[layer] || {})) {
    if (a?.type === "macro" && a.index === v.sel) here.push({ layer, idx: +idx, k: keyByIndex(+idx) });
  }
  const combos = triggers().map((t, i) => ({ ...t, i })).filter((t) => t.macro === v.sel);
  if (!v.pick) {
    return `<div class="row wrap m-trig">${here.length || combos.length ? `<span class="m-trig-l">Запуск</span>${here.map((t) =>
      `<span class="chip trig"><kbd>${t.layer === "fn" ? "Fn + " : ""}${esc(t.k ? fullName(t.k) : "#" + t.idx)}</kbd>
        <button class="btn small quiet icon" data-unassign="${t.layer}:${t.idx}" aria-label="Снять с ${esc(t.k ? fullName(t.k) : "клавиши")}" data-tip="Снять с клавиши">${icon("close")}</button></span>`).join("")}
      ${combos.map((t) => `<span class="chip trig combo" data-tip="Ловит Studio — работает, пока она запущена"><kbd>${esc(comboText(t.mods, t.hid))}</kbd>
        <button class="btn small quiet icon" data-uncombo="${t.i}" aria-label="Снять сочетание ${esc(comboText(t.mods, t.hid))}">${icon("close")}</button></span>`).join("")}`
      : `<span class="note">Макрос ещё не висит ни на одной клавише — назначь клавишу, Fn + клавишу или сочетание вроде Ctrl + Shift + M.</span>`}</div>`;
  }
  const p = v.pick, k = p.key != null ? keyByIndex(p.key) : null;
  const seg = `<div class="row wrap between"><div class="seg" role="group" aria-label="Как запускать">
      <button data-player="base" aria-pressed="${p.layer === "base"}">Клавиша</button>
      <button data-player="fn" aria-pressed="${p.layer === "fn"}">Fn + клавиша</button>
      <button data-player="combo" aria-pressed="${p.layer === "combo"}">Сочетание</button></div>
      <button class="btn small quiet" data-a="pick-cancel">Отмена</button></div>`;
  if (p.layer === "combo") {
    const ready = k && p.mods.length, txt = ready ? comboText(p.mods, k.hid) : "";
    const busy = ready && BUSY[[...p.mods, hidName(k.hid)].join("+")];
    const taken = ready && triggers().find((t) => t.hid === k.hid && t.mods.join() === p.mods.join() && t.macro !== v.sel);
    const shiftOnly = ready && p.mods.join() === "shift" && k.hid >= 0x04 && k.hid <= 0x38 && ![0x28, 0x29, 0x2a, 0x2b].includes(k.hid);
    return `<div class="m-pick">${seg}
      <div class="row wrap m-mods" role="group" aria-label="Модификаторы">${MODS.map(([m, t]) => `<button class="key-toggle" data-pmod="${m}" aria-pressed="${p.mods.includes(m)}">${t}</button>`).join("")}
        <span class="m-plus">+</span><span class="key-toggle main ${k ? "on" : ""}">${k ? esc(hidName(k.hid)) : "клавиша"}</span></div>
      ${ready ? `<div class="m-pick-sum"><kbd>${esc(txt)}</kbd><span>станет: <b>макрос «${esc(cur().name || `Макрос ${v.sel + 1}`)}»</b></span></div>` : ""}
      ${busy ? `<p class="note warn">${esc(txt)} — это «${esc(busy)}». Пока запущена Studio, оно перестанет работать во всех программах.</p>` : ""}
      ${taken ? `<p class="note warn">Это сочетание уже запускает «${esc(list()[taken.macro]?.name || `Макрос ${taken.macro + 1}`)}» — оно перейдёт к этому макросу.</p>` : ""}
      ${shiftOnly ? `<p class="note warn">Shift + буква — это обычный набор текста. Добавь Ctrl, Alt или Win.</p>` : ""}
      ${ready && !shiftOnly ? `<div class="row wrap"><button class="btn primary" data-a="combo-save">${icon("check")}Сохранить сочетание</button>
        <span class="msg" id="pickMsg" aria-live="polite"></span></div>` : ""}
      <p class="note">${ready ? "" : "Нажми сочетание целиком на клавиатуре — например, зажми Ctrl и Shift и нажми M. Или собери его кнопками и щелчком по карте. "}Сочетание ловит Lunacy Studio: программа под ним его не увидит, а макрос напечатается, когда отпустишь клавиши. Работает, пока Studio запущена; в клавиатуру ничего не пишется.</p>
    </div>`;
  }
  const before = k ? km[p.layer]?.[k.key_index] : null;
  const name = (k ? (p.layer === "fn" ? "Fn + " : "") + fullName(k) : "");
  return `<div class="m-pick">${seg}
    ${k ? `<div class="m-pick-sum"><kbd>${esc(name)}</kbd><span>было: <b>${esc(before ? actionText(before, { long: true }) : "заводское действие")}</b></span>
        <span>станет: <b>макрос «${esc(cur().name || `Макрос ${v.sel + 1}`)}»</b></span></div>
      <div class="row wrap"><button class="btn primary" data-a="pick-save">${icon("check")}Записать в клавиатуру</button>
        <span class="msg" id="pickMsg" aria-live="polite"></span></div>`
      : `<p class="note">Щёлкни клавишу на карте выше или просто нажми её на клавиатуре. Макрос из клавиатуры работает везде, даже без Studio. Нужно сочетание вроде Ctrl + Shift + M — выбери «Сочетание».</p>`}
  </div>`;
}

function pickKey(idx, mods = null) {
  const k = keyByIndex(idx);
  if (!k) return;
  const p = v.pick;
  if (mods?.length) { p.layer = "combo"; p.mods = MODS.map(([m]) => m).filter((m) => mods.includes(m)); }
  if (p.layer === "combo" && MOD_OF_HID[k.hid]) {       // щелчок по Ctrl/Shift/Alt/Win на карте — включить или снять
    const m = MOD_OF_HID[k.hid];
    p.mods = p.mods.includes(m) ? p.mods.filter((x) => x !== m) : MODS.map(([x]) => x).filter((x) => x === m || p.mods.includes(x));
    render(); return;
  }
  if (k.name === "Fn") { toast(p.layer === "combo" ? "Fn система не видит — в сочетание она не входит" : "На Fn макрос не повесить — она переключает слой", { kind: "err" }); return; }
  p.key = idx; render();
}

async function saveTriggers(list, okText) {
  const r = await post("/api/macros/triggers", { triggers: list });
  store.server.profile.triggers = r.triggers;
  toast(okText, { sub: "Работает, пока запущена Studio" });
}

async function saveCombo(btn) {
  const p = v.pick, k = keyByIndex(p.key), msg = $("#pickMsg", v.root);
  if (!cur().actions.length) { setMsg(msg, "Макрос пустой — сначала добавь шаги.", "err"); return; }
  if (store.drafts.macros) { setMsg(msg, "Сначала запиши черновик макросов: сочетание проигрывает то, что уже сохранено.", "err"); return; }
  const rest = triggers().filter((t) => !(t.hid === k.hid && t.mods.join() === p.mods.join()));
  btn?.classList.add("busy");
  try { await saveTriggers([...rest, { mods: p.mods, hid: k.hid, macro: v.sel }], `«${cur().name || `Макрос ${v.sel + 1}`}» теперь на ${comboText(p.mods, k.hid)}`); v.pick = null; }
  catch (e) { btn?.classList.remove("busy"); setMsg(msg, e.message, "err"); return; }
  render();
}

async function uncombo(i) {
  const t = triggers()[i]; if (!t) return;
  try { await saveTriggers(triggers().filter((_, j) => j !== i), `${comboText(t.mods, t.hid)} больше не запускает макрос`); }
  catch (e) { toastError(e); }
  render();
}

async function savePick(btn) {
  const p = v.pick, msg = $("#pickMsg", v.root);
  if (!p || p.key == null) return;
  const block = blockReason();
  if (block) { setMsg(msg, `${block[0]}. ${block[1]}.`, "err"); return; }
  if (!cur().actions.length) { setMsg(msg, "Макрос пустой — сначала добавь шаги.", "err"); return; }
  D.setKeyAction(p.layer, p.key, { type: "macro", index: v.sel, mode: 1, count: 1 });
  btn?.classList.add("busy");
  try {
    // с черновиком макросов — одной операцией вместе с ними; без него — только эта клавиша
    const r = store.drafts.macros ? await D.commitMacros() : await D.commitKeymap((c) => c.layer === p.layer && c.key === p.key);
    const k = keyByIndex(p.key);
    toast(`«${cur().name || `Макрос ${v.sel + 1}`}» теперь на ${p.layer === "fn" ? "Fn + " : ""}${k ? fullName(k) : "клавише"}`, { sub: r?.message || "Записано в клавиатуру" });
    v.pick = null;
  } catch (e) { btn?.classList.remove("busy"); setMsg(msg, e.message, "err"); return; }
  render();
}

async function unassign(layer, idx) {
  const block = blockReason();
  if (block) { toast(block[0], { sub: block[1], kind: "err" }); return; }
  D.setKeyAction(layer, idx, { type: "default" });
  try {
    if (store.drafts.macros) await D.commitMacros(); else await D.commitKeymap((c) => c.layer === layer && c.key === idx);
    const k = keyByIndex(idx);
    toast(`${layer === "fn" ? "Fn + " : ""}${k ? fullName(k) : "Клавиша"} вернулась к заводскому действию`);
  } catch (e) { toastError(e); }
  render();
}

function assignedIdx(i, km = D.keymapView()) {
  const out = [];
  for (const layer of ["base", "fn"]) for (const [idx, a] of Object.entries(km[layer] || {})) if (a?.type === "macro" && a.index === i) out.push(+idx);
  return out;
}

function assigned(i, km = D.keymapView()) {
  const out = [];
  for (const layer of ["base", "fn"]) for (const [idx, a] of Object.entries(km[layer] || {})) {
    if (a?.type === "macro" && a.index === i) { const k = keyByIndex(+idx); out.push((layer === "fn" ? "Fn+" : "") + (k ? fullName(k) : `#${idx}`)); }
  }
  for (const t of triggers()) if (t.macro === i) out.push(comboText(t.mods, t.hid).replaceAll(" + ", "+"));
  return out;
}

// ---------- лента времени: шкала мс, точки нажатий, полосы удержания ----------
function drawTimeline() {
  const box = v && $("#tl", v.root); if (!box) return;
  if (v.roBox !== box) { v.ro.disconnect(); v.ro.observe(box); v.roBox = box; }
  const acts = cur()?.actions || [], W = Math.max(240, box.clientWidth), H = 92, L = 12, R = 14, AX = 72;
  const evs = []; let t = 0; const at = new Map();
  for (const [k, val] of acts) {
    if (k === "delay") { t += Math.max(10, +val); continue; }
    const n = at.get(t) || 0; at.set(t, n + 1); evs.push({ k, val, t, n });
  }
  const byOrder = t === 0;
  const total = byOrder ? Math.max(1, evs.length - 1) : t;
  if (byOrder) evs.forEach((e, i) => { e.t = i; e.n = 0; });
  const X = (e) => Math.min(W - R, L + (W - L - R) * (e.t / total) + Math.min(e.n * 6, 24));
  let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  s += `<line class="axis" x1="${L}" x2="${W - R}" y1="${AX}" y2="${AX}"/>`;
  if (!byOrder) {
    const raw = total / Math.max(2, Math.floor((W - L - R) / 70));
    const step = [10, 20, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 20000, 60000].find((x) => x >= raw) || 60000;
    for (let x = 0; x <= total + .1; x += step) {
      const px = L + (W - L - R) * (x / total);
      s += `<line class="tick" x1="${px}" x2="${px}" y1="${AX}" y2="${AX + 5}"/><text class="lbl" x="${px}" y="${AX + 17}">${x ? fmt.ms(x) : "0"}</text>`;
    }
  } else if (evs.length) s += `<text class="lbl" x="${W / 2}" y="${AX + 17}">без пауз — всё сразу</text>`;
  const LANES = [14, 29, 44, 59], lanes = [null, null, null, null], open = new Map();
  for (const e of evs) {
    const x = X(e), isDown = e.k === "down" || e.k === "mdown", key = (e.k[0] === "m" ? "m" : "k") + e.val;
    if (isDown) {
      let li = lanes.indexOf(null); if (li < 0) li = 3;
      lanes[li] = key; open.set(key, { x, li });
      s += `<circle class="${e.k === "mdown" ? "ev-mouse" : "ev-down"}" cx="${x}" cy="${LANES[li]}" r="3.4"/>`;
      s += `<text class="evl" x="${x + 6}" y="${LANES[li] + 3.4}" text-anchor="start">${esc(e.k === "mdown" ? "клик" : shortName(e.val))}</text>`;
    } else {
      const o = open.get(key);
      if (o) {
        s += `<line class="hold" x1="${o.x}" x2="${x}" y1="${LANES[o.li]}" y2="${LANES[o.li]}"/>`;
        s += `<circle class="${e.k === "mup" ? "ev-mouse" : "ev-up"}" cx="${x}" cy="${LANES[o.li]}" r="3"/>`;
        lanes[o.li] = null; open.delete(key);
      }
    }
  }
  for (const o of open.values()) s += `<line class="hold open" x1="${o.x}" x2="${W - R}" y1="${LANES[o.li]}" y2="${LANES[o.li]}"/>`;
  if (!evs.length) s += `<text class="lbl" x="${W / 2}" y="${AX - 26}">лента пуста</text>`;
  box.innerHTML = s + "</svg>";
}
const shortName = (hid) => ({ 0xe0: "Ctrl", 0xe4: "Ctrl", 0xe1: "Shift", 0xe5: "Shift", 0xe2: "Alt", 0xe6: "Alt", 0xe3: "Win", 0xe7: "Win", 0x2c: "␣", 0x28: "Enter", 0x2a: "⌫", 0x2b: "Tab", 0x29: "Esc" })[hid] || hidName(hid).replace(/^Num /, "N");

// ================= события =================
function bind(root) {
  const offs = [];
  offs.push(on(root, "click", "[data-a]", (e, b) => action(b.dataset.a, b, e)));
  offs.push(on(root, "click", ".m-item", (e, el) => { if (!recBusy()) { v.pick = null; selectMacro(+el.dataset.i); } }));
  offs.push(on(root, "click", "[data-player]", (e, b) => {
    const was = v.pick.layer; v.pick.layer = b.dataset.player; v.pick.mods ??= [];
    if (v.pick.layer === "combo" && was !== "combo" && !v.pick.mods.length) v.pick.mods = ["ctrl", "shift"];
    render();
  }));
  offs.push(on(root, "click", "[data-pmod]", (e, b) => { const m = b.dataset.pmod, p = v.pick;
    p.mods = p.mods.includes(m) ? p.mods.filter((x) => x !== m) : MODS.map(([x]) => x).filter((x) => x === m || p.mods.includes(x)); render(); }));
  offs.push(on(root, "click", "[data-uncombo]", (e, b) => uncombo(+b.dataset.uncombo)));
  offs.push(on(root, "click", "[data-unassign]", (e, b) => { const [l, i] = b.dataset.unassign.split(":"); unassign(l, +i); }));
  offs.push(on(root, "keydown", ".m-item", (e, el) => {
    const i = +el.dataset.i, n = list().length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); selectMacro((i + (e.key === "ArrowDown" ? 1 : -1) + n) % n, true); }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $(".m-name", root)?.focus(); }
  }));
  offs.push(on(root, "input", ".m-name", (e, inp) => { const it = $(`.m-item[data-i="${v.sel}"] b`, root); if (it) it.textContent = inp.value || `Макрос ${v.sel + 1}`; }));
  offs.push(on(root, "change", ".m-name", (e, inp) => { const name = inp.value.trim().slice(0, 40); if (name !== cur().name) D.updateMacros((d) => { d[v.sel].name = name || `Макрос ${v.sel + 1}`; }); }));
  offs.push(on(root, "keydown", ".m-name", (e, inp) => { if (e.key === "Enter") inp.blur(); }));
  offs.push(on(root, "change", "[data-delay]", (e, inp) => {
    const i = +inp.dataset.delay, ms = Math.max(10, Math.min(65535, Math.round(+inp.value || 10)));
    v.focusAfter = `d${i}`;
    D.updateMacros((d) => { d[v.sel].actions[i][1] = ms; });
  }));
  offs.push(on(root, "change", "[data-btn]", (e, sel) => {
    const i = +sel.dataset.btn, nv = +sel.value;
    D.updateMacros((d) => { const a = d[v.sel].actions, old = a[i][1]; a[i][1] = nv; const j = pairOf(a, i, old, "mdown", "mup"); if (j >= 0) a[j][1] = nv; });
  }));
  offs.push(on(root, "click", "[data-cap]", (e, b) => { e.stopPropagation(); v.capture = v.capture === +b.dataset.cap ? null : +b.dataset.cap; v.focusAfter = `c${b.dataset.cap}`; render(); }));
  offs.push(on(root, "click", "[data-del]", (e, b) => removeStep(+b.dataset.del)));
  offs.push(on(root, "click", "[data-ins]", (e, b) => { v.insertAt = +b.dataset.ins; render(); }));
  offs.push(on(root, "click", "[data-add]", (e, b) => addStep(b.dataset.add, b.dataset.at === "end" ? cur().actions.length : v.insertAt ?? cur().actions.length)));
  offs.push(on(root, "keydown", ".grip", (e, g) => {
    const i = +g.closest(".step").dataset.s;
    if (e.key === "ArrowUp" && i > 0) { e.preventDefault(); moveStep(i, i - 1); }
    if (e.key === "ArrowDown" && i < cur().actions.length - 1) { e.preventDefault(); moveStep(i, i + 1); }
    if (e.key === "Delete") { e.preventDefault(); removeStep(i); }
  }));
  // перетаскивание шагов: тянуть можно только за ручку
  offs.push(on(root, "pointerdown", ".grip", (e, g) => { g.closest(".step").draggable = true; }));
  offs.push(on(root, "dragstart", ".step", (e, s) => { v.drag = +s.dataset.s; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", s.dataset.s); s.classList.add("dragging"); }));
  offs.push(on(root, "dragover", ".step", (e, s) => { if (v.drag == null) return; e.preventDefault(); $$(".step.drag-over", root).forEach((x) => x !== s && x.classList.remove("drag-over")); s.classList.add("drag-over"); }));
  offs.push(on(root, "drop", ".step", (e, s) => { e.preventDefault(); const from = v.drag; v.drag = null; if (from != null && from !== +s.dataset.s) moveStep(from, +s.dataset.s); }));
  offs.push(on(root, "dragend", ".step", () => { v && (v.drag = null); $$(".step", root).forEach((x) => { x.draggable = false; x.classList.remove("drag-over", "dragging"); }); }));

  // захват клавиши для шага и запись: раньше всех остальных обработчиков
  const onWinKey = (e) => {
    if (!v) return;
    if (v.rec?.phase === "on") return recKey(e);
    if (v.pick && v.capture == null && e.type === "keydown" && !e.repeat && !document.querySelector("dialog[open]")
        && !e.target.closest?.("input, textarea, select")) {
      if (e.key === "Escape") { v.pick = null; render(); return; }
      const hid = CODE_HID[e.code];
      e.preventDefault(); e.stopImmediatePropagation();
      if (isModifierHid(hid)) return;                     // ждём основную клавишу: Ctrl, Shift… только зажаты
      const mods = [e.ctrlKey && "ctrl", e.shiftKey && "shift", e.altKey && "alt", e.metaKey && "win"].filter(Boolean);
      const k = keyByHid(hid);
      if (k) pickKey(k.key_index, mods);
      return;
    }
    if (v.capture == null || document.querySelector("dialog[open]")) return;
    if (e.code === "Tab") { if (e.type === "keydown") { v.capture = null; render(); } return; } // Tab — отмена, фокус идёт дальше
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.type !== "keydown" || e.repeat) return;
    const hid = CODE_HID[e.code];
    if (hid == null || (hid > HID_LIMIT && !isModifierHid(hid))) { toast(`Эту клавишу (${e.code || e.key}) макрос нажать не сможет`, { kind: "err" }); return; }
    setCaptured(hid);
  };
  const cancelCapture = (e) => { if (v?.capture != null && !e.target.closest("[data-cap]")) { v.capture = null; render(); } };
  const onBlur = () => { if (v?.rec?.phase === "on") { stopRec(); toast("Запись остановлена: окно потеряло фокус", { sub: "Записанное сохранено в черновике" }); } };
  window.addEventListener("keydown", onWinKey, true);
  window.addEventListener("keyup", onWinKey, true);
  window.addEventListener("blur", onBlur);
  document.addEventListener("pointerdown", cancelCapture, true);
  return () => {
    offs.forEach((f) => f());
    window.removeEventListener("keydown", onWinKey, true);
    window.removeEventListener("keyup", onWinKey, true);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("pointerdown", cancelCapture, true);
  };
}

function selectMacro(i, focus) {
  if (i === v.sel && !focus) return;
  v.sel = clampSel(i); v.capture = null; v.insertAt = null;
  local.set("macroSel", v.sel);
  if (focus) v.focusAfter = null;
  render();
  if (focus) $(`.m-item[data-i="${v.sel}"]`, v.root)?.focus();
}

const recBusy = () => { if (!v?.rec) return false; toast("Идёт запись нажатий", { sub: "Останови её кнопкой «Стоп» или отмени" }); return true; };

// Макрос, созданный кнопкой пустого состояния, убираем, если человек передумал (отмена текста или записи).
function dropIfFresh() {
  const i = v?.freshIdx; if (v) v.freshIdx = null;
  if (i != null && list()[i] && !list()[i].actions.length && list().length === i + 1) D.undoMacros();
}

async function action(a, btn) {
  if (v.rec && !["rec-stop", "rec-cancel"].includes(a)) { recBusy(); return; }
  const m = cur();
  switch (a) {
    case "play": return v.stage?.play();
    case "new": return createMacro();
    case "start-empty": createMacro(); return;
    case "start-text": createMacro(); v.freshIdx = v.sel; return fromText();
    case "start-rec": createMacro(); v.freshIdx = v.sel; return startRec();
    case "text": return fromText();
    case "rec": return startRec();
    case "rec-stop": return stopRec();
    case "rec-cancel": return stopRec(true);
    case "ins-close": v.insertAt = null; return render();
    case "tempo": return tempo();
    case "dup": {
      if (list().length >= MAX) return;
      const i = v.sel;
      D.updateMacros((d) => { const { _o, ...copy } = structuredClone(d[i]); d.splice(i + 1, 0, { ...copy, name: `${d[i].name} (копия)`.slice(0, 40) }); });
      selectMacro(i + 1);
      return toast("Макрос продублирован", { undo: undoThis("macros") });
    }
    case "del": return deleteMacro();
    case "assign": if (!m.actions.length) { toast("Макрос пустой — сначала добавь шаги", { kind: "err" }); return; }
      v.pick = v.pick ? null : { layer: "base", key: null, mods: [] }; return render();
    case "pick-cancel": v.pick = null; return render();
    case "pick-save": return savePick(btn);
    case "combo-save": return saveCombo(btn);
  }
}

function createMacro() {
  if (list().length >= MAX) { toast("В клавиатуре помещается 100 макросов", { kind: "err" }); return; }
  const n = list().length;
  const used = new Set(list().map((x) => x.name));
  let k = n + 1; while (used.has(`Макрос ${k}`)) k++;
  D.updateMacros((d) => d.push({ name: `Макрос ${k}`, actions: [] }));
  v.sel = n; local.set("macroSel", n); v.insertAt = null;
  v.focusAfter = "name";
  render();
  $(".m-name", v.root)?.select();
}

// ---------- шаги ----------
function pairOf(a, i, val, downKind = "down", upKind = "up") {
  if (a[i][0] === downKind) { for (let j = i + 1; j < a.length; j++) if (a[j][0] === upKind && a[j][1] === val) return j; }
  else if (a[i][0] === upKind) { for (let j = i - 1; j >= 0; j--) if (a[j][0] === downKind && a[j][1] === val) return j; }
  return -1;
}

function setCaptured(hid) {
  const i = v.capture; v.capture = null;
  v.focusAfter = `c${i}`;
  D.updateMacros((d) => {
    const a = d[v.sel].actions, old = a[i][1];
    const j = pairOf(a, i, old); a[i][1] = hid; if (j >= 0) a[j][1] = hid;
  });
}

function addStep(kind, at) {
  const def = local.get("macroDelay", 20);
  const ins = {
    key: [["down", 0x04], ["delay", def], ["up", 0x04]],
    combo: [["down", 0xe0], ["down", 0x06], ["delay", def], ["up", 0x06], ["up", 0xe0]],
    pause: [["delay", 100]],
    click: [["mdown", 1], ["delay", def], ["mup", 1]],
  }[kind];
  // перед новым шагом нужна пауза, если предыдущий — не пауза
  const a = cur().actions;
  const lead = at > 0 && a[at - 1]?.[0] !== "delay" && kind !== "pause" ? [["delay", def]] : [];
  D.updateMacros((d) => d[v.sel].actions.splice(at, 0, ...lead, ...ins));
  v.insertAt = null;
  if (kind === "key" || kind === "combo") { v.capture = at + lead.length + (kind === "combo" ? 1 : 0); v.focusAfter = `c${v.capture}`; render(); }
  else if (kind === "pause") { v.focusAfter = `d${at}`; render(); }
}

function removeStep(i) {
  const a = cur().actions, [k, val] = a[i];
  const j = k === "delay" ? -1 : pairOf(a, i, val, k[0] === "m" ? "mdown" : "down", k[0] === "m" ? "mup" : "up");
  D.updateMacros((d) => {
    const x = d[v.sel].actions;
    // вместе с нажатием убираем его отпускание (и наоборот), чтобы клавиша не осталась зажатой
    [i, j].filter((n) => n >= 0).sort((p, q) => q - p).forEach((n) => x.splice(n, 1));
  });
  v.focusAfter = `g${Math.min(i, cur().actions.length - 1)}`;
  render();
  if (j >= 0) toast("Удалены нажатие и отпускание", { undo: undoThis("macros") });
}

function moveStep(from, to) {
  v.focusAfter = `g${to}`;
  D.updateMacros((d) => { const a = d[v.sel].actions; const [x] = a.splice(from, 1); a.splice(to, 0, x); });
}

async function tempo() {
  const dlg = h(`<dialog class="dlg"><form method="dialog"><div class="dlg-body">
      <h2>Ровный темп</h2><p class="muted">Все паузы в макросе станут одинаковыми.</p>
      <div class="seg" id="tp">${TEMPO.map((t) => `<button type="button" data-ms="${t.ms}">${t.label}<small class="annot">&nbsp;${t.d}</small></button>`).join("")}</div>
      <div class="field"><label for="tpv">Или своя пауза, мс</label><input class="input num" id="tpv" type="number" min="10" max="65535" value="${local.get("macroDelay", 20)}"></div>
    </div><div class="dlg-foot"><button type="button" class="btn quiet" data-cancel>Отмена</button><button class="btn primary" value="ok">Применить</button></div></form></dialog>`);
  document.body.appendChild(dlg); wireDialog(dlg);
  on(dlg, "click", "[data-ms]", (e, b) => { $("#tpv", dlg).value = b.dataset.ms; $$("[data-ms]", dlg).forEach((x) => x.setAttribute("aria-pressed", x === b)); });
  dlg.showModal();
  await new Promise((r) => dlg.addEventListener("close", r, { once: true }));
  if (!v) { dlg.remove(); return; }                         // ушли со страницы, пока диалог был открыт
  if (dlg.returnValue === "ok") {
    const ms = Math.max(10, Math.min(65535, Math.round(+$("#tpv", dlg).value || 20)));
    local.set("macroDelay", ms);
    D.updateMacros((d) => d[v.sel].actions.forEach((x) => { if (x[0] === "delay") x[1] = ms; }));
    toast(`Все паузы — ${ms} мс`, { undo: undoThis("macros") });
  }
  dlg.remove();
}

// ---------- из текста ----------
async function fromText() {
  const tm = local.get("macroTempo", 12);
  const dlg = h(`<dialog class="dlg wide"><form method="dialog"><div class="dlg-body">
      <h2>Макрос из текста</h2>
      <div class="field"><label for="ftx">Что набрать</label>
        <textarea class="textarea" id="ftx" rows="4" maxlength="400" placeholder="Например: С уважением, Иван"></textarea></div>
      <p class="note" id="ftNote">Макрос нажимает клавиши, а не буквы: русский текст наберётся, если в момент нажатия включена русская раскладка, английский — английская.</p>
      <div class="field"><span class="label">Скорость набора</span>
        <div class="seg" id="ftTempo">${TEMPO.map((t) => `<button type="button" data-ms="${t.ms}" aria-pressed="${t.ms === tm}">${t.label}</button>`).join("")}</div></div>
      <span class="msg" id="ftMsg"></span>
    </div><div class="dlg-foot">
      <button type="button" class="btn quiet" data-cancel>Отмена</button>
      ${cur().actions.length ? `<button class="btn" value="append">Добавить в конец</button>` : ""}
      <button class="btn primary" value="replace">${cur().actions.length ? "Заменить шаги" : "Создать шаги"}</button>
    </div></form></dialog>`);
  document.body.appendChild(dlg); wireDialog(dlg);
  let ms = tm;
  on(dlg, "click", "[data-ms]", (e, b) => { ms = +b.dataset.ms; $$("[data-ms]", dlg).forEach((x) => x.setAttribute("aria-pressed", x === b)); });
  const ta = $("#ftx", dlg), note = $("#ftNote", dlg);
  ta.addEventListener("input", () => {
    const mixed = /[а-яё]/i.test(ta.value) && /[a-z]/i.test(ta.value);
    note.classList.toggle("warn", mixed);
    note.textContent = mixed
      ? "В тексте и русские, и английские буквы. Макрос не переключает раскладку — часть текста наберётся не теми буквами. Лучше сделать два макроса."
      : "Макрос нажимает клавиши, а не буквы: русский текст наберётся, если в момент нажатия включена русская раскладка, английский — английская.";
  });
  $("form", dlg).addEventListener("submit", async (e) => {
    const mode = e.submitter?.value;
    if (mode === "cancel") return;
    e.preventDefault();
    if (!ta.value) { setMsg($("#ftMsg", dlg), "Напиши текст, который нужно набрать", "err"); ta.focus(); return; }
    try {
      const r = await post("/api/macros/from_text", { text: ta.value, delay: ms });
      if (!v) { dlg.close(); return; }
      const rename = /^Макрос \d+$/.test(cur().name) && (mode === "replace" || !cur().actions.length);
      local.set("macroTempo", ms);
      D.updateMacros((d) => {
        const a = d[v.sel].actions;
        if (mode === "append") a.push(...(a.length && a.at(-1)[0] !== "delay" ? [["delay", ms]] : []), ...r.actions); else d[v.sel].actions = r.actions;
        if (rename) d[v.sel].name = ta.value.replace(/\s+/g, " ").trim().slice(0, 28) + (ta.value.length > 28 ? "…" : "");
      });
      dlg.close("ok");
      toast(`Шагов: ${cur().actions.length}`, { sub: "Проверь и запиши в клавиатуру", undo: undoThis("macros") });
    } catch (err) { setMsg($("#ftMsg", dlg), err.message, "err"); }
  });
  dlg.addEventListener("close", () => { if (dlg.returnValue !== "ok") dropIfFresh(); else if (v) v.freshIdx = null; dlg.remove(); });
  dlg.showModal(); ta.focus();
}

// ---------- запись ----------
// ponytail: слушаем нажатия только в окне браузера. Потолок: Win, Alt+Tab, Ctrl+Alt+Del забирает Windows.
// Апгрейд, если понадобится: запись через хук клавиатуры сервиса (winapi.py), он видит и эти клавиши.
function startRec() {
  if (!cur()) return;
  v.capture = null; v.insertAt = null;
  v.rec = { phase: "count", n: 3, ev: [], down: new Set(), skipped: 0, last: 0, t0: 0, idx: v.sel };
  renderRec();
  v.rec.timer = setInterval(() => {
    const r = v?.rec; if (!r) return;
    if (--r.n > 0) return renderRec();
    clearInterval(r.timer);
    r.phase = "on"; r.t0 = r.last = performance.now();
    r.auto = setTimeout(() => { if (v?.rec === r) { stopRec(); toast("Запись остановлена: прошло 2 минуты"); } }, 120000);
    renderRec();
  }, 1000);
}

function recKey(e) {
  e.preventDefault(); e.stopImmediatePropagation();
  const r = v.rec;
  if (e.repeat) return;
  const hid = CODE_HID[e.code];
  if (hid == null || (hid > HID_LIMIT && !isModifierHid(hid))) { if (e.type === "keydown") { r.skipped++; renderRec(); } return; }
  const kind = e.type === "keydown" ? "down" : "up";
  if (kind === "up" && !r.down.has(hid)) return; // отпустили то, что нажали до старта
  const now = performance.now();
  if (!r.ev.length) r.first = now;
  if (r.ev.length) r.ev.push(["delay", Math.max(10, Math.min(65535, Math.round(now - r.last)))]);
  r.last = now;
  r.ev.push([kind, hid]);
  kind === "down" ? r.down.add(hid) : r.down.delete(hid);
  if (r.ev.length >= REC_LIMIT) { stopRec(); toast(`Запись остановлена: ${REC_LIMIT} шагов — больше не уместится`); return; }
  renderRec();
}

function stopRec(cancel) {
  const r = v?.rec; if (!r) return;
  clearInterval(r.timer); clearTimeout(r.auto);
  v.rec = null;
  if (cancel || r.phase !== "on") { dropIfFresh(); render(); return; }
  for (const hid of r.down) r.ev.push(["delay", 10], ["up", hid]); // ничего не оставляем зажатым
  if (!r.ev.length) { dropIfFresh(); render(); toast("Ничего не записано", { sub: "Нажимай клавиши после отсчёта" }); return; }
  v.freshIdx = null;
  D.updateMacros((d) => { if (d[r.idx]) d[r.idx].actions = r.ev; });
  toast(`Записано шагов: ${r.ev.length}`, { sub: r.skipped ? `Пропущено клавиш, которые макрос нажать не может: ${r.skipped}` : "Проверь и запиши в клавиатуру", undo: undoThis("macros") });
}

function recHtml() {
  const r = v.rec;
  if (r.phase === "count") return `
    <div class="rec-panel" role="status" aria-live="assertive">
      <span class="rec-count">${r.n}</span>
      <p>Приготовься: запись начнётся через ${r.n} ${fmt.plural(r.n, "секунду", "секунды", "секунд")}.</p>
      <button class="btn quiet" data-a="rec-cancel">Отмена</button>
    </div>`;
  const dur = r.ev.length ? r.last - r.first : 0;
  return `
    <div class="rec-panel on" role="status">
      <div class="row"><span class="rec-dot"></span><b>Запись</b><span class="annot num">${r.ev.length} ${fmt.plural(r.ev.length, "шаг", "шага", "шагов")} · ${fmt.ms(Math.round(dur))}</span></div>
      <div class="preview-line"><span class="annot">Наберёт</span><span class="typed">${esc(describe(r.ev)) || '<span class="muted">нажимай клавиши…</span>'}</span></div>
      <p class="note">Паузы между нажатиями сохранятся как есть. Win, Alt+Tab и Ctrl+Alt+Del забирает Windows — их записать нельзя.${r.skipped ? ` Пропущено: ${r.skipped}.` : ""}</p>
      <div class="row"><button class="btn primary" data-a="rec-stop">${icon("stop")}Стоп</button><button class="btn quiet" data-a="rec-cancel">Отменить запись</button></div>
      <p class="note">Останови мышкой: нажатия клавиш сейчас попадают в макрос.</p>
    </div>`;
}
function renderRec() { const ed = v && $("#mEd", v.root); if (ed) ed.innerHTML = recHtml(); }

// ---------- удалить, назначить ----------
async function deleteMacro() {
  const i = v.sel, m = cur(), keysOn = assigned(i);
  if (keysOn.length) {
    const ok = await confirmDialog({
      title: `Удалить «${m.name}»?`, body: "Макрос назначен на клавиши. Они вернутся к заводскому действию:",
      items: keysOn, confirm: "Удалить макрос", danger: true,
    });
    if (!ok || !v) return;
  }
  const moved = D.removeMacro(i);
  v.sel = clampSel(i); render();
  toast(`Макрос «${m.name}» удалён`, {
    sub: moved ? "Назначения на клавишах обновятся при записи" : "Удалится из клавиатуры при записи",
    undo: undoThis("macros", () => { if (v) v.sel = i; }), // шаг удаления возвращает и номера на клавишах
  });
}
