"""Протокол Lunacy In Space (05AC:024F). Протокол восстановлен по обмену с клавиатурой; описание команд — в docs/DEVELOPMENT.md.
Адреса FUN_xxxxxxxx — функции Lunacy Keyboard Driver.exe 1.0.3.9, откуда снята каждая команда."""
import time, datetime, logging
from .hidwin import HidDevice, find

log = logging.getLogger("proto")

DEV = "vid_05ac&pid_024f"
MARK = b"\xaa\x55"
KEYS = 144                     # 576 байт / 4 на клавишу
SCREEN_W, SCREEN_H = 240, 135
GIF_HEAD = 256
GIF_MAX_FRAMES = 69            # layouts/98t-keyboard.xml


class NoAck(Exception):
    pass


class Refused(RuntimeError):
    """Клавиатура ответила, но отказала ([3] = FF) или ответила на чужую команду — связь при этом жива.
    Чаще всего значит, что клавиатурой одновременно пользуется другая программа (фирменная DeviceDriver.exe)."""


def frame(fields: dict, size=64, mark_at=62) -> bytes:
    """Кадр данных: {смещение: байт}, маркер AA 55 по смещению mark_at."""
    b = bytearray(size)
    for k, v in fields.items():
        b[k] = v & 0xFF
    if mark_at is not None:
        b[mark_at:mark_at + 2] = MARK
    return bytes(b)


class Keyboard:
    def __init__(self, delay=0.035, log=None):
        # кабель: 05AC:024F MI_03; ресивер 2.4G: 0C45:FEFE MI_03 (config.xml; через ресивер не проверено)
        p = find(DEV + "&mi_03") or find("vid_0c45&pid_fefe&mi_03")
        self.wireless = bool(p and "pid_fefe" in p.lower())
        if not p:
            raise RuntimeError("Lunacy In Space не найдена: нужен кабель (ползунок в центре) или 2.4G-ресивер")
        self.cmd_dev = HidDevice(p)
        self._img = None
        self.delay = delay          # cmd_delaytime из XML; FUN_00450e50 спит this+0x3c перед каждой посылкой
        self.log = log

    def info(self):
        """Модель, производитель, прошивка (bcdDevice 0x0112 → «1.12»), VID/PID, подключение."""
        attrs = self.cmd_dev.attributes()
        manufacturer, product = self.cmd_dev.strings()
        vid, pid, ver = attrs or (None, None, None)
        return {"model": "Lunacy In Space", "manufacturer": manufacturer, "product": product,
                "firmware": f"{ver >> 8:x}.{ver & 0xFF:02x}" if ver is not None else None,
                "vid": f"{vid:04X}" if vid is not None else None, "pid": f"{pid:04X}" if pid is not None else None,
                "connection": "2.4g" if self.wireless else "usb"}

    def close(self):
        self.cmd_dev.close()
        if self._img: self._img.close()

    def __enter__(self): return self
    def __exit__(self, *a): self.close()

    # ---- транспорт (FUN_00450e50 / FUN_00451040 / FUN_00451320) ----
    def send(self, payload: bytes, read=True, delay=None):
        p = bytes(payload).ljust(64, b"\0")[:64]
        time.sleep(self.delay if delay is None else delay)
        if not self.cmd_dev.set_feature(b"\0" + p):
            raise NoAck(f"SetFeature не прошёл: {p[:9].hex(' ')}")
        resp = None
        if read:
            time.sleep(0.005)
            r = self.cmd_dev.get_feature(65)
            resp = r[1:] if r else None
        if self.log: self.log(p, resp)
        return resp

    def header(self, op, n=0, extra=None, read=True):
        """Заголовок 04 <op>, [8] = число 64-байтных блоков данных. Ответ — эхо, [3]: 01 ок, FF отказ."""
        b = bytearray(64); b[0] = 0x04; b[1] = op; b[8] = n
        for k, v in (extra or {}).items(): b[k] = v
        return self.check(op, self.send(bytes(b), read=read))

    @staticmethod
    def check(op, resp):
        """Сверить эхо (проверено на 04 18/28/02/20/F5: эхо кода и [3] = 01). Отказ FF и ответ на чужую команду —
        ошибка; иное значение [3] только пишем в журнал, чтобы не сломать ещё не сверенные команды."""
        if resp:
            if resp[3] == 0xFF:
                raise Refused(f"клавиатура отказала на команде 04 {op:02X}")
            if resp[0] == 0x04 and resp[1] != op:
                raise Refused(f"ответ на чужую команду (04 {resp[1]:02X} вместо 04 {op:02X}) — "
                              "похоже, клавиатурой одновременно пользуется другая программа")
            if resp[3] != 1:
                log.warning("04 %02X: необычный ответ %s", op, resp[:4].hex(" "))
        return resp

    wrote = False   # данные хоть раз ушли в клавиатуру (сбрасывает сервис перед записью)

    def data(self, buf: bytes, delay=None):
        """Данные блоками по 64 через SetFeature, до 10 повторов на блок (FUN_00450e50, ветка > 0x41)."""
        assert len(buf) % 64 == 0, len(buf)
        self.wrote = True
        for i in range(0, len(buf), 64):
            for attempt in range(11):
                time.sleep(self.delay if delay is None else delay)
                if self.cmd_dev.set_feature(b"\0" + buf[i:i + 64]):
                    break
            else:
                raise NoAck(f"блок {i // 64} не принят")
            if self.log: self.log(buf[i:i + 64], None)

    def begin(self): return self.header(0x18)
    def end(self): return self.header(0x02)
    def save(self): return self.header(0xF0, read=False)

    def write_block(self, op, buf, extra=None, save=False):
        """04 18 → 04 op [8]=n → данные → 04 02 [→ 04 F0]."""
        with self.transaction():
            ack = self.header(op, len(buf) // 64, extra)
            self.data(buf)
        if save: self.save()
        return ack

    def transaction(self):
        """04 18 … 04 02: закрываем и при ошибке посреди — иначе следующие посылки уйдут как данные открытой."""
        kb = self

        class T:
            def __enter__(self):
                try:
                    kb.begin()
                except Exception:
                    try:
                        kb.end()
                    except Exception:
                        pass
                    raise
            def __exit__(self, et, *a):
                try:
                    kb.end()
                except Exception:
                    if et is None: raise
        return T()

    # ---- подсветка ----
    def read_user_light(self, rgb=True):
        """04 F5: прочитать свои цвета клавиш (FUN_0042c3b0). Возвращает 144 кортежа (idx, r, g, b)."""
        n = 9 if rgb else 3
        ack = self.header(0xF5, n)
        if not ack or ack[3] != 1:
            raise NoAck(f"04 F5: {ack[:9].hex(' ') if ack else ack}")
        out = b""
        for _ in range(n):
            time.sleep(0.003)
            r = self.cmd_dev.get_feature(65)
            if not r: break
            out += r[1:]
        self.end()
        return [tuple(out[i:i + 4]) for i in range(0, len(out) - 3, 4)] if rgb else list(out)

    @staticmethod
    def rgb_table(colors) -> bytes:
        """colors: {light_index: (r,g,b)} → 576 байт [idx, r, g, b], маркер AA 55 в конце (FUN_0044da00)."""
        b = bytearray(KEYS * 4)
        for i in range(KEYS):
            b[i * 4] = i
        for i, (r, g, bl) in colors.items():
            b[i * 4:i * 4 + 4] = bytes((i, r, g, bl))
        b[-2:] = MARK
        return bytes(b)

    def write_user_light(self, colors, save=False):
        """04 23 [8]=9: записать свои цвета клавиш (FUN_0044da00)."""
        return self.write_block(0x23, self.rgb_table(colors), save=save)

    def light_mode(self, mode, rgb=(255, 255, 255), colorful=1, brightness=5, speed=3, direction=0, save=True):
        """04 13: режим подсветки (FUN_0042c5d0). Поля из t_light_data, разложенные по смещениям структуры
        FUN_00408780: [1..3] color_value (COLORREF: R,G,B), [8] colorful, [9] brightness 0..5,
        [10] speed 0..5, [11] direction. mode 0x80 = своя подсветка (FUN_0044d8f0, [9] = яркость)."""
        r, g, b = rgb
        f = frame({0: mode, 1: r, 2: g, 3: b, 8: colorful, 9: brightness, 10: speed, 11: direction}, mark_at=14)
        return self.write_block(0x13, f, save=save)

    def user_light_mode(self, brightness=5, save=True):
        """Включить режим «своя подсветка» (FUN_0044d8f0): кадр 80 00 00 00 .. [9]=яркость."""
        return self.write_block(0x13, frame({0: 0x80, 9: brightness}, mark_at=14), save=save)

    def live(self, colors, n_blocks=8):
        """04 20: живая подсветка без 04 18 и без сохранения (FUN_004294c0 / FUN_00433ee0).
        Формат данных = как у 04 23, но 8 блоков (512 байт). Проверяется тестом."""
        buf = bytearray(n_blocks * 64)
        for i in range(n_blocks * 16):
            buf[i * 4] = i
        for i, c in colors.items():
            if i < n_blocks * 16:
                buf[i * 4:i * 4 + 4] = bytes((i, *c))
        b = bytearray(64); b[0], b[1], b[8] = 0x04, 0x20, n_blocks
        ack = self.check(0x20, self.send(bytes(b), read=True, delay=self.live_delay))
        self.data(bytes(buf), delay=self.live_delay)
        self.send(b"\x04\x02", read=True, delay=self.live_delay)  # без чтения ответа следующий 04 20 получает FF
        return ack

    live_delay = 0.002  # FUN_00451040: Sleep(5)/Sleep(2) вместо 35 мс; подбирается замером

    # ---- общие настройки ----
    def settings(self, disable_alttab=0, disable_altf4=0, disable_win=0, fn_mode=0, sleep=0, debounce=0):
        """04 17 [2]=1 [8]=1 + кадр 00 01 a b c fn sleep 00 debounce .. AA55@62 (FUN_00414400).
        Флажки — config-ключи disable_alttab/disable_altf4/disable_win. Значения по умолчанию в программе — 0.
        Шкалы fn/sleep/debounce выведены из порядка строк интерфейса; на железе не проверено."""
        with self.transaction():
            ack = self.header(0x17, 1, {2: 1})
            self.data(frame({1: 1, 2: disable_alttab, 3: disable_altf4, 4: disable_win, 5: fn_mode, 6: sleep, 8: debounce}))
        return ack

    # ---- раскладка ----
    def write_keymap(self, entries, fn_layer=False, save=True):
        """04 11 (база) / 04 27 (Fn), 576 байт по 4 на key_index; нули = по умолчанию (FUN_004187b0).
        entries: {key_index: bytes(4)}."""
        b = bytearray(KEYS * 4)
        for k, v in entries.items():
            if not 0 <= k < KEYS:
                raise ValueError(f"номер клавиши {k} вне 0–{KEYS - 1}")   # иначе буфер вырастет и уйдёт кривым
            b[k * 4:k * 4 + 4] = bytes(v)
        b[-2:] = MARK
        return self.write_block(0x27 if fn_layer else 0x11, bytes(b), save=save)

    # ---- макросы ----
    @staticmethod
    def macro_buffer(macros):
        """Буфер макросов (FUN_0042ebc0). macros: список, каждый — список действий:
        ('down', hid) / ('up', hid) / ('mdown', btn) / ('mup', btn) / ('delay', ms).
        Таблица смещений 100 x 4 байта (0xFFFFFFFF = пусто), данные с 400: [n lo, n hi, 0 x6] + n x 4 байта."""
        buf = bytearray(0xE00)
        off = 400
        codes = {"down": 0xB0, "up": 0x30, "mdown": 0x90, "mup": 0x10}
        for i in range(100):
            buf[i * 4:i * 4 + 4] = b"\xff\xff\xff\xff"
        for i, acts in enumerate(macros):
            if not acts: continue
            buf[i * 4:i * 4 + 4] = bytes((off & 0xFF, off >> 8, 0, 0))
            p = off + 8
            for kind, v in acts:
                if kind == "delay":
                    v = max(10, v); buf[p:p + 4] = bytes((v & 0xFF, v >> 8, 0, 0x50))
                else:
                    buf[p:p + 4] = bytes((0, 0, v, codes[kind]))
                p += 4
            buf[off:off + 2] = bytes((len(acts) & 0xFF, len(acts) >> 8))
            off = p
        n = off // 64 + (1 if off % 64 == 0 else 2)  # как в FUN_0042ebc0
        out = bytearray(buf[:n * 64]); out[-2:] = MARK
        return bytes(out)

    def write_macros(self, macros):
        """04 19 → 04 15 [8]=n → данные → 04 02 (без 04 18, как в FUN_0042ebc0)."""
        buf = self.macro_buffer(macros)
        try:
            a = self.header(0x19)
            b = self.header(0x15, len(buf) // 64)
            time.sleep(0.03)
            self.data(buf)
            time.sleep(0.03)
        except Exception:
            try:
                self.end()
            except Exception:
                pass
            raise
        self.end()
        return a, b

    # ---- экран ----
    def select_slot(self, slot):
        """04 28: показать GIF из слота 1..2 (FUN_00423890, первая часть)."""
        with self.transaction():
            ack = self.header(0x28, 1)
            self.data(frame({0: 0x5A, 1: slot}))
            time.sleep(0.08)
        return ack

    def screen_prepare(self, slot):
        """Подготовка перед заливкой, ровно как FUN_00423890: выбор слота + 04 17 с кадром [6]=2 [7]=7 [8]=2.
        Смысл байтов 04 17 / [1]=0 не установлен; официальная программа шлёт их перед каждой заливкой."""
        a = self.select_slot(slot)
        with self.transaction():
            b = self.header(0x17, 1)
            self.data(frame({6: 0x02, 7: 0x07, 8: 0x02}))
            time.sleep(0.08)
        return a, b

    def set_time(self, dt=None, slot=1):
        """04 28: часы экрана (FUN_00424e80)."""
        dt = dt or datetime.datetime.now()
        dow = (dt.isoweekday() % 7)  # SYSTEMTIME.wDayOfWeek: воскресенье = 0
        with self.transaction():
            ack = self.header(0x28, 1)
            self.data(frame({0: 0, 1: slot, 2: 0x5A, 3: dt.year % 2000, 4: dt.month, 5: dt.day,
                             6: dt.hour, 7: dt.minute, 8: dt.second, 10: dow}))
        return ack

    def show_numbers(self, yy, mo, dd, hh, mi, ss=0, slot=2):
        """04 28 с произвольными числами вместо времени: прошивка пишет их в микросхему часов (BCD, I2C, без флеш),
        экран статуса показывает 20yy/mo/dd hh:mi:ss. Пределы по маскам чтения (находка 50): год 0–99, месяц 0–19,
        день 0–39, часы 0–39, минуты и секунды 0–79; больше — прошивка обрежет старшие биты, поэтому отказываем."""
        for name, v, top in (("год", yy, 99), ("месяц", mo, 19), ("день", dd, 39), ("часы", hh, 39),
                             ("минуты", mi, 79), ("секунды", ss, 79)):
            if not isinstance(v, int) or not 0 <= v <= top:
                raise ValueError(f"{name}: {v!r} вне 0…{top}")
        with self.transaction():
            ack = self.header(0x28, 1)
            self.data(frame({0: 0, 1: slot, 2: 0x5A, 3: yy, 4: mo, 5: dd, 6: hh, 7: mi, 8: ss, 10: 0}))
        return ack

    @property
    def img(self):
        if not self._img:
            p = find(DEV + "&mi_02")
            if not p: raise RuntimeError("интерфейс экрана MI_02 не найден")
            self._img = HidDevice(p, overlapped=True)
        return self._img

    def upload(self, slot, frames_rgb565, delays_ms, count_minus_one=False, progress=None):
        """04 72: залить кадры в слот 1..2 (FUN_00423a30). frames_rgb565: список bytes по 64800.
        Заголовок 256 байт: [0] число кадров, [1+i] задержка/2. Остаток буфера FF, блоки по 4096 на MI_02."""
        assert 1 <= len(frames_rgb565) <= GIF_MAX_FRAMES
        head = bytearray(b"\xff" * GIF_HEAD)
        head[0] = len(frames_rgb565) - (1 if count_minus_one else 0)
        for i, d in enumerate(delays_ms):
            head[1 + i] = max(1, min(255, d // 2))
        body = bytes(head) + b"".join(frames_rgb565)
        n = -(-len(body) // 4096)
        body = body.ljust(n * 4096, b"\xff")
        img = self.img                       # интерфейс экрана — до открытия транзакции: его может не быть (ресивер)
        acks, miss = [], 0
        t0 = time.perf_counter()
        with self.transaction():
            ack = self.header(0x72, 0, {2: slot, 8: n & 0xFF, 9: n >> 8})
            for i in range(n):
                w = img.write(b"\0" + body[i * 4096:(i + 1) * 4096])
                r = img.read(65, 300) if w > 0 else None
                acks.append(r)
                miss = miss + 1 if r is None else 0
                if miss >= 3:                # кабель выдернули или клавиатура замолчала: не держим её минутами
                    raise NoAck(f"клавиатура перестала подтверждать блоки экрана (блок {i + 1} из {n})")
                if progress: progress(i + 1, n)
        dt = time.perf_counter() - t0
        return {"ack": ack, "chunks": n, "seconds": dt, "chunk_acks": acks}

    @staticmethod
    def present():
        """Есть ли клавиатура в системе (перечисление устройств, без обращения к ней)."""
        return bool(find(DEV + "&mi_03") or find("vid_0c45&pid_fefe&mi_03"))
