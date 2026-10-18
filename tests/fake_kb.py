"""Заглушка клавиатуры для сквозных проверок Studio без железа: тот интерфейс lunacy.Keyboard, которым пользуется
studio/, в устройство ничего не уходит. Блоки экрана (04 72, 04 38) идут с задержкой, чтобы были видны прогресс
и блокировка остальных операций. FakeKeyboard.fail_at = N — с N-го блока экрана клавиатура «молчит» (обрыв кабеля)."""
import contextlib, hashlib, time

ACK = bytes([0x00, 0x01, 0x5A, 0x02]) + bytes(61)      # ответ блока экрана, как в work/spi/runs


class FakeImg:
    def __init__(self, kb):
        self.kb, self.n = kb, 0

    def write(self, buf):
        time.sleep(FakeKeyboard.block_delay)
        self.n += 1
        self.kb.blocks.append(len(buf))
        self.kb.sha.update(buf[1:])
        return len(buf)

    def read(self, size, timeout):
        fail = FakeKeyboard.fail_at
        return None if fail is not None and self.n >= fail else ACK[:size]


class FakeKeyboard:
    block_delay = 0.002
    fail_at = None
    wireless_next = False
    calls = []                       # общий журнал всех экземпляров: (команда, аргументы)
    last = None                      # последний открытый экземпляр

    def __init__(self, *a, **kw):
        self.wireless = FakeKeyboard.wireless_next
        self.wrote = False
        self.blocks, self.sha = [], hashlib.sha256()
        self._img = FakeImg(self)
        FakeKeyboard.last = self

    @staticmethod
    def present():
        return True

    def info(self):
        return {"model": "Lunacy In Space", "manufacturer": "заглушка", "product": "fake", "firmware": "1.12",
                "vid": "05AC", "pid": "024F", "connection": "2.4g" if self.wireless else "usb"}

    def close(self):
        pass

    def _log(self, name, *a):
        FakeKeyboard.calls.append((name, a))

    @property
    def img(self):
        if self.wireless:
            raise RuntimeError("интерфейс экрана MI_02 не найден")
        return self._img

    def header(self, op, n=0, extra=None, read=True):
        self._log("header", op, n, extra)
        self._img.n = 0                  # fail_at считается от начала каждой передачи
        return bytes([0x04, op, 0, 1]) + bytes(60)

    @contextlib.contextmanager
    def transaction(self):
        self._log("begin")
        try:
            yield
        finally:
            self._log("end")

    def live(self, colors, n_blocks=8):
        pass                         # кадры живой подсветки идут 10 раз в секунду, в журнал не пишем

    def upload(self, slot, frames, delays, count_minus_one=False, progress=None):
        self._log("upload", slot, len(frames))
        n = -(-(256 + len(frames) * 64800) // 4096)
        t0, acks = time.perf_counter(), []
        img = self.img
        with self.transaction():
            for i in range(n):
                img.write(b"\0" + bytes(4096))
                acks.append(img.read(65, 300))
                if progress:
                    progress(i + 1, n)
        return {"ack": None, "chunks": n, "seconds": time.perf_counter() - t0, "chunk_acks": acks}


def _write(name):
    def fn(self, *a, **kw):
        self.wrote = True
        self._log(name, *a)
    return fn


for _n in ("light_mode", "user_light_mode", "write_user_light", "settings", "write_keymap", "write_macros",
           "select_slot", "screen_prepare", "set_time", "show_numbers"):
    setattr(FakeKeyboard, _n, _write(_n))
