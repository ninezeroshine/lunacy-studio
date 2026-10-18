// Черновики интерфейса без браузера и без клавиатуры. Сеть подменена записью вызовов.
// Проверяет: удаление макроса сдвигает номера на клавишах; запись макросов уносит только связанные назначения
// одной операцией; сбой связи не теряет черновик; отмена удаления и «Отменить всё» возвращают и клавиши.
// Запуск: node tests/t8_ui_drafts.mjs
const calls = [];
let offline = false;
globalThis.window = { STUDIO_TOKEN: "test" };
const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
globalThis.fetch = async (path, opt) => {
  calls.push({ path, body: opt?.body ? JSON.parse(opt.body) : null });
  if (offline) return { ok: false, status: 503, headers: { get: () => "application/json" }, json: async () => ({ error: "клавиатура не ответила" }) };
  return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => ({ ok: true, message: "ок" }) };
};

const { store } = await import("../studio/ui/js/core/store.js");
const D = await import("../studio/ui/js/core/drafts.js");

let ok = 0, fail = 0;
const check = (name, cond, extra = "") => { cond ? ok++ : fail++; console.log(`${cond ? "OK  " : "FAIL"} ${name}${cond ? "" : " " + extra}`); };
const macro = (name) => ({ name, actions: [["down", 4], ["delay", 20], ["up", 4]] });
const SAVED_KM = { base: { 10: { type: "macro", index: 0, mode: 1 }, 11: { type: "macro", index: 2, mode: 1 }, 12: { type: "key", hid: 41, mods: 0 } },
  fn: { 20: { type: "macro", index: 1, mode: 4 } } };

function reset() {
  calls.length = 0; mem.clear(); offline = false;
  store.drafts = { keymap: null, macros: null };
  store.server = { profile: { keymap: structuredClone(SAVED_KM), macros: [macro("A"), macro("B"), macro("C")] } };
  D.initDrafts();
}

// 1. Удаление среднего макроса: клавиша с ним — к заводскому, клавиша с последним — на номер меньше
reset();
check("затронуто две клавиши", D.removeMacro(1) === 2);
let km = D.keymapView();
check("макрос B удалён из списка", D.macrosView().map((m) => m.name).join() === "A,C");
check("Fn+20 с удалённым B вернулась к заводскому", !km.fn[20], JSON.stringify(km.fn));
check("клавиша 11 с C теперь указывает на номер 1", km.base[11]?.index === 1);
check("клавиша 10 с A и обычная 12 не тронуты", km.base[10]?.index === 0 && km.base[12]?.hid === 41);

// 2. Запись: одна операция, только связанные клавиши; посторонняя правка остаётся черновиком
D.setKeyAction("base", 13, { type: "key", hid: 5, mods: 0 });
calls.length = 0;
const r = await D.commitMacros();
check("один запрос к сервису", calls.length === 1 && calls[0].path === "/api/macros", JSON.stringify(calls.map((c) => c.path)));
const sent = calls[0].body;
check("ушли два макроса", sent.macros.length === 2);
check("с ними раскладка: 11→1, без Fn+20, 12 на месте", sent.keymap?.base[11]?.index === 1 && !sent.keymap.fn[20] && sent.keymap.base[12]?.hid === 41, JSON.stringify(sent.keymap));
check("посторонняя 13 в запрос не попала", !sent.keymap.base[13]);
check("ответ сервиса передан дальше", r.message === "ок");
check("черновик макросов закрыт", store.drafts.macros === null);
check("посторонняя правка осталась черновиком", D.keymapChanges().length === 1 && D.keymapChanges()[0].key === 13, JSON.stringify(D.keymapChanges()));

// 3. Сбой связи: черновик и записанное не меняются
reset();
D.removeMacro(2);
offline = true;
let err = null;
try { await D.commitMacros(); } catch (e) { err = e; }
check("ошибка дошла до интерфейса", err && /не ответила/.test(err.message), String(err));
check("черновик макросов на месте", store.drafts.macros?.length === 2);
check("записанное не тронуто", store.server.profile.macros.length === 3 && store.server.profile.keymap.base[11]?.index === 2);
D.setKeyAction("base", 14, { type: "key", hid: 6, mods: 0 });
try { await D.commitKeymap(); } catch {}
check("сбой записи раскладки не закрывает её черновик", D.keymapChanges().some((c) => c.key === 14));

// 4. Отмена удаления возвращает и макрос, и номера на клавишах
reset();
D.removeMacro(1);
D.undoMacros();
check("после отмены макросы как были", D.macrosView().length === 3 && store.drafts.macros === null);
check("после отмены клавиши как были", store.drafts.keymap === null, JSON.stringify(store.drafts.keymap));

// 5. «Отменить всё» в макросах откатывает сдвиги, но не чужую правку раскладки
reset();
D.setKeyAction("base", 15, { type: "key", hid: 7, mods: 0 });
D.removeMacro(0);
D.discardMacros();
km = D.keymapView();
check("сдвиг номеров откатан", km.base[10]?.index === 0 && km.base[11]?.index === 2 && km.fn[20]?.index === 1, JSON.stringify(km));
check("своя правка раскладки осталась", km.base[15]?.hid === 7);

// 6. Снимок «Отменить всё» возвращает черновик целиком
reset();
D.removeMacro(1);
const snap = D.snapshot();
D.discardMacros();
D.restore(snap);
check("вернулся черновик макросов", D.macrosView().length === 2);
check("вернулись сдвиги на клавишах", D.keymapView().base[11]?.index === 1);
check("шаг назад после возврата работает", D.canUndo("macros"));

// 8. Раскладка, записанная при незаписанном удалении макроса, не уносит сдвинутые номера
reset();
D.removeMacro(0);                                      // 11: 2→1, 20: 1→0 — пока только в черновике
D.setKeyAction("base", 16, { type: "key", hid: 8, mods: 0 });
calls.length = 0;
const rk = await D.commitKeymap();
const sentKm = calls.find((c) => c.path === "/api/keymap/commit")?.body.keymap;
check("сдвинутые номера не ушли с раскладкой", sentKm && sentKm.base[11]?.index === 2 && sentKm.fn[20]?.index === 1, JSON.stringify(sentKm));
check("своя правка ушла", sentKm?.base[16]?.hid === 8);
check("сообщение объясняет, что назначения ждут", /ждут|ждёт/.test(rk.message), rk.message);
check("сдвиги остались черновиком", D.keymapView().base[11]?.index === 1);

// 9. Отмена удаления возвращает только свои клавиши, чужая правка раскладки остаётся
reset();
D.removeMacro(1);
D.setKeyAction("base", 17, { type: "key", hid: 9, mods: 0 });
D.undoMacros();
km = D.keymapView();
check("номера вернулись", km.base[11]?.index === 2 && km.fn[20]?.index === 1, JSON.stringify(km));
check("чужая правка не пропала", km.base[17]?.hid === 9);

// 10. «Отменить» из уведомления не снимает чужой шаг
reset();
D.removeMacro(2);
const at = D.version();
D.updateMacros((d) => { d[0].name = "A3"; });
check("после другой правки шаг уже не последний", D.undoIfLatest("macros", at) === "stale");
check("ничего не отменено", D.macrosView()[0].name === "A3" && D.macrosView().length === 2);
const at2 = D.version();
check("свой последний шаг снимается", D.undoIfLatest("macros", at2) === "done" && D.macrosView()[0].name === "A");

// 7. Переименование не трогает раскладку
reset();
D.updateMacros((d) => { d[0].name = "A2"; });
calls.length = 0;
await D.commitMacros();
check("переименование уходит без раскладки", calls.length === 1 && !("keymap" in calls[0].body));

console.log(`\nитог: ${ok} ок, ${fail} провалов`);
process.exit(fail ? 1 : 0);
