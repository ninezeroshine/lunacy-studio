"""Макрос на сочетание клавиш (Ctrl+Shift+M и т. п.) — программно, силами Studio.

Прошивка вешает макрос только на одну физическую клавишу (или Fn + клавиша). Сочетание ловит хук WH_KEYBOARD_LL
Studio: нажатие проглатывается, программа под ним его не видит, а макрос из профиля проигрывается через SendInput,
когда отпустишь клавиши сочетания (иначе зажатый Ctrl смешается с шагами макроса). Работает, пока запущена Studio.
"""
import ctypes, ctypes.wintypes as wt, threading, time, logging

from . import keys as K

log = logging.getLogger("studio.combos")
MOD_NAMES = ("ctrl", "shift", "alt", "win")
_MOD_HIDS = range(0xE0, 0xE8)
# Только Shift + печатная клавиша — это просто заглавная буква или знак: такое сочетание сломало бы набор текста.
_PRINTABLE = set(range(0x04, 0x39)) - {0x28, 0x29, 0x2A, 0x2B}


def check(triggers, n_macros):
    """Проверить и привести к виду [{"mods": [...], "hid": int, "macro": int}]. Граница доверия: тело запроса."""
    if not isinstance(triggers, list) or len(triggers) > 100:
        raise ValueError("сочетания: нужен список, не больше 100")
    out, seen = [], set()
    for t in triggers:
        if not isinstance(t, dict):
            raise ValueError("сочетание: нужен объект")
        mods = t.get("mods")
        if not isinstance(mods, list) or not mods or any(m not in MOD_NAMES for m in mods):
            raise ValueError("сочетание: нужен хотя бы один из Ctrl, Shift, Alt, Win")
        hid, macro = int(t.get("hid", -1)), int(t.get("macro", -1))
        if hid in _MOD_HIDS or hid not in K.HID_TO_VK:
            raise ValueError(f"сочетание: клавиша {hid:#x} не подходит")
        if not 0 <= macro < n_macros:
            raise ValueError(f"сочетание: макроса {macro + 1} нет")
        mods = sorted(set(mods), key=MOD_NAMES.index)
        if mods == ["shift"] and hid in _PRINTABLE:
            raise ValueError("Shift + буква или знак — это обычный набор текста; добавь Ctrl, Alt или Win")
        key = (tuple(mods), hid)
        if key in seen:
            raise ValueError("одно и то же сочетание назначено дважды")
        seen.add(key)
        out.append({"mods": mods, "hid": hid, "macro": macro})
    return out


# ---------- SendInput ----------
class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", wt.WORD), ("wScan", wt.WORD), ("dwFlags", wt.DWORD), ("time", wt.DWORD), ("dwExtraInfo", ctypes.c_size_t)]


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", wt.LONG), ("dy", wt.LONG), ("mouseData", wt.DWORD), ("dwFlags", wt.DWORD), ("time", wt.DWORD),
                ("dwExtraInfo", ctypes.c_size_t)]


class _U(ctypes.Union):
    _fields_ = [("ki", KEYBDINPUT), ("mi", MOUSEINPUT), ("pad", ctypes.c_byte * 32)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", wt.DWORD), ("u", _U)]


u32 = ctypes.WinDLL("user32", use_last_error=True)
u32.SendInput.argtypes = [wt.UINT, ctypes.POINTER(INPUT), ctypes.c_int]
u32.MapVirtualKeyW.argtypes = [wt.UINT, wt.UINT]
u32.GetAsyncKeyState.argtypes = [ctypes.c_int]
u32.GetAsyncKeyState.restype = ctypes.c_short
# стрелки, навигация, правые Ctrl/Alt, Win, «/» и Enter цифрового блока — расширенные клавиши
_EXTENDED = {0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0xA3, 0xA5, 0x5B, 0x5C, 0x6F, 0x2C, 0x90}
_MOUSE = {1: (0x0002, 0x0004, 0), 2: (0x0008, 0x0010, 0), 4: (0x0020, 0x0040, 0), 8: (0x0080, 0x0100, 1), 16: (0x0080, 0x0100, 2)}
MASK_VK = 0xE8   # «пустая» клавиша: после проглоченного Win/Alt+клавиша не даёт открыться меню Пуск и строке меню


def _key(vk, up=False, numpad_enter=False):
    flags = (0x0002 if up else 0) | (0x0001 if vk in _EXTENDED or numpad_enter else 0)
    i = INPUT(type=1); i.u.ki = KEYBDINPUT(vk, u32.MapVirtualKeyW(vk, 0), flags, 0, 0)
    return i


def send(inputs):
    if inputs:
        arr = (INPUT * len(inputs))(*inputs)
        u32.SendInput(len(inputs), arr, ctypes.sizeof(INPUT))


def to_inputs(action):
    """Шаг макроса → события SendInput (или задержка в секундах)."""
    kind, val = action[0], int(action[1])
    if kind == "delay":
        return val / 1000.0
    if kind in ("down", "up"):
        vk = K.HID_TO_VK.get(val)
        return [_key(vk, kind == "up", numpad_enter=val == 0x58)] if vk else []
    if kind in ("mdown", "mup"):
        out = []
        for bit, (dn, upf, x) in _MOUSE.items():
            if val & bit:
                i = INPUT(type=0); i.u.mi = MOUSEINPUT(0, 0, x, dn if kind == "mdown" else upf, 0, 0)
                out.append(i)
        return out
    return []


# ---------- движок ----------
class Combos:
    """Держит таблицу сочетаний (vk, моды) → номер макроса и проигрывает макросы. on_key вызывается из потока хука
    и должен отвечать быстро: только сверка с таблицей и постановка в очередь."""

    def __init__(self, store, watcher=None, sender=send, pressed=None):
        self.store, self.sender = store, sender
        self.pressed = pressed or (lambda vk: u32.GetAsyncKeyState(vk) & 0x8000)   # тесты подменяют: им не важна настоящая клавиатура
        self.table = {}
        self.playing = False
        self.last = None                    # (сочетание, имя макроса, время) — для интерфейса
        self._lock = threading.Lock()
        self.reload()
        if watcher is not None:
            watcher.on_combo = self.on_key

    def reload(self):
        table = {}
        for t in self.store.get("triggers") or []:
            vk = K.HID_TO_VK.get(t["hid"])
            if vk is not None:
                table[(frozenset(t["mods"]), vk)] = t["macro"]
        self.table = table

    def on_key(self, vk, mods):
        """True — сочетание наше: хук его проглатывает."""
        idx = self.table.get((frozenset(mods), vk))
        if idx is None:
            return False
        if not self.playing:
            threading.Thread(target=self._play, args=(idx, set(mods), vk), name="combo", daemon=True).start()
        return True

    def _wait_release(self, mods, vk, timeout=3.0):
        vks = [vk] + [v for m in mods for v in K.MOD_VK[m]]
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if not any(self.pressed(v) for v in vks):
                return True
            time.sleep(0.01)
        return False

    def _play(self, idx, mods, vk, wait=True):
        with self._lock:
            if self.playing:
                return
            self.playing = True
        try:
            macros = self.store.get("macros") or []
            if not 0 <= idx < len(macros):
                return
            m = macros[idx]
            if mods & {"alt", "win"}:            # пока Win/Alt ещё зажаты: «пустая» клавиша, чтобы не открылись Пуск и меню
                self.sender([_key(MASK_VK), _key(MASK_VK, up=True)])
            if wait and not self._wait_release(mods, vk):
                log.info("сочетание: клавиши не отпустили за 3 с, макрос «%s» не проигран", m.get("name"))
                return
            held = {}                           # (мышь?, код) → шаг «отпустить»
            for a in m.get("actions") or []:
                r = to_inputs(a)
                if isinstance(r, float):
                    time.sleep(min(r, 10.0))
                    continue
                self.sender(r)
                k = (a[0][0] == "m", int(a[1]))
                if a[0] in ("down", "mdown"):
                    held[k] = ["mup" if k[0] else "up", k[1]]
                else:
                    held.pop(k, None)
            for up in held.values():            # недоделанный макрос не оставляет зажатых клавиш
                self.sender(to_inputs(up))
            self.last = ("+".join(sorted(mods)), m.get("name"), time.time())
        except Exception:
            log.exception("сочетание: проигрывание")
        finally:
            self.playing = False
