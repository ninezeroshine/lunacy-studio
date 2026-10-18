"""Минимальный HID-доступ на Windows через hid.dll / setupapi / kernel32 (ctypes, без зависимостей)."""
import ctypes, ctypes.wintypes as wt
from ctypes import byref, sizeof, Structure, c_ushort, c_ulong, c_void_p

hid = ctypes.WinDLL("hid")
setup = ctypes.WinDLL("setupapi")
k32 = ctypes.WinDLL("kernel32", use_last_error=True)
k32.CreateFileW.restype = c_void_p
k32.CreateEventW.restype = c_void_p
setup.SetupDiGetClassDevsW.restype = c_void_p
INVALID = c_void_p(-1).value


class GUID(Structure):
    _fields_ = [("d1", c_ulong), ("d2", c_ushort), ("d3", c_ushort), ("d4", ctypes.c_ubyte * 8)]


class _IFDATA(Structure):
    _fields_ = [("cbSize", wt.DWORD), ("guid", GUID), ("flags", wt.DWORD), ("res", ctypes.c_size_t)]


class _ATTRS(Structure):
    _fields_ = [("Size", c_ulong), ("VendorID", c_ushort), ("ProductID", c_ushort), ("VersionNumber", c_ushort)]


class OVERLAPPED(Structure):
    _fields_ = [("Internal", ctypes.c_size_t), ("InternalHigh", ctypes.c_size_t),
                ("Offset", wt.DWORD), ("OffsetHigh", wt.DWORD), ("hEvent", c_void_p)]


def device_paths():
    g = GUID(); hid.HidD_GetHidGuid(byref(g))
    h = setup.SetupDiGetClassDevsW(byref(g), None, None, 0x12)  # PRESENT | DEVICEINTERFACE
    out, i = [], 0
    try:
        while True:
            d = _IFDATA(); d.cbSize = sizeof(d)
            if not setup.SetupDiEnumDeviceInterfaces(c_void_p(h), None, byref(g), i, byref(d)):
                return out
            i += 1
            need = wt.DWORD()
            setup.SetupDiGetDeviceInterfaceDetailW(c_void_p(h), byref(d), None, 0, byref(need), None)
            buf = ctypes.create_string_buffer(need.value)
            ctypes.cast(buf, ctypes.POINTER(wt.DWORD))[0] = 8 if sizeof(c_void_p) == 8 else 6
            if setup.SetupDiGetDeviceInterfaceDetailW(c_void_p(h), byref(d), buf, need, None, None):
                out.append(ctypes.wstring_at(ctypes.addressof(buf) + 4))
    finally:
        setup.SetupDiDestroyDeviceInfoList(c_void_p(h))


def find(tag):
    tag = tag.lower()
    return next((p for p in device_paths() if tag in p.lower()), None)


class HidDevice:
    """Открытый HID-интерфейс. overlapped=True нужен для чтения input-отчётов с таймаутом."""

    def __init__(self, path, overlapped=False):
        self.path = path
        flags = 0x40000000 if overlapped else 0
        h = k32.CreateFileW(path, 0xC0000000, 3, None, 3, flags, None)
        if h in (None, INVALID):
            raise OSError(ctypes.get_last_error(), f"не открыть {path}")
        self.h = c_void_p(h)
        self.overlapped = overlapped

    def close(self):
        if self.h:
            k32.CloseHandle(self.h); self.h = None

    def __enter__(self): return self
    def __exit__(self, *a): self.close()

    def attributes(self):
        """HidD_GetAttributes: (vid, pid, VersionNumber = bcdDevice) или None."""
        a = _ATTRS(); a.Size = sizeof(a)
        return (a.VendorID, a.ProductID, a.VersionNumber) if hid.HidD_GetAttributes(self.h, byref(a)) else None

    def strings(self):
        """(производитель, продукт) из строковых дескрипторов USB; None, если устройство не отдало."""
        out = []
        for fn in (hid.HidD_GetManufacturerString, hid.HidD_GetProductString):
            b = ctypes.create_unicode_buffer(127)            # предел HID: 126 символов + 0
            out.append(b.value or None if fn(self.h, b, sizeof(b)) else None)
        return tuple(out)

    def set_feature(self, data: bytes) -> bool:
        b = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
        return bool(hid.HidD_SetFeature(self.h, b, len(data)))

    def get_feature(self, size: int, report_id=0):
        b = (ctypes.c_ubyte * size)(); b[0] = report_id
        return bytes(b) if hid.HidD_GetFeature(self.h, b, size) else None

    def _io(self, fn, buf, size, timeout_ms):
        ov = OVERLAPPED(); ov.hEvent = k32.CreateEventW(None, True, False, None)
        try:
            n = wt.DWORD()
            if not fn(self.h, buf, size, byref(n), byref(ov)):
                if ctypes.get_last_error() != 997:  # ERROR_IO_PENDING
                    return None
                if k32.WaitForSingleObject(c_void_p(ov.hEvent), timeout_ms) != 0:
                    # дождаться, пока ядро действительно отпустит буфер и OVERLAPPED, иначе оно допишет в освобождённую память
                    k32.CancelIo(self.h); k32.GetOverlappedResult(self.h, byref(ov), byref(n), True)
                    return None
                if not k32.GetOverlappedResult(self.h, byref(ov), byref(n), False):
                    return None
            return n.value
        finally:
            k32.CloseHandle(c_void_p(ov.hEvent))

    def write(self, data: bytes, timeout_ms=1000) -> int:
        b = ctypes.create_string_buffer(bytes(data), len(data))
        if not self.overlapped:
            n = wt.DWORD()
            return n.value if k32.WriteFile(self.h, b, len(data), byref(n), None) else -1
        r = self._io(k32.WriteFile, b, len(data), timeout_ms)
        return -1 if r is None else r

    def read(self, size: int, timeout_ms=300):
        assert self.overlapped, "read с таймаутом требует overlapped=True"
        b = ctypes.create_string_buffer(size)
        r = self._io(k32.ReadFile, b, size, timeout_ms)
        return None if r is None else b.raw[:r]
