"""Значок в трее на ctypes: Shell_NotifyIcon + скрытое окно + контекстное меню."""
import ctypes, ctypes.wintypes as wt, os, struct, math

u32 = ctypes.WinDLL("user32", use_last_error=True)
shell = ctypes.WinDLL("shell32")
k32 = ctypes.WinDLL("kernel32")

WNDPROC = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM)
u32.DefWindowProcW.argtypes = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM]
u32.DefWindowProcW.restype = ctypes.c_ssize_t
u32.CreateWindowExW.restype = wt.HWND
u32.CreateWindowExW.argtypes = [wt.DWORD, wt.LPCWSTR, wt.LPCWSTR, wt.DWORD, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                                ctypes.c_int, wt.HWND, wt.HMENU, wt.HINSTANCE, ctypes.c_void_p]
u32.TrackPopupMenu.argtypes = [wt.HMENU, wt.UINT, ctypes.c_int, ctypes.c_int, ctypes.c_int, wt.HWND, ctypes.c_void_p]
u32.AppendMenuW.argtypes = [wt.HMENU, wt.UINT, ctypes.c_size_t, wt.LPCWSTR]
u32.DestroyMenu.argtypes = [wt.HMENU]
u32.PostMessageW.argtypes = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM]
u32.LoadImageW.restype = wt.HANDLE
u32.CreatePopupMenu.restype = wt.HMENU
k32.GetModuleHandleW.restype = wt.HMODULE

WM_APP_TRAY = 0x8001
WM_COMMAND, WM_DESTROY, WM_LBUTTONUP, WM_RBUTTONUP, WM_CLOSE = 0x0111, 0x0002, 0x0202, 0x0205, 0x0010


class WNDCLASS(ctypes.Structure):
    _fields_ = [("style", wt.UINT), ("lpfnWndProc", WNDPROC), ("cbClsExtra", ctypes.c_int), ("cbWndExtra", ctypes.c_int),
                ("hInstance", wt.HINSTANCE), ("hIcon", wt.HICON), ("hCursor", wt.HANDLE), ("hbrBackground", wt.HBRUSH),
                ("lpszMenuName", wt.LPCWSTR), ("lpszClassName", wt.LPCWSTR)]


class NOTIFYICONDATA(ctypes.Structure):
    _fields_ = [("cbSize", wt.DWORD), ("hWnd", wt.HWND), ("uID", wt.UINT), ("uFlags", wt.UINT),
                ("uCallbackMessage", wt.UINT), ("hIcon", wt.HICON), ("szTip", wt.WCHAR * 128),
                ("dwState", wt.DWORD), ("dwStateMask", wt.DWORD), ("szInfo", wt.WCHAR * 256),
                ("uVersion", wt.UINT), ("szInfoTitle", wt.WCHAR * 64), ("dwInfoFlags", wt.DWORD)]


def make_icon(path, size=32):
    """Полумесяц: круг минус смещённый круг, фиолетово-голубой градиент. ICO с 32-битным DIB."""
    px = bytearray()
    for y in range(size - 1, -1, -1):          # DIB снизу вверх
        for x in range(size):
            cx, cy = x + 0.5 - size / 2, y + 0.5 - size / 2
            r = size * 0.44
            inside = cx * cx + cy * cy <= r * r
            cut = (cx - size * 0.2) ** 2 + (cy + size * 0.06) ** 2 <= (r * 0.86) ** 2
            if inside and not cut:
                t = (y / size)
                b, g, rr = int(255 - 40 * t), int(120 + 100 * t), int(170 - 120 * t)
                px += bytes((b, g, rr, 255))
            else:
                px += b"\0\0\0\0"
    mask = bytes(((size + 31) // 32) * 4 * size)
    dib = struct.pack("<IiiHHIIiiII", 40, size, size * 2, 1, 32, 0, len(px) + len(mask), 0, 0, 0, 0) + bytes(px) + mask
    ico = struct.pack("<HHH", 0, 1, 1) + struct.pack("<BBBBHHII", size, size, 0, 0, 1, 32, len(dib), 22) + dib
    with open(path, "wb") as f:
        f.write(ico)


class Tray:
    def __init__(self, icon_path, tip, items):
        """items: [(текст, callback | None для разделителя, checked_fn | None)]"""
        self.items = items
        self._proc = WNDPROC(self._wndproc)
        hinst = k32.GetModuleHandleW(None)
        wc = WNDCLASS(); wc.lpfnWndProc = self._proc; wc.hInstance = hinst; wc.lpszClassName = "LunacyStudioTray"
        u32.RegisterClassW(ctypes.byref(wc))
        self.hwnd = u32.CreateWindowExW(0, "LunacyStudioTray", "Lunacy Studio", 0, 0, 0, 0, 0, None, None, hinst, None)
        self.hicon = u32.LoadImageW(None, icon_path, 1, 0, 0, 0x10 | 0x40)   # IMAGE_ICON, LOADFROMFILE|DEFAULTSIZE
        self.nid = NOTIFYICONDATA(); self.nid.cbSize = ctypes.sizeof(NOTIFYICONDATA)
        self.nid.hWnd = self.hwnd; self.nid.uID = 1; self.nid.uFlags = 0x1 | 0x2 | 0x4
        self.nid.uCallbackMessage = WM_APP_TRAY; self.nid.hIcon = self.hicon; self.nid.szTip = tip
        shell.Shell_NotifyIconW(0, ctypes.byref(self.nid))   # NIM_ADD

    def notify(self, title, text):
        self.nid.uFlags = 0x10; self.nid.szInfoTitle = title[:63]; self.nid.szInfo = text[:255]; self.nid.dwInfoFlags = 1
        shell.Shell_NotifyIconW(1, ctypes.byref(self.nid))   # NIM_MODIFY

    def _menu(self):
        m = u32.CreatePopupMenu()
        for i, (text, cb, checked) in enumerate(self.items):
            if cb is None:
                u32.AppendMenuW(m, 0x800, 0, None)
            else:
                u32.AppendMenuW(m, 0x8 if (checked and checked()) else 0, 1000 + i, text)
        pt = wt.POINT(); u32.GetCursorPos(ctypes.byref(pt))
        u32.SetForegroundWindow(self.hwnd)
        u32.TrackPopupMenu(m, 0, pt.x, pt.y, 0, self.hwnd, None)
        u32.DestroyMenu(m)

    def _wndproc(self, hwnd, msg, wp, lp):
        if msg == WM_APP_TRAY:
            if lp == WM_RBUTTONUP:
                self._menu()
            elif lp == WM_LBUTTONUP:
                self.items[0][1]()
            return 0
        if msg == WM_COMMAND and 1000 <= (wp & 0xFFFF) < 1000 + len(self.items):
            self.items[(wp & 0xFFFF) - 1000][1]()
            return 0
        if msg == WM_DESTROY:
            shell.Shell_NotifyIconW(2, ctypes.byref(self.nid))   # NIM_DELETE
            u32.PostQuitMessage(0)
            return 0
        return u32.DefWindowProcW(hwnd, msg, wp, lp)

    def close(self):
        u32.PostMessageW(self.hwnd, WM_CLOSE, 0, 0)

    def loop(self):
        msg = wt.MSG()
        while u32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            u32.TranslateMessage(ctypes.byref(msg)); u32.DispatchMessageW(ctypes.byref(msg))
