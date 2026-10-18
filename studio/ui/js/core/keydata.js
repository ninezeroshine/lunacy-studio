// Словарь предметной области: клавиши, коды, подписи действий. Одни и те же слова на всех экранах.
import { store } from "./store.js";

// event.code браузера → HID usage (как в Python studio/keys.py)
export const CODE_HID = (() => {
  const m = {};
  for (let i = 0; i < 26; i++) m["Key" + String.fromCharCode(65 + i)] = 0x04 + i;
  for (let i = 1; i <= 9; i++) m["Digit" + i] = 0x1d + i;
  m.Digit0 = 0x27;
  for (let i = 1; i <= 12; i++) m["F" + i] = 0x39 + i;
  for (let i = 13; i <= 24; i++) m["F" + i] = 0x5b + i; // F13..F24 = 0x68..0x73: недоступны, но узнаём
  for (let i = 1; i <= 9; i++) m["Numpad" + i] = 0x58 + i;
  Object.assign(m, {
    Enter: 0x28, Escape: 0x29, Backspace: 0x2a, Tab: 0x2b, Space: 0x2c, Minus: 0x2d, Equal: 0x2e,
    BracketLeft: 0x2f, BracketRight: 0x30, Backslash: 0x31, Semicolon: 0x33, Quote: 0x34, Backquote: 0x35,
    Comma: 0x36, Period: 0x37, Slash: 0x38, CapsLock: 0x39, PrintScreen: 0x46, ScrollLock: 0x47, Pause: 0x48,
    Insert: 0x49, Home: 0x4a, PageUp: 0x4b, Delete: 0x4c, End: 0x4d, PageDown: 0x4e, ArrowRight: 0x4f,
    ArrowLeft: 0x50, ArrowDown: 0x51, ArrowUp: 0x52, NumLock: 0x53, NumpadDivide: 0x54, NumpadMultiply: 0x55,
    NumpadSubtract: 0x56, NumpadAdd: 0x57, NumpadEnter: 0x58, Numpad0: 0x62, NumpadDecimal: 0x63,
    IntlBackslash: 0x64, ContextMenu: 0x65,
    ControlLeft: 0xe0, ShiftLeft: 0xe1, AltLeft: 0xe2, MetaLeft: 0xe3, ControlRight: 0xe4, ShiftRight: 0xe5,
    AltRight: 0xe6, MetaRight: 0xe7,
  });
  return m;
})();

export const HID_LIMIT = 0x65; // выше клавиатура коды не доносит (проверено: F13 не дошёл)
export const isModifierHid = (h) => h >= 0xe0 && h <= 0xe7;

// Короткие подписи для карты и списков
const SHORT = { "~`": "`", "_-": "−", "+=": "=", "{[": "[", "}}": "]", "|\\": "\\", ":;": ";", "\"'": "'", ",<": ",", ".>": ".",
  "/?": "/", "//": "/", "Delete": "Del", "Caps Lock": "Caps", "Left Shift": "Shift", "Right Shift": "Shift", "Left Ctrl": "Ctrl",
  "Right Ctrl": "Ctrl", "Left Alt": "Alt", "Right Alt": "Alt", "Left Win": "Win", "Backspace": "Backspace", "Num": "Num" };
export const short = (name) => SHORT[name] || (/^[!@#$%^&*()]\d$/.test(name) ? name[1] : name);

// Полные имена для заголовков и озвучки
const FULL = { "~`": "Тильда", "_-": "Минус", "+=": "Равно", "{[": "Скобка [", "}}": "Скобка ]", "|\\": "Обратная черта",
  ":;": "Точка с запятой", "\"'": "Кавычка", ",<": "Запятая", ".>": "Точка", "/?": "Слэш", "//": "Num /", "*": "Num *",
  "-": "Num −", "+": "Num +", ".": "Num .", "Left Shift": "Левый Shift", "Right Shift": "Правый Shift", "Left Ctrl": "Левый Ctrl",
  "Right Ctrl": "Правый Ctrl", "Left Alt": "Левый Alt", "Right Alt": "Правый Alt", "Left Win": "Win", "Space": "Пробел",
  "Num": "Num Lock", "↑": "Стрелка вверх", "↓": "Стрелка вниз", "←": "Стрелка влево", "→": "Стрелка вправо" };
export function fullName(k) {
  if (!k) return "";
  if (/^[0-9]$/.test(k.name) && k.hid >= 0x59) return "Num " + k.name;
  if (k.name === "Enter" && k.hid === 0x58) return "Num Enter";
  return FULL[k.name] || (/^[!@#$%^&*()]\d$/.test(k.name) ? k.name[1] : k.name);
}

const EXTRA_HID_NAMES = { 0x46: "PrtSc", 0x47: "Scroll Lock", 0x48: "Pause", 0x49: "Insert", 0x4b: "Page Up", 0x4d: "End",
  0x4e: "Page Down", 0x64: "\\ (ISO)", 0x65: "Меню", 0xe7: "Правый Win" };
export function hidName(hid) {
  const k = keys().find((x) => x.hid === hid && x.name !== "Fn");
  if (k) return fullName(k);
  if (hid >= 0x68 && hid <= 0x73) return "F" + (hid - 0x5b);
  return EXTRA_HID_NAMES[hid] || "0x" + hid.toString(16).toUpperCase();
}

// Все HID, которые можно назначить, в порядке клавиатуры + доп. клавиши, которых на ней нет
export function assignableHids() {
  const seen = new Set(), out = [];
  for (const k of [...keys()].sort((a, b) => a.y - b.y || a.x - b.x)) {
    if (k.name === "Fn" || seen.has(k.hid)) continue;
    seen.add(k.hid); out.push(k.hid);
  }
  for (const h of [0x46, 0x47, 0x48, 0x49, 0x4b, 0x4d, 0x4e, 0x65, 0xe7]) if (!seen.has(h)) out.push(h);
  return out;
}

export const keys = () => store.server?.keys || [];
export const keyByIndex = (i) => keys().find((k) => k.key_index === +i);
export const keyByHid = (hid) => keys().find((k) => k.hid === hid && k.name !== "Fn");

export const MODS = [
  { bit: 1, name: "Ctrl" }, { bit: 2, name: "Shift" }, { bit: 4, name: "Alt" }, { bit: 8, name: "Win" },
];
export const modsText = (m) => MODS.filter((x) => m & x.bit).map((x) => x.name).join("+");

export const MEDIA = [
  { id: "play_pause", label: "Пуск / пауза", icon: "playpause" }, { id: "next", label: "Следующий трек", icon: "next" },
  { id: "prev", label: "Предыдущий трек", icon: "prev" }, { id: "stop", label: "Стоп", icon: "stop" },
  { id: "vol_up", label: "Громче", icon: "volup" }, { id: "vol_down", label: "Тише", icon: "voldown" },
  { id: "mute", label: "Без звука", icon: "mute" }, { id: "calculator", label: "Калькулятор", icon: "calc" },
  { id: "mail", label: "Почта", icon: "mail" }, { id: "my_computer", label: "Этот компьютер", icon: "computer" },
  { id: "media", label: "Медиаплеер", icon: "media" }, { id: "search", label: "Поиск", icon: "search" },
  { id: "browser_home", label: "Браузер: домой", icon: "home" }, { id: "browser_back", label: "Браузер: назад", icon: "back" },
  { id: "browser_forward", label: "Браузер: вперёд", icon: "forward" }, { id: "browser_refresh", label: "Браузер: обновить", icon: "refresh" },
  { id: "browser_stop", label: "Браузер: стоп", icon: "close" }, { id: "bookmarks", label: "Закладки", icon: "bookmark" },
];
export const MOUSE = [
  { id: "left", label: "Левая кнопка", icon: "mouseL" }, { id: "right", label: "Правая кнопка", icon: "mouseR" },
  { id: "middle", label: "Средняя кнопка", icon: "mouseM" }, { id: "back", label: "Кнопка «назад»", icon: "sideBack" },
  { id: "forward", label: "Кнопка «вперёд»", icon: "sideFwd" }, { id: "wheel_up", label: "Колесо вверх", icon: "wheelUp" },
  { id: "wheel_down", label: "Колесо вниз", icon: "wheelDown" },
];
export const MACRO_MODES = [
  { id: 1, label: "Один раз", sure: true }, { id: 2, label: "N раз", sure: false },
  { id: 3, label: "Вкл / выкл повтор", sure: false }, { id: 4, label: "Пока держишь", sure: false },
];

export function actionText(a, { long = false } = {}) {
  if (!a || a.type === "default") return long ? "Заводское действие" : "";
  if (a.type === "key") return (a.mods ? modsText(a.mods) + "+" : "") + hidName(a.hid);
  if (a.type === "media") return MEDIA.find((m) => m.id === a.name)?.label || a.name;
  if (a.type === "mouse") return MOUSE.find((m) => m.id === a.name)?.label || a.name;
  if (a.type === "macro") {
    const m = store.server?.profile?.macros?.[a.index];
    return (long ? "Макрос «" : "") + (m?.name || `Макрос ${a.index + 1}`) + (long ? "»" : "");
  }
  if (a.type === "disabled") return "Отключена";
  return a.type;
}

// Куда «указывает» действие на карте: другая клавиша (для дуги) или null (для выноски)
export function actionTargetKey(a) {
  if (a?.type !== "key" || a.mods) return null;
  return keyByHid(a.hid) || null;
}

// Эффекты подсветки: номер режима = строка 520+N интерфейса производителя (гипотеза, 11 сверено)
export function effectName(i) {
  return store.server?.profile?.effect_names?.[i] || store.server?.effects?.[i] || `Режим ${i}`;
}

// Символ, который наберёт HID при раскладке US (для предпросмотра макросов)
const US = (() => {
  const m = {};
  "abcdefghijklmnopqrstuvwxyz".split("").forEach((c, i) => { m[0x04 + i] = [c, c.toUpperCase()]; });
  "1234567890".split("").forEach((c, i) => { m[0x1e + i] = [c, "!@#$%^&*()"[i]]; });
  Object.assign(m, { 0x2c: [" ", " "], 0x28: ["⏎", "⏎"], 0x2b: ["⇥", "⇥"], 0x2d: ["-", "_"], 0x2e: ["=", "+"], 0x2f: ["[", "{"],
    0x30: ["]", "}"], 0x31: ["\\", "|"], 0x33: [";", ":"], 0x34: ["'", "\""], 0x35: ["`", "~"], 0x36: [",", "<"], 0x37: [".", ">"], 0x38: ["/", "?"] });
  return m;
})();
const RU = "фисвуапршолдьтщзйкыегмцчня";

// Что наберёт макрос: учитывает Shift; ru=true — как будет в русской раскладке
export function macroPreview(actions, ru = false) {
  let shift = false, out = "";
  for (const [kind, v] of actions) {
    if (v === 0xe1 || v === 0xe5) { shift = kind === "down"; continue; }
    if (kind !== "down") continue;
    if (ru && v >= 0x04 && v <= 0x1d) { const c = RU[v - 0x04]; out += shift ? c.toUpperCase() : c; continue; }
    const pair = US[v];
    out += pair ? pair[shift ? 1 : 0] : `[${hidName(v)}]`;
  }
  return out;
}

export function macroDuration(actions) {
  return actions.reduce((s, [k, v]) => s + (k === "delay" ? Math.max(10, +v) : 0), 0);
}
export const macroBytes = (macros) => 400 + macros.reduce((s, m) => s + (m.actions.length ? 8 + 4 * m.actions.length : 0), 0); // как macros_bytes в actions.py
// Память макросов 0xE00 байт режется блоками по 64 с маркером в конце (Keyboard.macro_buffer):
// данные до 3 520 байт включительно помещаются, дальше — нет. Сервер проверяет то же самое перед записью.
export const MACRO_LIMIT = 3520;
