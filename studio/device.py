"""Единственный владелец клавиатуры: все потоки ходят через DeviceManager под одним замком.
Длинные операции (заливка экрана) держат замок целиком: транзакцию 04 18..04 02 нельзя перемежать."""
import threading, time, logging, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from lunacy import Keyboard, NoAck, Refused  # noqa: E402

log = logging.getLogger("device")


class Offline(Exception):
    pass


class Busy(Exception):
    """Клавиатура занята длинной операцией (заливка экрана, профиль): запрос не ждёт её минутами."""


class DeviceManager:
    def __init__(self):
        self.lock = threading.Lock()
        self.kb = None
        self.last_error = None
        self.busy = None            # текст длинной операции для интерфейса
        self.info = None            # Keyboard.info(), пока подключена
        self.on_connect = []        # колбэки после подключения
        self._stop = False
        if os.environ.get("LUNACY_NO_DEVICE") == "1":       # проверки сборки и CI: клавиатуру не открываем вовсе
            self.last_error = "клавиатура отключена переменной LUNACY_NO_DEVICE"
            return
        threading.Thread(target=self._watch, name="device-watch", daemon=True).start()

    @property
    def connected(self):
        return self.kb is not None

    def _open(self):
        try:
            kb = Keyboard()
        except Exception as e:
            self.last_error = str(e)
            return False
        self.kb = kb
        self.last_error = None
        try:
            self.info = kb.info()
        except Exception as e:
            log.warning("атрибуты устройства: %s", e)
            self.info = None
        log.info("клавиатура подключена")
        for cb in self.on_connect:
            threading.Thread(target=cb, daemon=True).start()
        return True

    def _drop(self, err):
        log.warning("связь потеряна: %s", err)
        self.last_error = str(err)
        try:
            self.kb.close()
        except Exception:
            pass
        self.kb = None
        self.info = None

    def _watch(self):
        while not self._stop:
            if self.kb is None:
                with self.lock:
                    if self.kb is None:
                        self._open()
            elif not Keyboard.present():
                # кабель выдернули в простое: ввод-вывода не было, и без этой проверки мы бы думали, что связь есть
                if self.lock.acquire(timeout=1):
                    try:
                        if self.kb is not None and not Keyboard.present():
                            self._drop("клавиатура отключена")
                    finally:
                        self.lock.release()
            time.sleep(2)

    def run(self, fn, busy=None, wait=3.0):
        """Выполнить fn(kb) под замком. Ошибка связи закрывает устройство; переподключение — в фоне.
        wait — сколько ждать занятую клавиатуру (None — сколько потребуется: так ждут фоновые задачи)."""
        if self._stop:
            raise Offline("сервис выключается")
        if not self.lock.acquire(timeout=-1 if wait is None else wait):
            raise Busy(f"клавиатура занята: {self.busy or 'идёт другая операция'}. Повтори, когда закончится")
        try:
            if self.kb is None and not self._open():
                raise Offline(self.last_error or "клавиатура не подключена")
            self.busy = busy
            try:
                return fn(self.kb)
            except Refused as e:
                log.warning("отказ клавиатуры (%s): %s", busy, e)
                raise                         # клавиатура ответила отказом: связь жива, устройство не закрываем
            except (NoAck, OSError) as e:
                self._drop(e)
                raise Offline(f"клавиатура не ответила: {e}")
            finally:
                self.busy = None
        finally:
            self.lock.release()

    def try_run(self, fn):
        """Для живой подсветки: если замок занят (идёт заливка), кадр пропускается."""
        if not self.lock.acquire(blocking=False):
            return None
        try:
            if self.kb is None:
                return None
            try:
                return fn(self.kb)
            except Refused as e:
                now = time.monotonic()        # кадр не принят (вклинилась другая программа) — пропускаем
                if now - getattr(self, "_refused_at", 0) > 60:
                    log.warning("живой кадр отклонён: %s", e); self._refused_at = now
                return None
            except (NoAck, OSError) as e:
                self._drop(e)
                return None
        finally:
            self.lock.release()

    def stop(self):
        self._stop = True
        with self.lock:
            if self.kb:
                self.kb.close()
                self.kb = None
                self.info = None
