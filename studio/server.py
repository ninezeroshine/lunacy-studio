"""HTTP API и раздача интерфейса. Только 127.0.0.1. Изменяющие запросы требуют X-Studio-Token (иначе любой
сайт в браузере мог бы записать макрос в клавиатуру); Host проверяется против DNS-rebinding."""
import json, os, re, secrets, threading, time, tempfile, logging, sys, winreg, datetime
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, unquote, parse_qs, quote
from . import keys as K
from . import actions as A
from . import combos as C
from . import library as LB
from .updater import Updater
from .version import VERSION
from . import profiles as P
from . import slots as S
from . import claude_hooks as CH
from . import graphics as G
from .device import Offline, Busy
from lunacy import Refused
from .live import LOAD_COLS
from . import winapi

log = logging.getLogger("server")
HERE = os.path.dirname(os.path.abspath(__file__))
UI = os.path.join(HERE, "ui")
BACKGROUNDS = os.path.join(UI, "assets", "backgrounds")
LIGHT_INDICES = {k.light_index for k in K.KEYS}
KEY_INDICES = {k.key_index for k in K.KEYS}
PORT = int(os.environ.get("LUNACY_STUDIO_PORT", "47800"))   # другой порт — для проверок установленной копии рядом с рабочей
TOKEN = secrets.token_urlsafe(24)
INSTANCE = secrets.token_hex(4)   # меняется при каждом запуске: страница узнаёт, что сервис перезапустился
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"

# Режим N = строка 520+N интерфейса (гипотеза; 11 = «Горизонтальная радуга» совпало на железе)
EFFECTS = ["Выключить", "Статичный", "Загорается при нажатии", "Затухает при нажатии", "Звёзды", "Дождь",
           "Разноцветный", "Дыхание", "Цикл", "Рябь", "Вертикальная радуга", "Горизонтальная радуга",
           "Вращающаяся радуга", "Взрывы", "Горизонтальные разряды", "Рябь 2", "Поток", "Волна",
           "Наклонённая волна", "Курсирующий"]


class Job:
    def __init__(self):
        self.lock = threading.Lock()
        self.state = {"name": None, "progress": 0, "total": 0, "status": "idle", "message": ""}

    def start(self, name, fn, kind=None):
        """kind — для интерфейса: какой раздел показывает прогресс сам (slot — заливка слота, gfx — графика экрана)."""
        with self.lock:
            if self.state["status"] == "running":
                raise RuntimeError(f"уже идёт: {self.state['name']}")
            self.state = {"name": name, "kind": kind, "progress": 0, "total": 0, "status": "running", "message": "",
                          "step": None, "started": time.time()}

        def run():
            try:
                msg = fn(self)
                self.state.update(status="done", message=msg or "готово")
            except Exception as e:
                log.exception("задача %s", name)
                self.state.update(status="error", message=str(e))
        threading.Thread(target=run, daemon=True).start()


class App:
    def __init__(self, store, dm, engine, watcher, on_quit):
        self.store, self.dm, self.engine, self.watcher, self.on_quit = store, dm, engine, watcher, on_quit
        self.updater = Updater(store, on_quit)
        self.job = Job()
        self.autostart_cmd = f'"{os.path.join(os.path.dirname(sys.executable), "pythonw.exe")}" -I "{os.path.join(HERE, "main.py")}" --no-browser'

    # ---- состояние ----
    def state(self):
        p = self.store.data
        return {
            "connected": self.dm.connected, "wireless": bool(self.dm.kb and self.dm.kb.wireless),
            "busy": self.dm.busy, "error": self.dm.last_error, "store_error": self.store.error, "instance": INSTANCE,
            "unsynced": self.store.data.get("unsynced"),
            "keys": [k.as_dict() for k in K.KEYS],
            "profile": {k: p[k] for k in ("keymap", "macros", "triggers", "lighting", "screen", "settings", "smart", "effect_names")},
            "experimental": self.experimental_on(),
            "version": VERSION,
            "effects": EFFECTS, "media": list(A.MEDIA), "mouse": list(A.MOUSE),
            "hotkeys": {"categories": self.engine.hotkeys.categories, "name_hid": K.NAME_TO_HID,
                        "apps": {n: {"label": a["label"], "combos": {c: v for c, v in a["keys"].items()}}
                                 for n, a in self.engine.hotkeys.apps.items()}},
            "live": self.engine.status(), "job": self.job.state,
            "heatmap": p["heatmap"], "heatmap_since": p["heatmap_since"], "autostart": self.autostart_enabled(), "updates": p.get("updates") or {"auto": True},
            "device": self.device(), "profiles": P.listing(), "active_profile": p["active_profile"],
            "slots": S.all_slots(), "graphics": G.status(), "timer": self.engine.timer_status(), "claude_hooks": CH.status(),
            "screen_live": self.engine.screen.status(),
            # столбики режима «Нагрузка» снизу вверх, как их рисует live.py: превью берёт их отсюда, а не копией
            "load_cols": [[k.light_index for k in col] for col in LOAD_COLS],
        }

    def vendor(self):
        """Запущена ли фирменная программа: проверяем не чаще раза в 3 с (перебор процессов)."""
        now = time.monotonic()
        if now - getattr(self, "_vendor_at", 0) > 3:
            try:
                self._vendor = os.path.basename(winapi.vendor_app())
            except Exception:
                self._vendor = ""
            self._vendor_at = now
        return self._vendor or None

    def status(self):
        return {"connected": self.dm.connected, "vendor_app": self.vendor(), "wireless": bool(self.dm.kb and self.dm.kb.wireless),
                "busy": self.dm.busy, "error": self.dm.last_error, "live": self.engine.status(),
                "job": self.job.state, "heatmap": self.store.data["heatmap"], "timer": self.engine.timer_status(),
                "instance": INSTANCE, "unsynced": self.store.data.get("unsynced"), "screen_live": self.engine.screen.status(),
                "activity": self.engine.watcher.activity(),
                "update": {k: self.updater.state[k] for k in ("available", "latest", "status", "progress", "total", "error")}}

    # ---- экспериментальные функции: пишут графику во внешнюю флеш, заводскую потом вернуть нечем ----
    def experimental_on(self):
        v = self.store.get("experimental")
        if v is None:                       # не решали: включено только у тех, кто уже заливал свою графику
            return G.last_run() is not None
        return bool(v)

    def _need_experimental(self, what):
        if not self.experimental_on():
            raise ValueError(f"{what} — экспериментальная функция, она выключена. Включается в «Настройках» → «Программа»")

    # ---- обновления (updater.py) ----
    def update(self, q=None):
        return self.updater.status()

    def update_check(self, b):
        return self.updater.check()

    def update_install(self, b):
        busy = self.job.state.get("name") if self.job.state.get("status") == "running" else self.dm.busy
        return self.updater.install(busy=busy)

    def update_settings(self, b):
        self.updater.set_auto(b.get("auto", True))
        return self.updater.status()

    def experimental(self, b):
        self.store.set(bool(b.get("on")), "experimental")
        return {"ok": True, "experimental": self.experimental_on()}

    def device(self, q=None):
        info = self.dm.info
        out = {"model": "Lunacy In Space", "manufacturer": None, "product": None, "firmware": None,
               "vid": None, "pid": None, "connection": None}
        if info and self.dm.connected:
            out.update(info)
        out["connected"] = self.dm.connected
        return out

    # ---- раскладка ----
    def keymap_commit(self, b):
        """Раскладка целиком: сначала в клавиатуру, потом в профиль. Сбой связи оставляет профиль прежним,
        и черновик в интерфейсе не потеряется (раньше профиль сохранялся до записи в устройство)."""
        km = self._check_keymap(b["keymap"], len(self.store.get("macros")))
        self.dm.run(self._guarded("раскладка", lambda kb: self._write_keymap(kb, km)), "запись раскладки")
        self.store.set(km, "keymap")
        self._diverged()
        return {"ok": True, "message": "Раскладка записана в клавиатуру"}

    @staticmethod
    def _check_keymap(km, n_macros):
        """Граница доверия: номера клавиш — только существующие, действия кодируются, макрос — из списка."""
        if not isinstance(km, dict):
            raise ValueError("раскладка: нужен объект с base и fn")
        out = {}
        for layer in ("base", "fn"):
            src = km.get(layer) or {}
            if not isinstance(src, dict):
                raise ValueError(f"раскладка {layer}: нужен объект")
            out[layer] = {}
            for idx, action in src.items():
                i = P._int(idx, 0, 143, "номер клавиши")
                if i not in KEY_INDICES:
                    raise ValueError(f"клавиши с номером {i} нет")
                if not isinstance(action, dict):
                    raise ValueError(f"клавиша {i}: действие должно быть объектом")
                if action.get("type", "default") == "default":
                    continue
                if action.get("type") == "macro" and not 0 <= int(action.get("index", -1)) < n_macros:
                    raise ValueError(f"клавиша {i}: макроса №{int(action.get('index', -1)) + 1} нет")
                A.encode(action)                                  # валидация до записи
                out[layer][str(i)] = action
        return out

    def _guarded(self, what, fn):
        """Многошаговая запись: если связь оборвётся посередине, клавиатура останется в промежуточном состоянии.
        Метка ставится, когда запись в клавиатуру действительно началась, и снимается после успеха —
        интерфейс показывает баннер. Нет клавиатуры или она занята — метки нет: ничего не записано."""
        def go(kb):
            kb.wrote = False
            self.store.set(what, "unsynced")
            try:
                r = fn(kb)
            except Exception:
                if not kb.wrote:              # отказ до первых данных: ничего не записано, баннер не нужен
                    self.store.set(None, "unsynced")
                raise
            self.store.set(None, "unsynced")
            return r
        return go

    def _diverged(self):
        """Клавиатура разошлась с применённым профилем — имя профиля в шапке больше не правда."""
        if self.store.data.get("active_profile"):
            self.store.set(None, "active_profile")

    @staticmethod
    def _write_keymap(kb, km):
        kb.write_keymap(A.keymap_entries(km["base"]))
        kb.write_keymap(A.keymap_entries(km["fn"]), fn_layer=True)

    # ---- макросы ----
    def macros_set(self, b):
        """Макросы и, если передана, раскладка (удаление макроса сдвигает номера на клавишах) — одной операцией:
        сначала клавиатура, потом профиль."""
        macros = b["macros"]
        A.check_macros(macros)
        km = self._check_keymap(b["keymap"], len(macros)) if b.get("keymap") is not None else None
        # сочетания ссылаются на номер макроса: удаление сдвигает номера, интерфейс присылает сдвинутые
        trig = C.check(b["triggers"], len(macros)) if b.get("triggers") is not None else None

        def go(kb):
            kb.write_macros(A.macros_for_device(macros))
            if km is not None:
                self._write_keymap(kb, km)
        self.dm.run(self._guarded("макросы и назначения" if km is not None else "макросы", go), "запись макросов")
        self.store.set(macros, "macros")
        if km is not None:
            self.store.set(km, "keymap")
        if trig is not None:
            self.store.set(trig, "triggers")
        self.engine.combos.reload()
        self._diverged()
        return {"ok": True, "message": f"Макросов в клавиатуре: {len(macros)}" + (" · назначения на клавишах обновлены" if km is not None else "")}

    def macro_triggers(self, b):
        """Макрос на сочетание клавиш: живёт в Studio, в клавиатуру не пишется — сохраняем и сразу включаем."""
        trig = C.check(b["triggers"], len(self.store.get("macros")))
        self.store.set(trig, "triggers")
        self.engine.combos.reload()
        return {"ok": True, "triggers": trig}

    def macro_from_text(self, b):
        return {"actions": A.text_to_actions(b["text"], int(b.get("delay", 12)))}

    # ---- подсветка ----
    def effect(self, b):
        l = self.store.get("lighting")
        for k in ("mode", "rgb", "colorful", "brightness", "speed", "direction"):
            if k in b:
                l[k] = b[k]
        l["kind"] = "effect"
        l = P.validate({"lighting": l})["lighting"]          # режим 0–19, яркость и скорость 0–5, rgb 0–255
        self.dm.run(lambda kb: kb.light_mode(int(l["mode"]), tuple(l["rgb"]), int(l["colorful"]),
                                             int(l["brightness"]), int(l["speed"]), int(l["direction"])), "подсветка")
        self.store.set(l, "lighting")
        self._diverged()
        return {"ok": True}

    @staticmethod
    def _colors(raw):
        """{light_index: [r, g, b]} → проверенный словарь: только существующие клавиши, три числа 0–255."""
        if not isinstance(raw, dict):
            raise ValueError("цвета: нужен объект {номер клавиши: [r, g, b]}")
        out = {}
        for k, v in raw.items():
            i = P._int(k, 0, 143, "номер клавиши подсветки")
            if i not in LIGHT_INDICES:
                raise ValueError(f"клавиши подсветки с номером {i} нет")
            if not isinstance(v, (list, tuple)) or len(v) != 3:
                raise ValueError(f"клавиша {i}: цвет — три числа")
            out[i] = tuple(P._int(c, 0, 255, "цвет") for c in v)
        return out

    def user_colors(self, b):
        colors = self._colors(b["colors"])
        bright = P._int(b.get("brightness", 5), 0, 5, "яркость")
        def go(kb):
            kb.user_light_mode(brightness=bright)
            kb.write_user_light(colors, save=True)
        self.dm.run(go, "свои цвета")
        l = self.store.get("lighting"); l.update(kind="user", user_colors={str(k): list(v) for k, v in colors.items()}, user_brightness=bright)
        self.store.set(l, "lighting")
        self._diverged()
        return {"ok": True, "message": "Свои цвета сохранены в клавиатуре"}

    def preview(self, b):
        colors = self._colors(b["colors"])
        seconds = float(b.get("seconds", 3))
        if not 0.1 <= seconds <= 10:
            raise ValueError("показ — от 0.1 до 10 секунд")       # иначе превью навсегда перекрыло бы все сигналы
        self.engine.show_preview({k.light_index: colors.get(k.light_index, (0, 0, 0)) for k in K.KEYS}, seconds)
        return {"ok": True}

    def live_flash(self, b):
        lit = [int(i) for i in b["keys"]]
        bad = [i for i in lit if i not in LIGHT_INDICES]
        if bad or not lit:
            raise ValueError(f"нет клавиш с номерами подсветки {bad}" if bad else "не выбрано ни одной клавиши")
        rgb = tuple(int(c) for c in b["rgb"])
        if len(rgb) != 3 or not all(0 <= c <= 255 for c in rgb):
            raise ValueError("rgb — три числа 0–255")
        seconds = float(b.get("seconds", 0.9))
        if not 0.1 <= seconds <= 10:
            raise ValueError("seconds — от 0.1 до 10")
        frame = {k.light_index: (6, 6, 10) for k in K.KEYS}
        frame.update({i: rgb for i in lit})
        self.engine.show_preview(frame, seconds, "вспышка")
        return {"ok": True}

    def timer(self, b):
        if b.get("cancel"):
            self.engine.timer_cancel()
        else:
            m = int(b["minutes"])
            if not 1 <= m <= 180:
                raise ValueError("таймер — от 1 до 180 минут")
            self.engine.timer_start(m)
        return {"ok": True, "timer": self.engine.timer_status()}

    def live_frame(self, q=None):
        return {"overlay": self.engine.overlay, "frame": self.engine.frame_now()}

    def stats(self, q=None):
        out = self.engine.stats.get()
        if q and q.get("history"):
            out["history"] = self.engine.stats.series()
        return out

    def effect_name(self, b):
        P._int(b.get("mode"), 0, len(EFFECTS) - 1, "режим")
        if b.get("name") is not None and not isinstance(b["name"], str):
            raise ValueError("название — строка")
        with self.store.lock:
            names = self.store.data["effect_names"]
            if b.get("name"):
                names[str(int(b["mode"]))] = b["name"][:40]
            else:
                names.pop(str(int(b["mode"])), None)
            self.store.save()
        return {"ok": True}

    # ---- экран ----
    def _upload(self, slot, name, source, load_frames, raw=False, lib=None):
        """Общий конвейер заливки: кадры → подготовка → 04 72 → показ как в screen_display → миниатюра слота.
        load_frames() -> [(bgra, delay_ms)] выполняется уже в фоновой задаче; raw=True — кадры уже RGB565
        (их собрал редактор в браузере), тогда [(rgb565, delay_ms)]."""
        display = self.store.get("screen")["display"]
        if self.dm.connected and self.dm.kb and self.dm.kb.wireless:
            raise ValueError("экран заливается только по кабелю: через ресивер 2.4G и Bluetooth интерфейса экрана нет. Подключи кабель (ползунок в центр)")

        def work(job):
            from lunacy import images
            frames = load_frames()
            if not frames:
                raise ValueError("в файле нет кадров")
            dropped = max(0, getattr(frames, "total", len(frames)) - 69)
            frames = frames[:69]
            data = [b for b, _ in frames] if raw else [images.rgb565(b) for b, _ in frames]
            delays = [d for _, d in frames]
            job.state["total"] = -(-(256 + len(data) * 64800) // 4096)

            def go(kb):
                kb.screen_prepare(slot)
                r = kb.upload(slot, data, delays, progress=lambda i, n: job.state.update(progress=i, total=n))
                bad = sum(1 for a in r["chunk_acks"] if not a or a[1] != 1)
                if bad:
                    raise RuntimeError(f"клавиатура не подтвердила {bad} блоков из {r['chunks']}; залейте ещё раз")
                if display == "gif":
                    kb.select_slot(slot)
                else:
                    kb.set_time(slot=slot)
                return r
            r = self.dm.run(go, f"заливка экрана, слот {slot}", wait=None)
            s = self.store.get("screen"); s["slot"] = slot; s[f"slot{slot}_name"] = name
            self.store.set(s, "screen")
            try:
                S.save(slot, images.bgra_from_rgb565(data[0]) if raw else frames[0][0], name, len(data), source, lib)
            except Exception:
                log.exception("миниатюра слота %s", slot)      # заливка прошла; без миниатюры переживём
            n = len(data)
            word = "кадр" if n % 10 == 1 and n % 100 != 11 else "кадра" if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14 else "кадров"
            msg = f"{name}: {n} {word} в слот {slot} за {r['seconds']:.0f} с"
            return msg + (f"; {dropped} лишних кадров отброшено (максимум 69)" if dropped else "")
        self.job.start(f"Заливка «{name}» в слот {slot}", work, "slot")
        return {"ok": True}

    def screen_upload_frames(self, body, headers):
        """Готовые кадры из редактора экрана: тело — N кадров 240×135 RGB565 LE подряд, X-Delays — N задержек в мс.
        Заодно кадры ложатся в библиотеку Studio: вернуться к ним можно без повторной правки."""
        slot = P._int(headers.get("X-Slot", "2"), 1, 2, "слот")
        name, source, delays = self._frames_in(body, headers)
        lib, note = None, None
        try:
            lib = LB.save(name, source, body, delays)[0]["id"]
        except ValueError as e:                                       # библиотека заполнена — скажем, но зальём
            note = f"в «Мои видео» не сохранено: {e}"
        except Exception:
            log.exception("библиотека: сохранение при заливке")     # заливку это не останавливает
            note = "в «Мои видео» не сохранено — подробности в журнале"
        n = len(delays)
        frames = [(body[i * FRAME_BYTES:(i + 1) * FRAME_BYTES], delays[i]) for i in range(n)]
        r = self._upload(slot, name, f"editor:{source}", lambda: frames, raw=True, lib=lib)
        return {**r, "note": note} if note else r

    def _frames_in(self, body, headers):
        """Граница доверия для кадров из браузера: число кадров, размер тела и задержки проверяем здесь."""
        name = os.path.basename(unquote(headers.get("X-Filename", "кадры")))[-60:] or "кадры"
        source = headers.get("X-Source", "editor")
        if source not in ("file", "bg", "card", "pattern", "paint", "library", "editor"):
            raise ValueError("источник: file, bg, card, pattern, paint, library или editor")
        if not body or len(body) % FRAME_BYTES:
            raise ValueError(f"тело должно состоять из целых кадров по {FRAME_BYTES} байт")
        n = len(body) // FRAME_BYTES
        if not 1 <= n <= 69:
            raise ValueError(f"кадров {n}: клавиатура хранит от 1 до 69")
        try:
            delays = [int(x) for x in headers.get("X-Delays", "").split(",") if x.strip()]
        except ValueError:
            raise ValueError("X-Delays: задержки кадров — целые числа в мс через запятую")
        if len(delays) != n or not all(2 <= d <= 510 for d in delays):
            raise ValueError(f"задержки кадров: нужно {n} шт., каждая от 2 до 510 мс (прошивка хранит задержку как байт × 2 мс)")
        return name, source, delays

    # ---- библиотека экрана (library.py) ----
    def library(self, q=None):
        return {"items": LB.listing(), "limit": LB.LIMIT}

    def library_save(self, body, headers):
        name, source, delays = self._frames_in(body, headers)
        meta, new = LB.save(name, source, body, delays)
        return {"ok": True, "item": meta, "new": new,
                "message": f"«{meta['name']}» в библиотеке" if new else f"Это видео уже есть в библиотеке: «{meta['name']}»"}

    def library_upload(self, b):
        slot = P._int(b.get("slot", 2), 1, 2, "слот")
        meta, body = LB.load(b.get("id"))
        n = meta["frames"]
        frames = [(body[i * FRAME_BYTES:(i + 1) * FRAME_BYTES], meta["delays"][i]) for i in range(n)]
        return self._upload(slot, meta["name"], "library", lambda: frames, raw=True, lib=meta["id"])

    def library_rename(self, b):
        name = str(b.get("name") or "").strip()
        if not name:
            raise ValueError("название не может быть пустым")
        return {"ok": True, "item": LB.rename(b.get("id"), name)}

    def library_delete(self, b):
        LB.delete(b.get("id"))
        return {"ok": True}

    def screen_upload(self, body, headers):
        slot = P._int(headers.get("X-Slot", "2"), 1, 2, "слот")
        fit = headers.get("X-Fit", "cover")
        if fit not in ("cover", "contain", "stretch"):
            raise ValueError("вписывание: cover, contain или stretch")
        name = os.path.basename(unquote(headers.get("X-Filename", "image")))[-60:]
        if len(body) > 30 * 1024 * 1024:
            raise ValueError("файл больше 30 МБ")
        fd, tmp = tempfile.mkstemp(suffix=os.path.splitext(name)[1] or ".img")
        os.write(fd, body); os.close(fd)

        def load_frames():
            from lunacy import images
            try:
                return images.load(tmp, fit=fit, max_frames=69)
            finally:
                os.remove(tmp)
        try:
            return self._upload(slot, name, "file", load_frames)
        except Exception:
            os.remove(tmp)                    # задача не стартовала («уже идёт») — временный файл не оставляем
            raise

    @staticmethod
    def backgrounds(q=None):
        try:
            with open(os.path.join(BACKGROUNDS, "manifest.json"), encoding="utf-8") as f:
                items = json.load(f)
        except (OSError, ValueError):
            return []
        out = []
        for it in items if isinstance(items, list) else []:
            if not isinstance(it, dict) or not all(isinstance(it.get(k), str) for k in ("id", "label", "file")):
                continue
            f = os.path.basename(it["file"])
            if os.path.isfile(os.path.join(BACKGROUNDS, f)):
                out.append({"id": it["id"], "label": it["label"], "file": f,
                            "url": f"/assets/backgrounds/{quote(f)}"})
        return out

    def upload_builtin(self, b):
        slot = int(b.get("slot", 2))
        if slot not in (1, 2):
            raise ValueError("слот — 1 или 2")
        bg = next((x for x in self.backgrounds() if x["id"] == b.get("id")), None)
        if not bg:
            raise ValueError(f"фона «{b.get('id')}» нет — обнови список фонов")

        def load_frames():
            from lunacy import images
            return [(images.load(os.path.join(BACKGROUNDS, bg["file"]), fit="cover")[0][0], 1000)]
        return self._upload(slot, bg["label"], f"builtin:{bg['id']}", load_frames)

    @staticmethod
    def graphics(q=None):
        return G.status()

    def graphics_write(self, b):
        self._need_experimental("Запись графики экрана")
        """Набор графики во внешнюю SPI-флеш (04 38): посекторно стирает и пишет 0…0x740000, слоты GIF выше
        не трогает. sha256 из запроса — тот набор, который человек видел в превью и подтвердил."""
        data, blocks, sha = G.load()
        if b.get("sha256") != sha:
            raise ValueError("набор графики пересобран, пока страница была открыта. Обнови страницу и посмотри превью ещё раз")
        if not self.dm.connected:
            raise Offline("клавиатура не подключена")
        if self.dm.kb.wireless:
            raise ValueError("графика экрана заливается только по кабелю: через ресивер 2.4G интерфейса экрана нет")

        def work(job):
            job.state["total"] = blocks

            def go(kb):
                r = G.write(kb, data, blocks, lambda i, n: job.state.update(progress=i, total=n))
                s = self.store.get("screen")            # набор несёт обычный фон: подписи живого экрана стёрты,
                s["live_bg"] = False                    # в режиме live фоновый цикл вернёт их сам
                self.store.set(s, "screen")
                bad = sum(1 for a in r["acks"] if not a or bytes.fromhex(a)[1] != 1)
                if bad:
                    raise RuntimeError(f"клавиатура не подтвердила {bad} блоков из {blocks}: часть значков может "
                                       "быть испорчена. Залей набор ещё раз")
                s = self.store.get("screen")            # прошивка после записи сама включает экран статуса
                if s["display"] == "gif":
                    kb.select_slot(s["slot"])
                else:
                    kb.set_time(slot=s["slot"])
                return r
            r = self.dm.run(self._guarded("графика экрана", go), "запись графики экрана", wait=None)
            try:
                G.save_run(r, sha, self.dm.info)
            except OSError:
                log.exception("журнал записи графики")     # записано; без строки журнала превью скажет «не знаем»
            return f"Набор графики записан за {r['seconds']:.0f} с, все {blocks} блоков подтверждены"
        self.job.start("Запись графики экрана", work, "gfx")
        return {"ok": True}

    def screen_display(self, b):
        """clock — часы и статус, gif — анимация слота, live — нагрузка компьютера вместо часов (livescreen.py).
        Вход в live и выход из него меняют фон экрана статуса во флеш (16 блоков, ≈3 с)."""
        display, slot = b.get("display"), P._int(b.get("slot", self.store.get("screen")["slot"]), 1, 2, "слот")
        if display == "live":
            self._need_experimental("«Живые числа»")
        if display not in ("clock", "gif", "live"):
            raise ValueError("режим экрана: clock, gif или live")
        ls, cur = self.engine.screen, self.store.get("screen")
        if display == "live" or cur.get("live_bg"):
            G.head(live=display == "live")            # набора нет или он рассогласован — отказ до записи
            if self.dm.kb and self.dm.kb.wireless:
                raise ValueError("живой экран переключается только по кабелю: фон меняется через интерфейс "
                                 "экрана, которого у ресивера 2.4G нет")
            go = (lambda kb: ls.enter(kb, slot)) if display == "live" else (lambda kb: ls.leave(kb, display, slot))
            self.dm.run(self._guarded("фон экрана статуса", go), "смена фона экрана")
            return {"ok": True}
        self.dm.run(lambda kb: kb.select_slot(slot) if display == "gif" else kb.set_time(slot=slot), "экран")
        s = self.store.get("screen"); s.update(display=display, slot=slot); self.store.set(s, "screen")
        return {"ok": True}

    def sync_time(self, b=None, wait=3.0):
        if self.store.get("screen")["display"] == "live":
            # часы сейчас показывают нагрузку; настоящее время вернётся при выходе из живого экрана
            return {"ok": True, "message": "Сейчас на часах живые числа — время вернётся, когда выключишь живой экран"}

        def go(kb):
            s = self.store.get("screen")              # слот читаем уже под замком: заливка могла его сменить
            if s["display"] == "live":
                return
            kb.set_time(slot=s["slot"])
            if s["display"] == "gif":
                kb.select_slot(s["slot"])
        self.dm.run(go, "часы", wait=wait)
        return {"ok": True, "message": "Время на клавиатуре обновлено"}

    # ---- настройки ----
    def settings(self, b):
        v = {k: P._int(b.get(k, 0), lo, hi, P.NAMES_RU.get(k, k)) for k, (lo, hi) in P.SETTINGS.items()}
        self.dm.run(lambda kb: kb.settings(**v), "настройки")
        self.store.set(v, "settings")
        self._diverged()
        return {"ok": True, "message": "Настройки записаны"}

    def smart(self, b):
        s = self.store.get("smart")
        for k in ("hints", "layout_flash", "claude", "heatmap_count"):
            if k in b:
                s[k] = bool(b[k])
        if "hint_delay_ms" in b:
            s["hint_delay_ms"] = P._int(b["hint_delay_ms"], 0, 2000, "задержка подсказки")
        if "software" in b:
            if b["software"] not in (None, "heatmap", "ambilight", "load", "solid"):
                raise ValueError("неизвестный режим живой подсветки")
            s["software"] = b["software"]
        if "solid_rgb" in b:
            if not isinstance(b["solid_rgb"], (list, tuple)) or len(b["solid_rgb"]) != 3:
                raise ValueError("цвет — три числа 0–255")
            s["solid_rgb"] = [P._int(c, 0, 255, "цвет") for c in b["solid_rgb"]]
        if "brightness" in b:
            k = float(b["brightness"])
            if not 0.05 <= k <= 1:
                raise ValueError("яркость живых слоёв — от 5 до 100 %")
            s["brightness"] = k
        self.store.set(s, "smart")
        if s.get("heatmap_count") and not self.store.data["heatmap_since"]:
            self.store.set(datetime.date.today().isoformat(), "heatmap_since")
        return {"ok": True}

    def heatmap_reset(self, b):
        with self.store.lock:
            self.store.data["heatmap"] = {}
            self.store.data["heatmap_since"] = datetime.date.today().isoformat()
            self.store.save()
        return {"ok": True}

    # ---- профили ----
    def _current(self):
        with self.store.lock:
            return {k: self.store.get(k) for k in P.FIELDS}

    def profiles(self, q=None):
        return P.listing()

    def profile_save(self, b):
        doc = P.save(b["name"], self._current())
        self.store.set(doc["name"], "active_profile")
        return {"ok": True, "name": doc["name"], "message": f"Профиль «{doc['name']}» сохранён"}

    def _write_config(self, job, content, title):
        """Записать в клавиатуру по шагам keymap → macros → lighting → settings (прогресс в job.state.step).
        Store обновляется после каждого удачного шага, чтобы совпадать с тем, что уже в клавиатуре."""
        km, macros, l, st = content["keymap"], content["macros"], content["lighting"], content["settings"]

        def keymap(kb):
            kb.write_keymap(A.keymap_entries(km["base"]))
            kb.write_keymap(A.keymap_entries(km["fn"]), fn_layer=True)

        def lighting(kb):
            if l["kind"] == "user":
                kb.user_light_mode(brightness=int(l["user_brightness"]))
                kb.write_user_light({int(k): tuple(v) for k, v in l["user_colors"].items()}, save=True)
            else:
                kb.light_mode(int(l["mode"]), tuple(l["rgb"]), int(l["colorful"]), int(l["brightness"]),
                              int(l["speed"]), int(l["direction"]))
        steps = [("keymap", keymap, km), ("macros", lambda kb: kb.write_macros(A.macros_for_device(macros)), macros),
                 ("lighting", lighting, l),
                 ("settings", (lambda kb: kb.settings(**st)) if st is not None else None, st)]   # None = не трогали
        job.state["total"] = len(steps)
        def marked(fn):
            def go(kb):
                self.store.set(title, "unsynced")             # снимется только после последнего шага
                return fn(kb)
            return go
        for i, (step, fn, value) in enumerate(steps):
            job.state.update(step=step, progress=i)
            if fn:
                self.dm.run(marked(fn), f"{title}: {step}", wait=None)
                self.store.set(value, step)
            job.state["progress"] = i + 1
        self.store.set(content.get("triggers") or [], "triggers")   # сочетания живут в Studio — без записи в клавиатуру
        self.engine.combos.reload()
        self.store.set(None, "unsynced")

    def profile_apply(self, b):
        name = P.clean_name(b["name"])
        content = P.validate(P.load(name))
        content["keymap"] = self._check_keymap(content["keymap"], len(content["macros"]))

        def work(job):
            self._write_config(job, content, "профиль")
            self.store.set(name, "active_profile")
            return f"Профиль «{name}» записан в клавиатуру"
        self.job.start(f"Применение профиля «{name}»", work)
        return {"ok": True}

    def profile_delete(self, b):
        name = P.clean_name(b["name"])
        P.delete(name)
        if self.store.data["active_profile"] == name:
            self.store.set(None, "active_profile")
        return {"ok": True, "message": f"Профиль «{name}» удалён"}

    def profile_rename(self, b):
        name = P.clean_name(b["name"])
        to = P.rename(name, b["to"])
        if self.store.data["active_profile"] == name:
            self.store.set(to, "active_profile")
        return {"ok": True, "name": to}

    def profile_export(self, q):
        """(имя файла, JSON). Без name — текущая настройка из store."""
        name = (q.get("name") or [""])[0]
        if name:
            return P.clean_name(name), P.load(name)
        label = self.store.data["active_profile"] or "Текущая настройка"
        return label, P.document(label, self._current())

    def profile_import(self, b):
        content = P.validate(b)
        self._check_keymap(content["keymap"], len(content["macros"]))
        name = P.free_name(b.get("name") or "Импорт")
        P.save(name, content)
        return {"ok": True, "name": name, "message": f"Профиль «{name}» импортирован"}

    # ---- сброс к заводскому ----
    def factory(self, b):
        content = {"keymap": {"base": {}, "fn": {}}, "macros": [],
                   "lighting": {**self.store.get("lighting"), "kind": "effect", "mode": 11, "rgb": [255, 255, 255],
                                "colorful": 1, "brightness": 5, "speed": 3, "direction": 0},
                   "settings": {k: 0 for k in P.SETTINGS}}

        def work(job):
            self._write_config(job, content, "сброс")
            self.store.set(None, "active_profile")
            return "Клавиатура сброшена к заводским настройкам"
        self.job.start("Сброс к заводскому", work)
        return {"ok": True}

    def claude(self, b):
        """Сырой JSON хука Claude Code ({"hook_event_name": ...}) или старый {"event": ...}.
        Неизвестное не ошибка: Claude Code не должен видеть отказов."""
        if not isinstance(b, dict):
            return {"ok": True, "ignored": True}
        if "hook_event_name" in b:
            known, state = CH.state_for(b)
            if not known:
                return {"ok": True, "ignored": True}
            if state is None:                      # например, Notification idle_prompt: состояние не меняем
                self.engine.claude_seen(b["hook_event_name"])
                return {"ok": True}
            self.engine.claude_event(state, b["hook_event_name"])
            return {"ok": True}
        try:
            self.engine.claude_event(str(b.get("event", "")))
        except ValueError:
            return {"ok": True, "ignored": True}
        return {"ok": True}

    def claude_hooks(self, q=None):
        return CH.status()

    def claude_hooks_install(self, b):
        r = CH.install()
        r["message"] = ("Подключено к Claude Code" if r["added"] else "Уже подключено") +             (f"; прежний файл сохранён как {os.path.basename(r['backup'])}" if r["backup"] else "")
        return r

    def claude_hooks_uninstall(self, b):
        r = CH.uninstall()
        r["message"] = "Отключено от Claude Code" if r["removed"] else "Хуков Lunacy Studio в настройках нет"
        return r

    # ---- автозапуск (HKCU\...\Run, по кнопке пользователя) ----
    def autostart_enabled(self):
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as k:
                return winreg.QueryValueEx(k, "LunacyStudio")[0] == self.autostart_cmd
        except OSError:
            return False

    def migrate_autostart(self):
        """Автозапуск был включён, но указывает на старое место программы — переписываем на текущее,
        иначе Windows запускает несуществующий файл, а переключатель показывает «выкл»."""
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as k:
                old = winreg.QueryValueEx(k, "LunacyStudio")[0]
        except OSError:
            return
        if old != self.autostart_cmd and "main.py" in old:
            self.autostart({"enable": True})
            log.info("автозапуск переписан на текущее место программы: %s", self.autostart_cmd)

    def autostart(self, b):
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as k:
            if b.get("enable"):
                winreg.SetValueEx(k, "LunacyStudio", 0, winreg.REG_SZ, self.autostart_cmd)
            else:
                try:
                    winreg.DeleteValue(k, "LunacyStudio")
                except FileNotFoundError:
                    pass
        return {"ok": True, "autostart": self.autostart_enabled()}

    def quit(self, b):
        if self.job.state.get("status") == "running":
            raise ValueError(f"сейчас идёт «{self.job.state['name']}» — выключи сервис, когда она закончится")
        threading.Timer(0.3, self.on_quit).start()
        return {"ok": True}


ROUTES = {
    "/api/keymap/commit": "keymap_commit",
    "/api/library/upload": "library_upload", "/api/library/rename": "library_rename", "/api/library/delete": "library_delete",
    "/api/macros": "macros_set", "/api/macros/from_text": "macro_from_text", "/api/macros/triggers": "macro_triggers",
    "/api/lighting/effect": "effect", "/api/lighting/user": "user_colors", "/api/lighting/preview": "preview",
    "/api/lighting/name": "effect_name",
    "/api/screen/display": "screen_display", "/api/screen/time": "sync_time",
    "/api/settings": "settings", "/api/smart": "smart", "/api/heatmap/reset": "heatmap_reset",
    "/api/autostart": "autostart", "/api/quit": "quit",
    "/api/profiles/save": "profile_save", "/api/profiles/apply": "profile_apply",
    "/api/profiles/delete": "profile_delete", "/api/profiles/rename": "profile_rename",
    "/api/profiles/import": "profile_import", "/api/factory": "factory",
    "/api/screen/upload_builtin": "upload_builtin", "/api/live/flash": "live_flash", "/api/timer": "timer",
    "/api/screen/graphics/write": "graphics_write", "/api/experimental": "experimental",
    "/api/update/check": "update_check", "/api/update/install": "update_install", "/api/update/settings": "update_settings",
    "/api/claude/hooks/install": "claude_hooks_install", "/api/claude/hooks/uninstall": "claude_hooks_uninstall",
}
GET_ROUTES = {"/api/device": "device", "/api/profiles": "profiles", "/api/stats": "stats", "/api/live/frame": "live_frame",
              "/api/screen/backgrounds": "backgrounds", "/api/claude/hooks": "claude_hooks",
              "/api/screen/graphics": "graphics", "/api/library": "library", "/api/update": "update"}
FRAME_BYTES = 240 * 135 * 2
FRAMES_LIMIT = 69 * FRAME_BYTES
SLOT_PNG = re.compile(r"^/api/screen/slot/([12])\.png$")
LIB_FILE = re.compile(r"^/api/library/([0-9a-f]{12})/(thumb\.png|frames\.bin)$")
PACK_PNG = re.compile(r"^/api/screen/pack/([0-9a-f]{6}|_sheet|_live)\.png$")
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".otf": "font/otf",
         ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".json": "application/json; charset=utf-8",
         ".webp": "image/webp", ".txt": "text/plain; charset=utf-8", ".jpg": "image/jpeg", ".gif": "image/gif"}


def make_handler(app):
    class H(BaseHTTPRequestHandler):
        server_version = "LunacyStudio"

        def log_message(self, fmt, *a):
            pass

        def _host_ok(self):
            return self.headers.get("Host", "") in (f"127.0.0.1:{PORT}", f"localhost:{PORT}")

        def _send(self, code, obj=None, body=None, ctype="application/json; charset=utf-8", extra=None):
            data = body if body is not None else json.dumps(obj, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            try:
                return self._get()
            except Exception as e:
                log.exception("GET %s", self.path)
                return self._send(500, {"error": f"внутренняя ошибка: {e}"})

        def _get(self):
            if not self._host_ok():
                return self._send(403, {"error": "host"})
            u = urlparse(self.path)
            path, q = u.path, parse_qs(u.query)
            if path == "/api/state":
                return self._send(200, app.state())
            if path == "/api/status":
                return self._send(200, app.status())
            if path in GET_ROUTES:
                return self._send(200, getattr(app, GET_ROUTES[path])(q))
            if path == "/api/profiles/export":      # данные пользователя: токен в заголовке или ?token= (для ссылки)
                token = self.headers.get("X-Studio-Token") or (q.get("token") or [""])[0]
                if not secrets.compare_digest(token.encode(), TOKEN.encode()):
                    return self._send(403, {"error": "нет токена"})
                try:
                    name, doc = app.profile_export(q)
                except ValueError as e:
                    return self._send(404, {"error": str(e)})
                data = json.dumps(doc, ensure_ascii=False, indent=1).encode()
                return self._send(200, body=data, ctype="application/json; charset=utf-8",
                                  extra={"Content-Disposition": "attachment; filename=\"profile.json\"; "
                                         f"filename*=UTF-8''{quote(name + '.json')}"})
            m = SLOT_PNG.match(path)
            if m:
                f = S.png_path(int(m.group(1)))
                if not os.path.isfile(f):
                    return self._send(404, {"error": "в этот слот отсюда ещё не заливали"})
                with open(f, "rb") as fh:
                    return self._send(200, body=fh.read(), ctype="image/png")
            m = LIB_FILE.match(path)
            if m:
                f = LB.file(m.group(1), m.group(2))
                if not os.path.isfile(f):
                    return self._send(404, {"error": "нет такого видео в библиотеке"})
                with open(f, "rb") as fh:
                    return self._send(200, body=fh.read(), ctype="image/png" if f.endswith(".png") else "application/octet-stream")
            m = PACK_PNG.match(path)
            if m:
                f = os.path.join(G.PREVIEW, m.group(1) + ".png")
                if not os.path.isfile(f):
                    return self._send(404, {"error": "этой картинки в наборе нет: пересобери набор (tools/build_pack.py)"})
                with open(f, "rb") as fh:
                    return self._send(200, body=fh.read(), ctype="image/png")
            if path == "/":
                path = "/index.html"
            f = os.path.normpath(os.path.join(UI, path.lstrip("/")))
            if not f.startswith(UI) or not os.path.isfile(f):
                return self._send(404, {"error": "нет такого файла"})
            data = open(f, "rb").read()
            if f == os.path.join(UI, "index.html"):
                data = data.replace(b"__TOKEN__", TOKEN.encode())
            self._send(200, body=data, ctype=TYPES.get(os.path.splitext(f)[1], "application/octet-stream"))

        def do_POST(self):
            if not self._host_ok():
                return self._send(403, {"error": "host"})
            path = urlparse(self.path).path
            try:
                n = int(self.headers.get("Content-Length", 0))
            except ValueError:
                n = -1
            limit = 64 * 1024 if path == "/api/claude" else 30 * 1024 * 1024 if path == "/api/screen/upload"                 else FRAMES_LIMIT if path in ("/api/screen/upload_frames", "/api/library/save") else 2 * 1024 * 1024
            if not 0 <= n <= limit:
                self.close_connection = True
                if path == "/api/claude":     # хук шлёт пару килобайт; большее не читаем и Claude Code не ругаем
                    return self._send(200, {"ok": True, "ignored": True})
                return self._send(413, {"error": "запрос слишком большой" if n > limit else "неверная длина запроса"})
            if path != "/api/claude" and self.headers.get("X-Studio-Token") != TOKEN:
                self.close_connection = True  # без токена тело даже не читаем
                return self._send(403, {"error": "нет токена"})
            body = self.rfile.read(n) if n else b""
            try:
                if path == "/api/claude":   # хуки Claude Code: без токена, умеет только мигать подсветкой
                    try:
                        payload = json.loads(body or b"{}")
                    except ValueError:
                        return self._send(200, {"ok": True, "ignored": True})
                    return self._send(200, app.claude(payload))
                if path == "/api/screen/upload":
                    return self._send(200, app.screen_upload(body, self.headers))
                if path == "/api/screen/upload_frames":
                    return self._send(200, app.screen_upload_frames(body, self.headers))
                if path == "/api/library/save":
                    return self._send(200, app.library_save(body, self.headers))
                fn = ROUTES.get(path)
                if not fn:
                    return self._send(404, {"error": "нет такого метода"})
                return self._send(200, getattr(app, fn)(json.loads(body or b"{}")))
            except Offline as e:
                return self._send(503, {"error": str(e)})
            except Busy as e:
                return self._send(409, {"error": str(e)})
            except Refused as e:
                return self._send(409, {"error": f"{e}. Если открыта фирменная программа Lunacy, закрой её и повтори"})
            except KeyError as e:
                return self._send(400, {"error": f"в запросе нет поля {e}"})
            except (TypeError, AttributeError) as e:
                log.warning("POST %s: %r", path, e)
                return self._send(400, {"error": f"неверный формат запроса или внутренняя ошибка ({e})"})
            except (ValueError, AssertionError, RuntimeError) as e:
                return self._send(400, {"error": str(e) or "неверный запрос"})
            except Exception as e:
                log.exception("POST %s", path)
                return self._send(500, {"error": f"внутренняя ошибка: {e}"})
    return H


def serve(app):
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), make_handler(app))
    threading.Thread(target=httpd.serve_forever, name="http", daemon=True).start()
    return httpd
