// Состояние интерфейса: данные сервиса, живой статус и черновики. Подписка по темам.
const topics = new Map();

export const store = {
  server: null,      // GET /api/state
  status: null,      // GET /api/status (раз в секунду)
  online: true,      // сервис отвечает
  drafts: { keymap: null, macros: null },
};

export function on(topic, fn) {
  if (!topics.has(topic)) topics.set(topic, new Set());
  topics.get(topic).add(fn);
  return () => topics.get(topic).delete(fn);
}

export function emit(topic, payload) {
  for (const fn of topics.get(topic) || []) {
    try { fn(payload); } catch (e) { console.error(topic, e); }
  }
}

// Небольшое хранилище в браузере для удобств (черновики, последняя вкладка). Ошибки доступа не мешают работе.
export const local = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem("ls." + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { value === null ? localStorage.removeItem("ls." + key) : localStorage.setItem("ls." + key, JSON.stringify(value)); } catch {}
  },
};

export const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Почему писать в клавиатуру сейчас нельзя: [что, что делать] или null.
// Нет связи — или клавиатура занята фоновой задачей (заливка экрана, профиль, сброс) и ответит только после неё.
export function blockReason() {
  const st = store.status || store.server;
  if (!st?.connected) return ["Клавиатура не подключена", "Подключи кабель — изменения подождут"];
  if (st.job?.status === "running") return [`Идёт: ${st.job.name}`, "Клавиатура занята, пока задача не закончится"];
  return null;
}
