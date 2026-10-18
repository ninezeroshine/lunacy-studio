// Черновики раскладки и макросов: живут в браузере, в клавиатуру уходят по «Записать».
// Отмена черновика ничего не трогает в клавиатуре; черновик переживает перезагрузку страницы.
// Запись — одна операция сервиса: сначала клавиатура, потом профиль. Сбой связи оставляет черновик на месте.
import { store, emit, local, clone, same } from "./store.js";
import { post } from "./api.js";

// undo.keymap — снимки раскладки; undo.macros — {macros, keymap?}: keymap есть у шагов, которые заодно
// сдвинули номера макросов на клавишах (удаление макроса), такой шаг отменяется целиком.
const undo = { keymap: [], macros: [] };
// Номер правки: растёт при каждом изменении черновиков. По нему «Отменить» в уведомлении понимает,
// что его шаг всё ещё последний, и не снимает чужой.
let ver = 0;
export const version = () => ver;

export function initDrafts() {
  store.drafts.keymap = local.get("draft.keymap");
  store.drafts.macros = local.get("draft.macros");
  // черновик, совпавший с записанным, — не черновик
  if (store.drafts.keymap && same(store.drafts.keymap, store.server.profile.keymap)) setKeymapDraft(null, false);
  if (store.drafts.macros && same(store.drafts.macros, store.server.profile.macros)) setMacrosDraft(null, false);
}

const withChanges = (base, changes) => {
  const k = clone(base);
  for (const c of changes) { if (!c.action || c.action.type === "default") delete k[c.layer][c.key]; else k[c.layer][c.key] = c.action; }
  return k;
};
const keyId = (layer, key) => `${layer}:${key}`;

// ---------- раскладка ----------
export const keymapView = () => store.drafts.keymap || store.server.profile.keymap;

function setKeymapDraft(d, pushUndo = true) {
  ver++;
  if (pushUndo) undo.keymap.push(clone(keymapView()));
  if (undo.keymap.length > 100) undo.keymap.shift();
  store.drafts.keymap = d && !same(d, store.server.profile.keymap) ? d : null;
  if (!store.drafts.keymap) undo.keymap.length = 0;
  local.set("draft.keymap", store.drafts.keymap);
  emit("draft", "keymap");
}

export function setKeyAction(layer, keyIndex, action) {
  setKeymapDraft(withChanges(keymapView(), [{ layer, key: keyIndex, action }]));
}
export function applyRecipe(changes) { setKeymapDraft(withChanges(keymapView(), changes)); } // [{layer, key, action}]

export function keymapChanges() {
  const a = store.server.profile.keymap, b = keymapView(), out = [];
  for (const layer of ["base", "fn"]) {
    const ids = new Set([...Object.keys(a[layer] || {}), ...Object.keys(b[layer] || {})]);
    for (const id of ids) if (!same(a[layer]?.[id], b[layer]?.[id])) out.push({ layer, key: +id, action: b[layer]?.[id] || { type: "default" } });
  }
  return out;
}

export function undoKeymap() {
  if (!undo.keymap.length) return false;
  ver++;
  const prev = undo.keymap.pop();
  store.drafts.keymap = same(prev, store.server.profile.keymap) ? null : prev;
  local.set("draft.keymap", store.drafts.keymap);
  emit("draft", "keymap");
  return true;
}
// Клавиши, чьи номера макросов сдвинуты незаписанным удалением, остаются как есть: иначе разойдутся с черновиком макросов.
export function discardKeymap() {
  const linked = linkedKeys();
  if (!linked.size) return setKeymapDraft(null, false);
  const cur = keymapView();
  setKeymapDraft(withChanges(store.server.profile.keymap, [...linked].map((id) => {
    const [layer, key] = id.split(":"); return { layer, key, action: cur[layer]?.[key] };
  })), false);
}

// only — записать лишь часть черновика (остальное останется черновиком)
export async function commitKeymap(only) {
  const linked = store.drafts.macros ? linkedKeys() : new Set();
  const all = keymapChanges().filter(typeof only === "function" ? only : () => true);
  const changes = all.filter((c) => !linked.has(keyId(c.layer, c.key)));
  if (!changes.length) {
    return { message: all.length ? "Назначения макросов запишутся вместе с макросами — в разделе «Макросы»" : "Изменений нет" };
  }
  const target = withChanges(store.server.profile.keymap, changes);
  await post("/api/keymap/commit", { keymap: target });
  const rest = store.drafts.keymap;
  store.server.profile.keymap = target;
  setKeymapDraft(rest ? clone(rest) : null, false);
  const held = all.length - changes.length;
  return { message: `Раскладка записана: ${changes.length} ${plural(changes.length, "изменение", "изменения", "изменений")}`
    + (held ? ` · ${held} ${plural(held, "назначение макроса ждёт", "назначения макросов ждут", "назначений макросов ждут")} записи макросов` : "") };
}

// ---------- макросы ----------
export const macrosView = () => store.drafts.macros || store.server.profile.macros;
const linkedKeys = () => new Set(local.get("draft.macroKeys", []));

function setMacrosDraft(d, pushUndo = true, keysBefore) {
  ver++;
  if (pushUndo) undo.macros.push({ macros: clone(macrosView()), keys: keysBefore });
  if (undo.macros.length > 100) undo.macros.shift();
  store.drafts.macros = d && !same(d, store.server.profile.macros) ? d : null;
  if (!store.drafts.macros) { undo.macros.length = 0; local.set("draft.macroKeys", null); }
  local.set("draft.macros", store.drafts.macros);
  emit("draft", "macros");
}
export function updateMacros(fn) { const d = clone(macrosView()); fn(d); setMacrosDraft(d); }
export function undoMacros() {
  if (!undo.macros.length) return false;
  const prev = undo.macros.pop();
  ver++;
  if (prev.keys) { // шаг удаления: возвращаем прежние номера только тех клавиш, что он сдвинул; чужие правки не трогаем
    const next = withChanges(keymapView(), prev.keys);
    store.drafts.keymap = same(next, store.server.profile.keymap) ? null : next;
    local.set("draft.keymap", store.drafts.keymap);
  }
  store.drafts.macros = same(prev.macros, store.server.profile.macros) ? null : prev.macros;
  if (!store.drafts.macros) { undo.macros.length = 0; local.set("draft.macroKeys", null); }
  local.set("draft.macros", store.drafts.macros);
  emit("draft", "macros");
  return true;
}
// Отменить черновик макросов. Сдвиги номеров на клавишах, сделанные удалением, откатываются вместе с ним.
export function discardMacros() {
  const linked = linkedKeys();
  if (linked.size) {
    const saved = store.server.profile.keymap;
    const back = [...linked].map((id) => { const [layer, key] = id.split(":"); return { layer, key, action: saved[layer]?.[key] }; });
    local.set("draft.macroKeys", null);
    setKeymapDraft(withChanges(keymapView(), back), false);
  }
  setMacrosDraft(null, false);
}

// Удалить макрос i. Номера следующих сдвигаются на один, поэтому назначения на клавишах сдвигаем вместе с ними,
// а клавиши с самим удалённым макросом возвращаем к заводскому действию. Возвращает число затронутых клавиш.
export function removeMacro(i) {
  const km = keymapView(), changes = [];
  for (const layer of ["base", "fn"]) for (const [idx, a] of Object.entries(km[layer] || {})) {
    if (a?.type !== "macro") continue;
    if (a.index === i) changes.push({ layer, key: +idx, action: { type: "default" } });
    else if (a.index > i) changes.push({ layer, key: +idx, action: { ...a, index: a.index - 1 } });
  }
  // _o — номер макроса в клавиатуре до правки: по нему при записи сдвигаются номера в сочетаниях клавиш
  const d = clone(macrosView()), fresh = !d.some((m) => "_o" in m);
  d.forEach((m, j) => { if (fresh) m._o = j < store.server.profile.macros.length ? j : null; });
  d.splice(i, 1);
  if (changes.length) {
    const before = changes.map((c) => ({ layer: c.layer, key: c.key, action: km[c.layer]?.[c.key] }));
    local.set("draft.macroKeys", [...new Set([...linkedKeys(), ...changes.map((c) => keyId(c.layer, c.key))])]);
    // раскладку меняем без своего шага отмены: она часть шага макросов
    const next = withChanges(km, changes);
    store.drafts.keymap = same(next, store.server.profile.keymap) ? null : next;
    local.set("draft.keymap", store.drafts.keymap);
    setMacrosDraft(d, true, before);
    emit("draft", "keymap");
  } else setMacrosDraft(d);
  return changes.length;
}

export function macrosChangeCount() {
  const a = store.server.profile.macros, b = macrosView();
  let n = Math.abs(a.length - b.length);
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (!same(a[i], b[i])) n++;
  return n;
}

// Макросы и связанные с ними назначения клавиш — одной операцией сервиса, иначе клавиши проиграют чужой макрос.
export async function commitMacros() {
  const list = macrosView(), saved = store.server.profile.keymap;
  const related = (c) => c.action.type === "macro" || saved[c.layer]?.[c.key]?.type === "macro";
  const rel = keymapChanges().filter(related);
  const target = rel.length ? withChanges(saved, rel) : null;
  const clean = list.map(({ _o, ...m }) => m);
  // сочетания (Studio) указывают на номер макроса: после удаления сдвигаем, на удалённый — снимаем
  let trig = null;
  if (list.some((m) => "_o" in m)) {
    const pos = new Map(list.map((m, j) => [m._o, j]));
    trig = (store.server.profile.triggers || []).filter((x) => pos.has(x.macro)).map((x) => ({ ...x, macro: pos.get(x.macro) }));
  }
  const r = await post("/api/macros", { macros: clean, ...(target ? { keymap: target } : {}), ...(trig ? { triggers: trig } : {}) });
  store.server.profile.macros = clone(clean);
  if (trig) store.server.profile.triggers = trig;
  if (target) {
    const rest = store.drafts.keymap;
    store.server.profile.keymap = target;
    local.set("draft.macroKeys", null);
    setKeymapDraft(rest ? clone(rest) : null, false);
  }
  setMacrosDraft(null, false);
  return r;
}

// ---------- для полосы черновика ----------
// «Отменить» из уведомления: снимает шаг, только если после него ничего не меняли.
// "done" — снят, "stale" — после него были другие правки, "gone" — шагов уже нет (например, записали в клавиатуру).
export function undoIfLatest(kind, at) {
  if (ver !== at) return "stale";
  return (kind === "keymap" ? undoKeymap() : undoMacros()) ? "done" : "gone";
}
export const canUndo = (kind) => (kind === "keymap" ? undo.keymap.length : undo.macros.length) > 0;
// Снимок перед «Отменить всё», чтобы тост мог вернуть черновик целиком.
export function snapshot() {
  return { keymap: clone(store.drafts.keymap), macros: clone(store.drafts.macros), macroKeys: local.get("draft.macroKeys"),
    undo: { keymap: clone(undo.keymap), macros: clone(undo.macros) } };
}
export function restore(s) {
  ver++;
  store.drafts.keymap = s.keymap; store.drafts.macros = s.macros;
  undo.keymap = s.undo.keymap; undo.macros = s.undo.macros;
  local.set("draft.keymap", s.keymap); local.set("draft.macros", s.macros); local.set("draft.macroKeys", s.macroKeys);
  emit("draft", "keymap"); emit("draft", "macros");
}

const plural = (n, one, few, many) => { const a = n % 100, b = a % 10; return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many; };
