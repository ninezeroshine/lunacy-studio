"""Живой экран: нагрузка компьютера на экране статуса вместо времени (находка 50 карточки).

Часы клавиатуры — отдельная микросхема (I2C), команда установки времени принимает любые числа в пределах масок,
флеш не трогается. Раз в секунду шлём числа, подписи к ним нарисованы в фоне экрана статуса (адрес 0 внешней флеш).
Фон один на все режимы, поэтому при входе в режим заливаем фон с подписями (assets/graphics/live_head.bin.gz, 16 блоков,
≈3 с), при выходе — обычный из pack.bin и настоящее время.

Поля и пределы:  20[год]/[месяц]/[день]   [часы]:[минуты]:[секунды]
                 GPU %    —       RAM ГБ   VRAM ГБ CPU %   пульс
                 0–99     0       0–39     0–39    0–79    тикает сам
"""
import threading, time, logging, datetime

from . import graphics as G

log = logging.getLogger("livescreen")
TICK = 1.0
BANNER = "фон экрана статуса"     # метка недописанной смены фона (server._guarded)


def clamp(v, top):
    """Число для поля: None → 0, округление, потолок поля (выше прошивка обрезала бы старшие биты)."""
    if v is None:
        return 0
    return max(0, min(top, int(round(v))))


def fields(st):
    """Показания sysstats → поля show_numbers. Чистая функция: проверка — python -I -m studio.livescreen."""
    return {"yy": clamp(st.get("gpu"), 99), "mo": 0, "dd": clamp(st.get("ram_gb"), 39),
            "hh": clamp(st.get("vram_gb"), 39), "mi": clamp(st.get("cpu"), 79), "ss": 0}


class LiveScreen:
    def __init__(self, dm, store, stats):
        self.dm, self.store, self.stats = dm, store, stats
        self.shown = None             # последние отправленные поля и время отправки
        self.error = None             # почему фон не удалось поменять (показывает интерфейс)
        self._fail_at = 0.0
        threading.Thread(target=self._loop, name="live-screen", daemon=True).start()

    # ---- шаги под замком клавиатуры (вызываются из dm.run) ----
    # Режим, слот и метка фона меняются в профиле одним обновлением и только под замком клавиатуры:
    # иначе фоновый цикл увидел бы «режим live, фон обычный» посреди переключения и откатил бы его.
    # Метка live_bg ставится ДО записи фона: если связь оборвётся посередине, режим и метка разойдутся,
    # и фоновый цикл перезапишет фон целиком, когда клавиатура вернётся.
    def _mark(self, **kw):
        s = self.store.get("screen"); s.update(kw); self.store.set(s, "screen")

    def _done(self):
        if self.store.data.get("unsynced") == BANNER:
            self.store.set(None, "unsynced")

    def enter(self, kb, slot):
        """Фон с подписями (если его ещё нет) + первые числа."""
        if not self.store.get("screen").get("live_bg"):
            data = G.head(live=True)
            self._mark(live_bg=True)
            r = G.write(kb, data, G.LIVE_BLOCKS, None)
            G.check_acks(r, G.LIVE_BLOCKS)
        self._mark(display="live", slot=slot, live_bg=True)
        self._done()
        self.push(kb)

    def leave(self, kb, display, slot):
        """Обычный фон, настоящее время, затем выбранный режим (clock или gif)."""
        if self.store.get("screen").get("live_bg"):
            data = G.head(live=False)
            self._mark(live_bg=False)
            r = G.write(kb, data, G.LIVE_BLOCKS, None)
            G.check_acks(r, G.LIVE_BLOCKS)
        self._mark(display=display, slot=slot, live_bg=False)
        self._done()
        self.shown = None
        kb.set_time(slot=slot)
        if display == "gif":
            kb.select_slot(slot)

    def push(self, kb):
        f = fields(self.stats.get())
        kb.show_numbers(f["yy"], f["mo"], f["dd"], f["hh"], f["mi"], f["ss"], slot=self.store.get("screen")["slot"])
        self.shown = dict(f, at=time.time())

    # ---- фон ----
    def _loop(self):
        while True:
            time.sleep(TICK)
            try:
                self._tick()
            except Exception:
                log.exception("живой экран")

    def _tick(self):
        if not self.dm.connected or (self.dm.kb and self.dm.kb.wireless):
            return
        s = self.store.get("screen")
        live, bg = s.get("display") == "live", bool(s.get("live_bg"))
        if live and bg:
            self.dm.try_run(self.push)          # занята (заливка) — кадр пропускаем
            return
        if live == bg:
            return
        # фон не совпадает с режимом: Studio упала между шагами, набор перезалили или вход не дописался
        if time.monotonic() - self._fail_at < 30:
            return

        def fix(kb):
            s = self.store.get("screen")           # перечитываем под замком: переключение могло уже закончиться
            try:
                if s.get("display") == "live" and not s.get("live_bg"):
                    self.enter(kb, s.get("slot", 2))
                elif s.get("display") != "live" and s.get("live_bg"):
                    self.leave(kb, s.get("display", "clock"), s.get("slot", 2))
                self.error = None
            except (ValueError, RuntimeError) as e:  # нет набора, клавиатура не подтвердила блоки
                self._fail_at = time.monotonic()
                self.error = str(e)
                log.warning("живой экран, фон: %s", e)
        self.dm.try_run(fix)                       # занята (переключение, заливка) — попробуем через секунду

    def status(self):
        s = self.store.get("screen")
        out = {"on": s.get("display") == "live", "bg": bool(s.get("live_bg")), "error": self.error, "shown": None}
        if self.shown and time.time() - self.shown["at"] < 5:
            f = self.shown
            out["shown"] = {"date": f"20{f['yy']:02d}/{f['mo']:02d}/{f['dd']:02d}",
                            "time": f"{f['hh']:02d}:{f['mi']:02d}:{f['ss']:02d}",
                            "at": datetime.datetime.fromtimestamp(f["at"]).isoformat(timespec="seconds")}
        return out


if __name__ == "__main__":
    # проверка раскладки полей без железа и без сервиса:
    # python -I -c "import sys,runpy; sys.path.insert(0,'.'); runpy.run_module('studio.livescreen', run_name='__main__')" (из корня репозитория)
    cases = [
        ({"cpu": 12.4, "gpu": 36.0, "ram_gb": 33.1, "vram_gb": 4.8}, dict(yy=36, mo=0, dd=33, hh=5, mi=12, ss=0)),
        ({"cpu": 97.0, "gpu": 100.0, "ram_gb": 52.0, "vram_gb": 15.9}, dict(yy=99, mo=0, dd=39, hh=16, mi=79, ss=0)),
        ({"cpu": 0.0, "gpu": None, "ram_gb": None, "vram_gb": None}, dict(yy=0, mo=0, dd=0, hh=0, mi=0, ss=0)),
        ({"cpu": -3, "gpu": 99.6, "ram_gb": 0.4, "vram_gb": 39.5}, dict(yy=99, mo=0, dd=0, hh=39, mi=0, ss=0)),
    ]
    bad = 0
    for st, want in cases:
        got = fields(st)
        ok = got == want
        bad += not ok
        print("OK  " if ok else "FAIL", st, "->", got)
    raise SystemExit(bad)
