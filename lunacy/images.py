"""Картинки для экрана 240x135: загрузка любых форматов GDI+ (GIF с кадрами, PNG, JPG, BMP) и RGB565.
GDI+ встроен в Windows, тот же путь использует официальная программа (FUN_0045d380)."""
import ctypes, struct, zlib
from ctypes import byref, c_void_p, c_uint, c_int, Structure

W, H = 240, 135
gdip = ctypes.WinDLL("gdiplus")
PixelFormat32bppARGB = 0x26200A
PropertyTagFrameDelay = 0x5100


class _Startup(Structure):
    _fields_ = [("ver", c_uint), ("cb", c_void_p), ("noThread", c_int), ("noCodecs", c_int)]


class _Rect(Structure):
    _fields_ = [("X", c_int), ("Y", c_int), ("W", c_int), ("H", c_int)]


class _BitmapData(Structure):
    _fields_ = [("Width", c_uint), ("Height", c_uint), ("Stride", c_int), ("PixelFormat", c_int),
                ("Scan0", c_void_p), ("Reserved", c_void_p)]


_token = ctypes.c_size_t()
_st = _Startup(1, None, 0, 0)
assert gdip.GdiplusStartup(byref(_token), byref(_st), None) == 0


def _check(st, what):
    if st != 0:
        raise OSError(f"GDI+ {what}: статус {st}")


def _render(img, fit):
    """Нарисовать текущий кадр img в 240x135 ARGB. fit: 'stretch' | 'cover' | 'contain'."""
    bmp = c_void_p(); _check(gdip.GdipCreateBitmapFromScan0(W, H, 0, PixelFormat32bppARGB, None, byref(bmp)), "bitmap")
    try:                                 # объекты GDI+ освобождаются и при ошибке посреди
        return _draw(img, fit, bmp)
    finally:
        gdip.GdipDisposeImage(bmp)


def _draw(img, fit, bmp):
    g = c_void_p(); _check(gdip.GdipGetImageGraphicsContext(bmp, byref(g)), "graphics")
    try:
        _paint(img, fit, g)
    finally:
        gdip.GdipDeleteGraphics(g)
    rect = _Rect(0, 0, W, H); bd = _BitmapData()
    _check(gdip.GdipBitmapLockBits(bmp, byref(rect), 1, PixelFormat32bppARGB, byref(bd)), "lock")
    try:
        rows = [ctypes.string_at(bd.Scan0 + y * bd.Stride, W * 4) for y in range(H)]
    finally:
        gdip.GdipBitmapUnlockBits(bmp, byref(bd))
    return b"".join(rows)  # BGRA


def _paint(img, fit, g):
    gdip.GdipSetInterpolationMode(g, 7)  # HighQualityBicubic
    gdip.GdipGraphicsClear(g, c_uint(0xFF000000))
    iw, ih = c_uint(), c_uint()
    gdip.GdipGetImageWidth(img, byref(iw)); gdip.GdipGetImageHeight(img, byref(ih))
    x, y, w, h = 0, 0, W, H
    if fit in ("cover", "contain") and iw.value and ih.value:
        k = (max if fit == "cover" else min)(W / iw.value, H / ih.value)
        w, h = round(iw.value * k), round(ih.value * k)
        x, y = (W - w) // 2, (H - h) // 2
    _check(gdip.GdipDrawImageRectI(g, img, x, y, w, h), "draw")


class Frames(list):
    """Кадры [(bgra, delay_ms)] и сколько их было в файле всего (total) — лишние не декодируются."""
    total = 0


def load(path, fit="cover", max_frames=None):
    """Вернуть Frames [(bgra_bytes, delay_ms)]: не больше max_frames кадров; total — сколько в файле.
    Длинную GIF не декодируем целиком: 1000 кадров — это ~130 МБ и секунды GDI+ ради отброшенного."""
    img = c_void_p(); _check(gdip.GdipLoadImageFromFile(ctypes.c_wchar_p(str(path)), byref(img)), f"загрузка {path}")
    try:
        ndim = c_uint(); gdip.GdipImageGetFrameDimensionsCount(img, byref(ndim))
        dims = (ctypes.c_byte * (16 * max(1, ndim.value)))()
        gdip.GdipImageGetFrameDimensionsList(img, dims, ndim)
        count = c_uint(1); gdip.GdipImageGetFrameCount(img, dims, byref(count))
        delays = [100] * count.value
        size = c_uint()
        if gdip.GdipGetPropertyItemSize(img, PropertyTagFrameDelay, byref(size)) == 0 and size.value:
            buf = ctypes.create_string_buffer(size.value)
            if gdip.GdipGetPropertyItem(img, PropertyTagFrameDelay, size, buf) == 0:
                _id, length, _type, value = struct.unpack_from("<IIH6xQ" if ctypes.sizeof(c_void_p) == 8 else "<IIH2xI", buf.raw)
                raw = ctypes.string_at(value, length)
                delays = [max(20, d * 10) for d in struct.unpack(f"<{length // 4}I", raw)][:count.value]
        frames = Frames(); frames.total = count.value
        for i in range(min(count.value, max_frames or count.value)):
            gdip.GdipImageSelectActiveFrame(img, dims, i)
            frames.append((_render(img, fit), delays[i] if i < len(delays) else 100))
        return frames
    finally:
        gdip.GdipDisposeImage(img)


def rgb565(bgra: bytes, big_endian=False) -> bytes:
    out = bytearray(W * H * 2)
    fmt = ">H" if big_endian else "<H"
    for i in range(W * H):
        b, g, r = bgra[i * 4], bgra[i * 4 + 1], bgra[i * 4 + 2]
        struct.pack_into(fmt, out, i * 2, ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3))
    return bytes(out)


def bgra_from_rgb565(data: bytes, w=W, h=H) -> bytes:
    """RGB565 LE → BGRA (для миниатюры кадра, собранного редактором в браузере)."""
    out = bytearray(w * h * 4)
    for i, (v,) in enumerate(struct.iter_unpack("<H", data[:w * h * 2])):
        r, g, b = v >> 11, (v >> 5) & 63, v & 31
        out[i * 4:i * 4 + 4] = bytes(((b << 3) | (b >> 2), (g << 2) | (g >> 4), (r << 3) | (r >> 2), 255))
    return bytes(out)


def png(bgra: bytes, w=W, h=H) -> bytes:
    """PNG (RGB, 8 бит) из BGRA без зависимостей: zlib и crc32 из stdlib."""
    rows = bytearray()
    for y in range(h):
        line = bytearray(bgra[y * w * 4:(y + 1) * w * 4])
        rgb = bytearray(w * 3)
        rgb[0::3], rgb[1::3], rgb[2::3] = line[2::4], line[1::4], line[0::4]
        rows += b"\0" + rgb                                   # фильтр 0 у каждой строки

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(rows), 6)) + chunk(b"IEND", b""))


def labeled_pattern() -> bytes:
    """BGRA: 8 полос по 30 px с крупными цифрами 0..7, белая линия в верхней строке, красная в нижней.
    По цифре у левого края экрана сдвиг читается однозначно."""
    cols = [0xFFC00000, 0xFF00A000, 0xFF0000C0, 0xFF808000, 0xFF008080, 0xFF800080, 0xFF404040, 0xFFA05000]
    bmp = c_void_p(); _check(gdip.GdipCreateBitmapFromScan0(W, H, 0, PixelFormat32bppARGB, None, byref(bmp)), "bitmap")
    g = c_void_p(); gdip.GdipGetImageGraphicsContext(bmp, byref(g))
    gdip.GdipSetTextRenderingHint(g, 4)  # AntiAlias
    fam = c_void_p(); _check(gdip.GdipCreateFontFamilyFromName(ctypes.c_wchar_p("Arial"), None, byref(fam)), "font family")
    font = c_void_p(); gdip.GdipCreateFont(fam, ctypes.c_float(26), 1, 2, byref(font))  # Bold, pixels
    white = c_void_p(); gdip.GdipCreateSolidFill(c_uint(0xFFFFFFFF), byref(white))
    for i, c in enumerate(cols):
        br = c_void_p(); gdip.GdipCreateSolidFill(c_uint(c), byref(br))
        gdip.GdipFillRectangleI(g, br, i * 30, 0, 30, H); gdip.GdipDeleteBrush(br)

        class RectF(Structure):
            _fields_ = [("X", ctypes.c_float), ("Y", ctypes.c_float), ("W", ctypes.c_float), ("H", ctypes.c_float)]
        gdip.GdipDrawString(g, ctypes.c_wchar_p(str(i)), -1, font, byref(RectF(i * 30 + 6, 50, 30, 40)), None, white)
    gdip.GdipFillRectangleI(g, white, 0, 0, W, 2)
    red = c_void_p(); gdip.GdipCreateSolidFill(c_uint(0xFFFF0000), byref(red))
    gdip.GdipFillRectangleI(g, red, 0, H - 2, W, 2)
    for o in (white, red): gdip.GdipDeleteBrush(o)
    gdip.GdipDeleteFont(font); gdip.GdipDeleteFontFamily(fam); gdip.GdipDeleteGraphics(g)
    rect = _Rect(0, 0, W, H); bd = _BitmapData()
    _check(gdip.GdipBitmapLockBits(bmp, byref(rect), 1, PixelFormat32bppARGB, byref(bd)), "lock")
    data = b"".join(ctypes.string_at(bd.Scan0 + y * bd.Stride, W * 4) for y in range(H))
    gdip.GdipBitmapUnlockBits(bmp, byref(bd)); gdip.GdipDisposeImage(bmp)
    return data


def test_pattern() -> bytes:
    """BGRA: 4 вертикальные полосы R, G, B, белый; белый квадрат 20x20 в левом верхнем углу
    (ориентация), чёрная полоса снизу 15 px (обрезка по высоте)."""
    px = bytearray(W * H * 4)
    bars = [(0, 0, 255), (0, 255, 0), (255, 0, 0), (255, 255, 255)]  # BGR
    for y in range(H):
        for x in range(W):
            c = bars[x * 4 // W]
            if x < 20 and y < 20: c = (255, 255, 255)
            elif x < 24 and y < 24: c = (0, 0, 0)
            if y >= H - 15: c = (0, 0, 0)
            px[(y * W + x) * 4:(y * W + x) * 4 + 4] = bytes((*c, 255))
    return bytes(px)
