"""Windows: глобальный хук клавиш (только состояние модификаторов и счётчики), активная программа,
раскладка, снимок экрана для Ambilight. Всё на ctypes."""
import ctypes, ctypes.wintypes as wt, threading, os, time

u32 = ctypes.WinDLL("user32", use_last_error=True)
k32 = ctypes.WinDLL("kernel32", use_last_error=True)
gdi = ctypes.WinDLL("gdi32")


class KBD(ctypes.Structure):
    _fields_ = [("vk", wt.DWORD), ("scan", wt.DWORD), ("flags", wt.DWORD), ("time", wt.DWORD), ("extra", ctypes.c_size_t)]


PROC = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, ctypes.c_int, wt.WPARAM, wt.LPARAM)
u32.CallNextHookEx.argtypes = [ctypes.c_void_p, ctypes.c_int, wt.WPARAM, wt.LPARAM]
u32.CallNextHookEx.restype = ctypes.c_ssize_t
u32.SetWindowsHookExW.argtypes = [ctypes.c_int, PROC, ctypes.c_void_p, wt.DWORD]
u32.SetWindowsHookExW.restype = ctypes.c_void_p
u32.GetForegroundWindow.restype = wt.HWND
u32.GetAsyncKeyState.argtypes = [ctypes.c_int]
u32.GetAsyncKeyState.restype = ctypes.c_short
# GDI: без argtypes ctypes режет 64-битные хэндлы («int too long to convert») — Ambilight работал через раз
u32.GetDC.restype = wt.HDC; u32.GetDC.argtypes = [wt.HWND]
u32.ReleaseDC.argtypes = [wt.HWND, wt.HDC]
gdi.CreateCompatibleDC.restype = wt.HDC; gdi.CreateCompatibleDC.argtypes = [wt.HDC]
gdi.CreateCompatibleBitmap.restype = wt.HBITMAP; gdi.CreateCompatibleBitmap.argtypes = [wt.HDC, ctypes.c_int, ctypes.c_int]
gdi.SelectObject.restype = wt.HGDIOBJ; gdi.SelectObject.argtypes = [wt.HDC, wt.HGDIOBJ]
gdi.SetStretchBltMode.argtypes = [wt.HDC, ctypes.c_int]
gdi.StretchBlt.argtypes = [wt.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                           wt.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wt.DWORD]
gdi.GetDIBits.argtypes = [wt.HDC, wt.HBITMAP, wt.UINT, wt.UINT, ctypes.c_void_p, ctypes.c_void_p, wt.UINT]
gdi.DeleteObject.argtypes = [wt.HGDIOBJ]
gdi.DeleteDC.argtypes = [wt.HDC]
k32.OpenProcess.restype = wt.HANDLE

MODS = {0xA2: "ctrl", 0xA3: "ctrl", 0xA0: "shift", 0xA1: "shift", 0xA4: "alt", 0xA5: "alt", 0x5B: "win", 0x5C: "win"}


class KeyWatcher:
    """Хук WH_KEYBOARD_LL. Наружу отдаёт: набор зажатых модификаторов, было ли нажатие не-модификатора
    с момента их зажатия, и (если включено) счётчики нажатий по VK. Последовательности клавиш не хранятся."""

    def __init__(self):
        self.held = set()            # VK зажатых модификаторов
        self.mods_since = 0.0        # когда зажали первый модификатор
        self.other_pressed = False   # нажата обычная клавиша при зажатых модификаторах
        self.counting = False
        self.counts = {}             # vk -> n
        self._counts_lock = threading.Lock()
        self.on_key = None           # колбэк(vk) для вспышек; вызывается из потока хука, должен быть быстрым
        self.on_combo = None         # колбэк(vk, моды) -> True, если это сочетание макроса (combos.py): нажатие глотаем
        # темп печати для «Обзора»: только число нажатий по минутам, без того какие клавиши; в памяти, на диск не пишется
        self._down = set()           # зажатые сейчас VK: автоповтор не считаем
        self.minutes = {}            # минута (int(time/60)) -> нажатий
        self.day, self.today = time.strftime("%Y-%m-%d"), 0
        self._eaten = set()          # VK проглоченных сочетаний: их отпускание тоже глотаем
        self._proc = PROC(self._hook)
        threading.Thread(target=self._loop, name="keyhook", daemon=True).start()

    def mods(self):
        # Хук может не увидеть отпускание: его отпустили в окне с правами администратора (Ctrl+Shift+Esc →
        # Диспетчер задач) или обработчик ответил позже, чем Windows ждёт. Тогда модификатор «залипает» и подсказка
        # горит без конца. Поэтому сверяемся с настоящим состоянием клавиш.
        for v in list(self.held):
            if not (u32.GetAsyncKeyState(v) & 0x8000):
                self.held.discard(v)
        return frozenset(MODS[v] for v in self.held)

    def _hook(self, code, wp, lp):
        try:
            if code == 0:
                k = ctypes.cast(lp, ctypes.POINTER(KBD)).contents
                vk = k.vk
                down = wp in (0x100, 0x104)
                if vk in MODS:
                    if down:
                        if not self.held:
                            self.mods_since = time.monotonic(); self.other_pressed = False
                        self.held.add(vk)
                    else:
                        self.held.discard(vk)
                elif down and self.held:
                    self.other_pressed = True
                    if self.on_combo and not (k.flags & 0x10):
                        mods = self.mods()
                        if mods and self.on_combo(vk, mods):
                            self._eaten.add(vk)
                            return 1
                if not down and vk in self._eaten:
                    self._eaten.discard(vk)
                    return 1
                if not down:
                    self._down.discard(vk)
                elif not (k.flags & 0x10) and vk not in self._down:   # новое нажатие живой рукой
                    self._down.add(vk)
                    m = int(time.time() // 60)
                    self.minutes[m] = self.minutes.get(m, 0) + 1
                    if len(self.minutes) > 90:
                        for old in [x for x in self.minutes if x < m - 60]:
                            del self.minutes[old]
                    day = time.strftime("%Y-%m-%d")
                    if day != self.day:
                        self.day, self.today = day, 0
                    self.today += 1
                if down and not (k.flags & 0x10):          # 0x10 = injected (макросы, SendInput): не считаем
                    if self.counting:
                        with self._counts_lock:
                            self.counts[vk] = self.counts.get(vk, 0) + 1
                    if self.on_key:
                        self.on_key(vk)
        except Exception:
            pass
        return u32.CallNextHookEx(None, code, wp, lp)

    def _loop(self):
        h = u32.SetWindowsHookExW(13, self._proc, None, 0)
        msg = wt.MSG()
        while u32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            u32.TranslateMessage(ctypes.byref(msg)); u32.DispatchMessageW(ctypes.byref(msg))
        u32.UnhookWindowsHookEx(ctypes.c_void_p(h))

    def activity(self):
        """Нажатий в каждую из последних 60 минут (последняя — текущая, неполная) и за сегодня с запуска Studio."""
        m = int(time.time() // 60)
        if time.strftime("%Y-%m-%d") != self.day:
            return {"kpm": [0] * 60, "today": 0, "second": round(time.time() % 60)}
        return {"kpm": [self.minutes.get(x, 0) for x in range(m - 59, m + 1)], "today": self.today,
                "second": round(time.time() % 60)}

    def take_counts(self):
        with self._counts_lock:
            c, self.counts = self.counts, {}
        return c


def foreground():
    """(exe в нижнем регистре, LANGID раскладки) активного окна."""
    hwnd = u32.GetForegroundWindow()
    if not hwnd:
        return "", 0
    pid = wt.DWORD()
    tid = u32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    lang = u32.GetKeyboardLayout(tid) & 0xFFFF
    exe = ""
    h = k32.OpenProcess(0x1000, False, pid.value)   # PROCESS_QUERY_LIMITED_INFORMATION
    if h:
        buf = ctypes.create_unicode_buffer(520); n = wt.DWORD(520)
        if k32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(n)):
            exe = os.path.basename(buf.value).lower()
        k32.CloseHandle(h)
    return exe, lang


class PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [("dwSize", wt.DWORD), ("cntUsage", wt.DWORD), ("th32ProcessID", wt.DWORD), ("th32DefaultHeapID", ctypes.c_size_t),
                ("th32ModuleID", wt.DWORD), ("cntThreads", wt.DWORD), ("th32ParentProcessID", wt.DWORD),
                ("pcPriClassBase", ctypes.c_long), ("dwFlags", wt.DWORD), ("szExeFile", ctypes.c_wchar * 260)]


k32.CreateToolhelp32Snapshot.restype = wt.HANDLE
VENDOR_EXES = {"devicedriver.exe", "lunacy keyboard driver.exe"}


def vendor_app():
    """Путь к запущенной фирменной программе Lunacy или "". Она тоже держит клавиатуру и пишет в неё."""
    snap = k32.CreateToolhelp32Snapshot(2, 0)            # TH32CS_SNAPPROCESS
    if not snap or snap == wt.HANDLE(-1).value:
        return ""
    try:
        pe = PROCESSENTRY32W(); pe.dwSize = ctypes.sizeof(pe)
        ok = k32.Process32FirstW(snap, ctypes.byref(pe))
        while ok:
            if pe.szExeFile.lower() in VENDOR_EXES:
                h = k32.OpenProcess(0x1000, False, pe.th32ProcessID)
                path = pe.szExeFile
                if h:
                    buf = ctypes.create_unicode_buffer(520); n = wt.DWORD(520)
                    if k32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(n)):
                        path = buf.value
                    k32.CloseHandle(h)
                if "lunacy" in path.lower() or pe.szExeFile.lower() != "devicedriver.exe":
                    return path
            ok = k32.Process32NextW(snap, ctypes.byref(pe))
        return ""
    finally:
        k32.CloseHandle(snap)


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [("biSize", wt.DWORD), ("biWidth", wt.LONG), ("biHeight", wt.LONG), ("biPlanes", wt.WORD),
                ("biBitCount", wt.WORD), ("biCompression", wt.DWORD), ("biSizeImage", wt.DWORD),
                ("biXPelsPerMeter", wt.LONG), ("biYPelsPerMeter", wt.LONG), ("biClrUsed", wt.DWORD),
                ("biClrImportant", wt.DWORD)]


def screen_grid(cols=19, rows=6):
    """Рабочий стол, усреднённый до cols x rows (как «Зеркало экрана» официальной программы, FUN_0045d380).
    Возвращает список строк [(r,g,b), ...] сверху вниз."""
    sw, sh = u32.GetSystemMetrics(0), u32.GetSystemMetrics(1)
    src = u32.GetDC(None)
    dc = bmp = old = None
    buf = ctypes.create_string_buffer(cols * rows * 4)
    try:                                              # при любой ошибке DC и битмап освобождаются
        dc = gdi.CreateCompatibleDC(src)
        bmp = gdi.CreateCompatibleBitmap(src, cols, rows)
        old = gdi.SelectObject(dc, bmp)
        gdi.SetStretchBltMode(dc, 4)                  # HALFTONE = усреднение
        gdi.StretchBlt(dc, 0, 0, cols, rows, src, 0, 0, sw, sh, 0x00CC0020)
        bi = BITMAPINFOHEADER(ctypes.sizeof(BITMAPINFOHEADER), cols, -rows, 1, 32, 0, 0, 0, 0, 0, 0)
        gdi.GetDIBits(dc, bmp, 0, rows, buf, ctypes.byref(bi), 0)
    finally:
        if old: gdi.SelectObject(dc, old)
        if bmp: gdi.DeleteObject(bmp)
        if dc: gdi.DeleteDC(dc)
        u32.ReleaseDC(None, src)
    raw = buf.raw
    return [[(raw[(y * cols + x) * 4 + 2], raw[(y * cols + x) * 4 + 1], raw[(y * cols + x) * 4])
             for x in range(cols)] for y in range(rows)]
