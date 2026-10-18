// Наглядные «приборы» раздела «Настройки»: каждая настройка показана моделью своего действия, а не абзацем.
// Чистая разметка (строки HTML/SVG), без состояния: settings.js вызывает их при каждой перерисовке.
import { esc } from "../core/dom.js";
import { icon } from "../core/icons.js";

// ---------- блокировки: нарисованные сочетания ----------
export const LOCKS = [
  { k: "disable_alttab", caps: ["Alt", "Tab"], t: "Alt + Tab", d: "игра не свернётся" },
  { k: "disable_altf4", caps: ["Alt", "F4"], t: "Alt + F4", d: "окно не закроется" },
  { k: "disable_win", caps: ["Win"], t: "Win", d: "«Пуск» не откроется" },
];

export function locks(vals) {
  return `<div class="combos" role="group" aria-label="Блокировки сочетаний">${LOCKS.map((l) => {
    const on = !!vals[l.k];
    return `<button class="combo" role="switch" aria-checked="${on}" data-lock="${l.k}" aria-label="Блокировать ${esc(l.t)}: ${esc(l.d)}">
      <span class="caps">${l.caps.map((c) => `<kbd>${esc(c)}</kbd>`).join('<i aria-hidden="true">+</i>')}</span>
      <span class="combo-state">${on ? `${icon("disabled")}Заблокировано` : "Работает"}</span>
      <span class="combo-d">${esc(l.d)}</span>
    </button>`;
  }).join("")}</div>`;
}

// ---------- режим Fn: две дорожки времени ----------
// Дорожка «Fn» — когда клавиша нажата, дорожка «слой» — когда работает Fn-слой.
export const FN_MODES = [
  { t: "Пока держишь", d: "слой работает, пока Fn зажата", press: [[18, 78], [120, 168]], layer: [[18, 78], [120, 168]] },
  { t: "Нажал — включил", d: "одно нажатие включает слой, второе выключает", press: [[18, 30], [120, 132]], layer: [[18, 120]] },
];

function fnSvg(m) {
  const bar = (y, [a, b], cls) => `<rect class="${cls}" x="${a}" y="${y}" width="${b - a}" height="9" rx="2.5"/>`;
  return `<svg class="fn-svg" viewBox="0 0 196 54" aria-hidden="true">
    <text class="lane" x="0" y="15">Fn</text><text class="lane" x="0" y="39">слой</text>
    <line class="axis" x1="34" y1="11.5" x2="196" y2="11.5"/><line class="axis" x1="34" y1="35.5" x2="196" y2="35.5"/>
    <g transform="translate(16 0)">${m.press.map((p) => bar(7, p, "press")).join("")}${m.layer.map((p) => bar(31, p, "layer")).join("")}</g>
    <line class="head" x1="34" y1="2" x2="34" y2="46"/>
  </svg>`;
}

export function fnModes(sel) {
  return `<div class="fn-modes" role="group" aria-label="Режим Fn">${FN_MODES.map((m, i) => `
    <button class="fn-mode" data-set="fn_mode" data-val="${i}" aria-pressed="${sel === i}">
      <span class="fn-t">${m.t}</span>${fnSvg(m)}<span class="fn-d">${m.d}</span>
    </button>`).join("")}</div>`;
}

// ---------- сон: шкала бездействия ----------
export const SLEEP = [{ t: "Никогда", min: 0 }, { t: "1 мин", min: 1 }, { t: "5 мин", min: 5 }, { t: "30 мин", min: 30 }];
const SLEEP_X = [97, 20, 46, 72];             // шкала 1 → 5 → 30 мин → ∞ (по логарифму), %

export function sleep(sel) {
  const never = sel === 0, x = never ? 100 : SLEEP_X[sel];
  const steps = [
    ["keys", "Печатаешь", "подсветка и экран горят"],
    ["clock", never ? "Пауза любой длины" : `${SLEEP[sel].t} без нажатий`, never ? "ничего не меняется" : "клавиатура ждёт"],
    [never ? "light" : "moon", never ? "Не гаснет" : "Гаснет", never ? "горит, пока подключена" : "первое нажатие разбудит и не напечатается"],
  ];
  return `<div class="sleep">
    <div class="sleep-bar" aria-hidden="true">
      <div class="lit" style="width:${x}%"></div>
      ${never ? "" : `<div class="dark" style="left:${x}%">${icon("moon")}<span>спит</span></div>`}
      <div class="kb-glyph lit-glyph">${icon("keys")}</div>
    </div>
    <div class="sleep-stops" role="group" aria-label="Засыпать без нажатий">${[1, 2, 3, 0].map((i) =>
      `<button data-set="sleep" data-val="${i}" aria-pressed="${sel === i}" style="--x:${SLEEP_X[i]}%">${i ? SLEEP[i].t : "∞ никогда"}</button>`).join("")}</div>
    <ol class="sleep-steps">${steps.map(([ic, t, d], i) => `<li class="${i === 2 && !never ? "off" : ""}">${icon(ic)}<b>${t}</b><span>${d}</span></li>`).join("")}</ol>
  </div>`;
}

// ---------- антидребезг: осциллограмма контакта ----------
// Задержки уровней — из строк фирменной программы (lang 600–621): [кабель, ресивер 2.4G], мс.
export const DEBOUNCE = [[[2, 3], [5, 6]], [[5, 6], [7, 9]], [[8, 9], [10, 12]], [[13, 14], [15, 17]], [[17, 18], [19, 21]]];
const BOUNCE_MS = 4.5;                        // типичный дребезг механического переключателя — до ~5 мс

export function debounce(level) {
  const W = 300, H = 104, x0 = 26, ms = 22, px = (t) => x0 + (t / ms) * (W - x0 - 8);
  const yLo = 78, yHi = 30, press = 1.2;
  // сигнал: покой → дребезг (скачки) → устойчиво нажато
  const pts = [[0, yLo], [press, yLo]];
  const chatter = [0.35, 0.3, 0.45, 0.3, 0.55, 0.35, 0.6, 0.45, 0.5, 0.35, 0.6];
  let t = press;
  chatter.forEach((d, i) => { pts.push([t, i % 2 ? yLo - 8 : yHi]); t += d * (BOUNCE_MS / 4.9); pts.push([t, i % 2 ? yLo - 8 : yHi]); });
  pts.push([t, yHi], [ms, yHi]);
  const path = pts.map(([tt, y], i) => `${i ? "L" : "M"}${px(tt).toFixed(1)} ${y}`).join(" ");
  const [lo, hi] = DEBOUNCE[level][0], win = hi;
  const early = win < press + BOUNCE_MS;      // окно кончается внутри дребезга → риск двойного нажатия
  const wx = px(press), ww = px(press + win) - wx, bx = px(press + BOUNCE_MS);
  return `<svg class="scope" viewBox="0 0 ${W} ${H}" role="img" aria-label="Нажатие засчитывается через ${lo}–${hi} мс после первого касания${early ? ", раньше, чем кончится дребезг" : ", когда дребезг уже кончился"}">
    <rect class="bounce-zone" x="${wx}" y="22" width="${bx - wx}" height="64"/>
    <rect class="window ${early ? "bad" : ""}" x="${wx}" y="18" width="${ww}" height="72" rx="3"/>
    <path class="sig" d="${path}"/>
    <line class="axis" x1="${x0}" y1="92" x2="${W - 8}" y2="92"/>
    ${[0, 5, 10, 15, 20].map((m) => `<text class="tick" x="${px(m)}" y="102">${m}</text>`).join("")}
    <text class="tick" x="${W - 8}" y="102" text-anchor="end">мс</text>
    <text class="lbl" x="${px(press + BOUNCE_MS / 2)}" y="14" text-anchor="middle">дребезг</text>
    <circle class="hit ${early ? "bad" : ""}" cx="${px(press + win)}" cy="${early ? yLo - 8 : yHi}" r="4"/>
  </svg>`;
}

export function debounceSay(level) {
  const [[lo, hi], [rlo, rhi]] = DEBOUNCE[level];
  const early = hi < 1.2 + BOUNCE_MS;
  return early
    ? `Засчитывает через <b>${lo}–${hi} мс</b> — раньше, чем кончится дребезг: на части переключателей одна клавиша напечатается дважды. Производитель советует уровень 2 и выше.`
    : `Засчитывает через <b>${lo}–${hi} мс</b> по кабелю (${rlo}–${rhi} мс через ресивер), когда контакт уже успокоился. Печатает дважды — подними уровень; хочешь быстрее — опусти.`;
}

export function levels(sel) {
  return `<div class="levels" role="group" aria-label="Уровень антидребезга">${DEBOUNCE.map(([[, hi]], i) =>
    `<button data-set="debounce" data-val="${i}" aria-pressed="${sel === i}" aria-label="Уровень ${i + 1}, до ${hi} мс"><b>${i + 1}</b>${hi} мс</button>`).join("")}</div>`;
}

// ---------- устройство: схема подключения ----------
export function deviceLink(conn, isOn) {
  const kind = !isOn ? "off" : conn === "2.4g" ? "radio" : "usb";
  const label = { off: "не подключена", radio: "ресивер 2.4G", usb: "кабель USB" }[kind];
  return `<div class="link ${kind}" role="img" aria-label="Компьютер и клавиатура: ${label}">
    <span class="node">${icon("computer")}<small>компьютер</small></span>
    <span class="wire"><i></i><b>${label}</b></span>
    <span class="node">${icon("keys")}<small>Lunacy In Space</small></span>
  </div>`;
}
