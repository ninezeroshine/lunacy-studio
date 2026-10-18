"""Движок живой подсветки (команда 04 20). Живой кадр заменяет подсветку ВСЕЙ клавиатуры и держится
несколько секунд, поэтому слои рисуют полный кадр, а когда рисовать нечего — движок молчит и клавиатура
сама возвращает свой эффект (проверено на железе, PROTOCOL.md)."""
import json, os, time, threading, math, logging, colorsys, datetime
from . import keys as K
from . import winapi, sysstats
from .livescreen import LiveScreen
from .combos import Combos

log = logging.getLogger("live")
HERE = os.path.dirname(os.path.abspath(__file__))
ORDER = ("ctrl", "alt", "shift", "win")
FPS_MAX = 10          # потолок железа 10–12 полных кадров/с
KEEPALIVE = 0.8       # кадр держится несколько секунд; обновляем чаще
DIM = (4, 4, 6)
GOLD = (255, 170, 40)
F_ROW = sorted((k for k in K.KEYS if k.row == 0 and k.name[:1] == "F" and k.name[1:].isdigit()), key=lambda k: k.col)
ESC = next(k for k in K.KEYS if k.name == "Esc")
# цифровой блок по столбцам, снизу вверх: Num/7/4/1/0 — CPU, //8/5/2 — RAM, */9/6/3 — GPU
LOAD_COLS = [sorted((k for k in K.KEYS if k.col == c and 1 <= k.row <= rows), key=lambda k: -k.row)
             for c, rows in ((15, 5), (16, 4), (17, 4))]


def combo_name(mods):
    return "+".join(m for m in ORDER if m in mods)


def scale(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c)


def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


class Hotkeys:
    def __init__(self, path=os.path.join(HERE, "hotkeys.json")):
        self.path = path
        self.load()

    def load(self):
        with open(self.path, encoding="utf-8") as f:
            d = json.load(f)
        self.categories = d["categories"]
        self.apps = d["apps"]

    def app_for(self, exe):
        for name, a in self.apps.items():
            if exe and exe in a["match"]:
                return name
        return None

    def keys_for(self, exe, combo):
        """{light_index: (категория, подпись)}: общие сочетания, поверх — сочетания программы."""
        out = {}
        for name in ("common", self.app_for(exe)):
            if not name:
                continue
            for key, cat, label in self.apps[name]["keys"].get(combo, []):
                hid = K.NAME_TO_HID.get(key)
                k = K.BY_HID.get(hid) if hid is not None else None
                if k:
                    out[k.light_index] = (cat, label)
        return out


class LiveEngine:
    def __init__(self, dm, store, watcher):
        self.dm, self.store, self.watcher = dm, store, watcher
        self.hotkeys = Hotkeys()
        self.fg_exe, self.lang = "", 0
        self.overlay = None                 # что сейчас рисуется (для интерфейса)
        self.flashes = []                   # [(до, kind, данные)]
        self._flash_lock = threading.Lock()
        self.claude = {"state": "idle", "since": 0.0}
        self.claude_last = (None, None)     # (имя последнего события хука, время ISO) — для интерфейса
        self.preview = None                 # (до, кадр, подпись) — превью и вспышки из интерфейса
        self.timer = None                   # {"start": monotonic, "total": с} — фокус-таймер
        self.stats = sysstats.Stats()
        self.screen = LiveScreen(dm, store, self.stats)   # живой экран: числа вместо часов
        self.combos = Combos(store, watcher)              # макросы на сочетания клавиш (программно)
        self._last_sent, self._last_frame = 0.0, None
        self.fps = 0.0
        watcher.on_key = self._on_key
        threading.Thread(target=self._loop, name="live", daemon=True).start()

    # ---- события ----
    def _on_key(self, vk):
        if self.claude["state"] == "attention":
            self.claude = {"state": "idle", "since": time.monotonic()}
        t = self.timer
        if t and time.monotonic() - t["start"] >= t["total"]:   # таймер звенит — любая клавиша гасит
            self.timer = None

    def claude_event(self, event, name=None):
        """event — состояние или старое короткое имя ({"event": "stop"}); name — исходное имя для интерфейса."""
        now = time.monotonic()
        state = {"prompt": "working", "working": "working", "tool": "working", "stop": "done",
                 "done": "done", "notification": "attention", "attention": "attention", "idle": "idle",
                 "error": "error"}.get(event)
        if not state:
            raise ValueError(f"неизвестное событие {event}")
        self.claude_seen(name or event)
        self.claude = {"state": state, "since": now}
        if state in ("done", "error") and (self.store.get("smart") or {}).get("claude"):   # выключатель в «Сигналах» гасит и вспышки
            with self._flash_lock:
                self.flashes.append((now + 1.6, state, None))

    def claude_seen(self, name):
        self.claude_last = (name, datetime.datetime.now().isoformat(timespec="seconds"))

    def show_preview(self, frame, seconds=3.0, label="превью"):
        self.preview = (time.monotonic() + seconds, frame, label)

    # ---- фокус-таймер ----
    def timer_start(self, minutes):
        self.timer = {"start": time.monotonic(), "total": minutes * 60.0}

    def timer_cancel(self):
        self.timer = None

    def timer_status(self):
        t = self.timer
        if not t:
            return {"running": False, "ringing": False, "total_s": 0, "left_s": 0}
        left = t["total"] - (time.monotonic() - t["start"])
        return {"running": left > 0, "ringing": left <= 0, "total_s": int(t["total"]), "left_s": max(0, round(left))}

    def _timer(self, now):
        t = self.timer
        if not t:
            return None
        el, total = now - t["start"], t["total"]
        frame = {k.light_index: DIM for k in K.KEYS}
        n = len(F_ROW)
        if el < total:
            if el < 2:                                       # старт: F-ряд заполняется и гаснет
                lit, k = min(1.0, el / 1.4) * n, min(1.0, (2 - el) / 0.6)
                self.overlay = "таймер: старт"
            else:
                mark = int(el // 300)
                if not mark or el - mark * 300 >= 2:         # между отметками таймер не рисует
                    return None
                lit, k = el / total * n, min(1.0, (2 - (el - mark * 300)) / 0.4)
                self.overlay = "таймер: прогресс"
            for i, key in enumerate(F_ROW):
                frame[key.light_index] = scale(GOLD, k * max(0.0, min(1.0, lit - i))) if lit > i else scale(GOLD, 0.06 * k)
            return frame
        e = el - total
        if e < 1.6:                                          # конец: зелёно-золотая волна
            phase = e / 1.6
            for key in K.KEYS:
                c = mix((20, 255, 80), GOLD, key.col / 18)
                frame[key.light_index] = scale(c, max(0.0, 1 - abs(key.col / 18 - phase) * 4))
        elif e > 120 + 1.6:                                  # никто не нажал за 2 минуты
            self.timer = None
            return None
        else:                                                # медленный пульс Esc до нажатия клавиши
            frame[ESC.light_index] = scale(GOLD, 0.2 + 0.8 * (0.5 + 0.5 * math.sin(now * 2.2)))
        self.overlay = "таймер: время вышло"
        return frame

    # ---- слои ----
    def _hints(self, smart):
        w = self.watcher
        mods = w.mods()
        if not smart.get("hints") or not mods:
            return None
        if time.monotonic() - w.mods_since < smart.get("hint_delay_ms", 350) / 1000:
            return None
        combo = combo_name(mods)
        hk = self.hotkeys.keys_for(self.fg_exe, combo)
        if not hk:
            return None
        frame = {k.light_index: (6, 6, 10) for k in K.KEYS}
        for li, (cat, _label) in hk.items():
            frame[li] = tuple(self.hotkeys.categories.get(cat, {"rgb": [255, 255, 255]})["rgb"])
        for vk in list(w.held):
            k = K.BY_VK.get(vk)
            if k:
                frame[k.light_index] = (255, 255, 255)
        self.overlay = f"подсказки {combo} · {self.hotkeys.app_for(self.fg_exe) or 'общие'}"
        return frame

    def _flash(self, now):
        with self._flash_lock:
            self.flashes = [f for f in self.flashes if f[0] > now]
        if not self.flashes:
            return None
        until, kind, data = self.flashes[-1]
        t = max(0.0, (until - now))
        if kind == "layout":
            c = (255, 70, 30) if data == 0x0419 else (30, 110, 255)
            k = min(1.0, t / 0.4)
            letters = {K.BY_HID[h].light_index for h in range(0x04, 0x1E) if h in K.BY_HID}
            frame = {key.light_index: scale(c, k if key.light_index in letters else k * 0.15) for key in K.KEYS}
            self.overlay = "раскладка " + ("RU" if data == 0x0419 else "EN")
            return frame
        if kind == "done":
            phase = 1.0 - t / 1.6
            frame = {}
            for key in K.KEYS:
                d = abs(key.col / 18 - phase)
                frame[key.light_index] = scale((20, 255, 80), max(0.0, 1 - d * 4))
            self.overlay = "Claude Code: готово"
            return frame
        if kind == "error":                                  # короткий коралловый пульс по F-ряду и Esc
            k = math.sin(math.pi * min(1.0, 1.0 - t / 1.6) * 2) ** 2
            frame = {key.light_index: DIM for key in K.KEYS}
            for key in (*F_ROW, ESC):
                frame[key.light_index] = scale((226, 135, 122), 0.15 + 0.85 * k)
            self.overlay = "Claude Code: ошибка"
            return frame
        return None

    def _claude_attention(self, now):
        if self.claude["state"] != "attention":
            return None
        if now - self.claude["since"] > 120:
            self.claude = {"state": "idle", "since": now}
            return None
        k = 0.35 + 0.65 * (0.5 + 0.5 * math.sin(now * 5))
        frame = {key.light_index: (4, 4, 6) for key in K.KEYS}
        for key in K.KEYS:
            if key.row == 0 or key.name == "Enter":
                frame[key.light_index] = scale((255, 150, 0), k)
        self.overlay = "Claude Code ждёт ответа"
        return frame

    def _software(self, smart, now):
        mode = smart.get("software")
        if not mode:
            return None
        if mode == "solid":
            c = tuple(smart.get("solid_rgb", [40, 0, 120]))
            frame = {k.light_index: c for k in K.KEYS}
        elif mode == "heatmap":
            heat = {int(k): v for k, v in self.store.get("heatmap").items()}
            top = max(heat.values() or [1])
            frame = {}
            for k in K.KEYS:
                v = heat.get(k.light_index, 0) / top
                h = (1 - v) * 0.66
                r, g, b = colorsys.hsv_to_rgb(h, 1, 0.08 + 0.92 * math.sqrt(v)) if v else (0.01, 0.01, 0.03)
                frame[k.light_index] = (int(r * 255), int(g * 255), int(b * 255))
        elif mode == "load":
            st = self.stats.get()
            vals = [(st["cpu"], 1.0), (st["ram"], 1.0), (st["gpu"], 1.0) if st["gpu"] is not None else (st["cpu"], 0.45)]
            frame = {k.light_index: (3, 5, 14) for k in K.KEYS}
            for keys, (v, k) in zip(LOAD_COLS, vals):
                v = max(0.0, min(100.0, v or 0.0)) / 100
                c = mix((0, 190, 255), GOLD, v * 2) if v < 0.5 else mix(GOLD, (255, 40, 20), v * 2 - 1)
                level = v * len(keys)
                for i, key in enumerate(keys):
                    frame[key.light_index] = mix((3, 5, 14), scale(c, k), max(0.0, min(1.0, level - i)))
        elif mode == "ambilight":
            grid = winapi.screen_grid(19, 6)
            frame = {}
            for k in K.KEYS:
                col = min(18, int((k.x + k.w / 2) / 800 * 19))
                r, g, b = grid[k.row][col]
                h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
                r, g, b = colorsys.hsv_to_rgb(h, min(1.0, s * 1.4), v)
                frame[k.light_index] = (int(r * 255), int(g * 255), int(b * 255))
        else:
            return None
        if self.claude["state"] == "working" and smart.get("claude"):
            phase = (now * 0.8) % 1.0
            for k in K.KEYS:
                if k.row == 0:
                    d = min(abs(k.col / 18 - phase), 1 - abs(k.col / 18 - phase))
                    frame[k.light_index] = mix(frame[k.light_index], (255, 140, 0), max(0.0, 1 - d * 6))
        self.overlay = {"solid": "сплошной цвет", "heatmap": "тепловая карта", "ambilight": "Ambilight",
                        "load": "нагрузка системы"}[mode]
        return frame

    # ---- цикл ----
    def _loop(self):
        last_fg = 0.0
        frames, t_fps = 0, time.monotonic()
        while True:
            now = time.monotonic()
            smart = self.store.get("smart")
            try:
                if now - last_fg > 0.25:
                    last_fg = now
                    exe, lang = winapi.foreground()
                    if lang and self.lang and lang != self.lang and smart.get("layout_flash"):
                        with self._flash_lock:
                            self.flashes.append((now + 1.2, "layout", lang))
                    self.fg_exe, self.lang = exe, lang or self.lang
                if self.watcher.counting:
                    self._merge_counts()
                self.watcher.counting = bool(smart.get("heatmap_count"))

                self.overlay = None
                frame = None
                if self.preview and self.preview[0] > now:
                    frame, self.overlay = self.preview[1], self.preview[2]
                else:
                    self.preview = None
                    frame = (self._hints(smart) or self._flash(now)
                             or (self._claude_attention(now) if smart.get("claude") else None)
                             or self._timer(now) or self._software(smart, now))
                if frame is not None:
                    try:
                        k = max(0.0, min(1.0, float(smart.get("brightness", 1.0))))
                    except (TypeError, ValueError):
                        k = 1.0
                    frame = {i: tuple(max(0, min(255, int(v * k))) for v in c[:3]) for i, c in frame.items()}
                    if frame != self._last_frame or now - self._last_sent > KEEPALIVE:
                        if self.dm.try_run(lambda kb: kb.live(frame)) is not None:
                            self._last_frame, self._last_sent = frame, now
                            frames += 1
                else:
                    self._last_frame = None
            except Exception as e:
                sig = f"{type(e).__name__}: {e}"
                if sig != getattr(self, "_err_sig", None) or now - getattr(self, "_err_at", 0) > 600:
                    log.exception("ошибка в цикле подсветки")   # одинаковую ошибку — не чаще раза в 10 минут
                    self._err_sig, self._err_at = sig, now
                time.sleep(1)
            if now - t_fps >= 2:
                self.fps, frames, t_fps = frames / (now - t_fps), 0, now
            time.sleep(max(0.01, 1 / FPS_MAX - (time.monotonic() - now)))

    def _merge_counts(self):
        c = self.watcher.take_counts()
        if not c:
            return
        with self.store.lock:
            heat = self.store.data["heatmap"]
            for vk, n in c.items():
                k = K.BY_VK.get(vk)
                if k:
                    heat[str(k.light_index)] = heat.get(str(k.light_index), 0) + n
            # сохраняем не чаще раза в минуту
            if time.monotonic() - getattr(self, "_heat_saved", 0) > 60:
                self.store.save(); self._heat_saved = time.monotonic()

    def frame_now(self):
        """Что сервис рисует на клавиатуре прямо сейчас — для зеркала в интерфейсе.
        None: сервис молчит и горит то, что сохранено в самой клавиатуре. Кадр, отправленный давно (заливка держит
        клавиатуру), уже не горит: клавиатура через пару секунд возвращает свой эффект."""
        f = self._last_frame
        if not f or time.monotonic() - self._last_sent > KEEPALIVE + 1.5:
            return None
        return {str(i): [int(v) for v in c] for i, c in f.items()}

    def status(self):
        return {"overlay": self.overlay, "fps": round(self.fps, 1), "app": self.fg_exe,
                "app_profile": self.hotkeys.app_for(self.fg_exe), "lang": "RU" if self.lang == 0x0419 else
                ("EN" if self.lang == 0x0409 else hex(self.lang)), "claude": self.claude["state"],
                "claude_event": self.claude_last[0], "claude_at": self.claude_last[1],
                "timer": self.timer_status()}
