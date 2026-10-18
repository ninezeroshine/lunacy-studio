"""Свой набор графики экрана Lunacy In Space в стиле Lunacy Studio («Обсерватория», design/SPEC.md).

Адреса и размеры — карта S98 Pro, подтверждённая на нашей клавиатуре диагностикой 2026-10-16
(диагностическим набором). Смысл каждого ресурса — по заводским картинкам AULA F108 Pro по тем же адресам.
Неизвестные участки 0…0x740000 — тёмный фон с тусклым адресом: если прошивка покажет что-то не из карты,
по снимку будет видно, откуда она читала.

python -I tools/build_pack.py  →  studio/assets/graphics/pack.bin.gz, live_head.bin.gz (первые 16 блоков набора
с фоном живого экрана: подписи полей часов) и preview/*.png. Нужны Pillow и numpy (только для сборки, не для Studio).
"""
import gzip, json, pathlib
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[1]          # корень репозитория
SIZE = 0x740000
SS = 4                                   # запас при рисовании, потом сжатие со сглаживанием

INK0, INK1, INK2, INK3, INK4 = "#05080f", "#0a1020", "#0f172b", "#16203a", "#1e2a48"
LINE, LINE_STRONG = "#1f2638", "#4a5470"  # --line / --line-strong, сведённые с --ink-1 (рамки ярче: экран смотрят мельком)
SILVER, SILVER_BRIGHT, SILVER_DIM, SILVER_FAINT = "#c4cfe8", "#e6ebf7", "#8590ad", "#6b7590"  # FAINT ≈ 3.9:1 к фону
GOLD, GOLD_BRIGHT, GOLD_DIM = "#d8bd84", "#ecd6a6", "#5e5440"
OK, WARN, DANGER = "#8fd3b5", "#e6b56e", "#e2877a"
BAHN = "C:/Windows/Fonts/bahnschrift.ttf"
INTER = str(ROOT / "studio" / "ui" / "fonts" / "Inter-SemiBold.otf")


def rgb(c):
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def font(px, path=BAHN, wght=None):
    f = ImageFont.truetype(path, px)
    if wght and path == BAHN:
        try:
            f.set_variation_by_axes([wght, 100])
        except Exception:
            pass
    return f


def rgb565(img):
    a = np.asarray(img.convert("RGB"), dtype=np.uint16)
    v = ((a[..., 0] & 0xF8) << 8) | ((a[..., 1] & 0xFC) << 3) | (a[..., 2] >> 3)
    return v.astype("<u2").tobytes()


class Tile:
    """Холст w×h в SS раз крупнее; координаты рисования — в пикселях экрана."""

    def __init__(self, w, h, bg):
        self.w, self.h = w, h
        self.img = (bg.resize((w * SS, h * SS), Image.NEAREST) if isinstance(bg, Image.Image)
                    else Image.new("RGB", (w * SS, h * SS), rgb(bg)))
        self.d = ImageDraw.Draw(self.img)

    def S(self, v):
        return [round(x * SS) for x in v] if isinstance(v, (list, tuple)) else round(v * SS)

    def rect(self, box, outline=None, fill=None, r=0, width=1.25):
        self.d.rounded_rectangle(self.S(box), radius=self.S(r), outline=rgb(outline) if outline else None,
                                 fill=rgb(fill) if fill else None, width=max(1, self.S(width)))

    def line(self, pts, color, width=1.25):
        self.d.line(self.S([c for p in pts for c in p]), fill=rgb(color), width=max(1, self.S(width)), joint="curve")

    def arc(self, box, a0, a1, color, width=1.25):
        self.d.arc(self.S(box), a0, a1, fill=rgb(color), width=max(1, self.S(width)))

    def dot(self, x, y, r, color):
        self.d.ellipse(self.S([x - r, y - r, x + r, y + r]), fill=rgb(color))

    def text(self, xy, s, size, color, anchor="mm", path=BAHN, wght=None, spacing=0.0):
        f = font(self.S(size), path, wght)
        if spacing:
            x, y = self.S(xy)
            total = sum(f.getlength(ch) for ch in s) + self.S(size * spacing) * (len(s) - 1)
            x -= total / 2 if anchor[0] == "m" else 0
            for ch in s:
                self.d.text((x, y), ch, font=f, fill=rgb(color), anchor="l" + anchor[1])
                x += f.getlength(ch) + self.S(size * spacing)
        else:
            self.d.text(self.S(xy), s, font=f, fill=rgb(color), anchor=anchor)

    def done(self):
        return self.img.resize((self.w, self.h), Image.LANCZOS)


# ---------- фон экрана статуса (адрес 0, 240×135) ----------
# Строки 77–88 в байтах фона — это ещё и значок C1 (0x913c, 94×28), поэтому они однотонные.
FLAT_ROWS = (76, 90)
LIVE_BLOCKS = 16                         # фон 0…0xFD20 целиком в первых 16 секторах

# Живой экран (Studio, находка 50): вместо времени прошивка показывает числа, подписи — в фоне.
# Координаты текста прошивки — из кода S98 (FUN_000125f2/12636): дата на y=7 (год с левого края, «/» на x=46 и 77,
# месяц с 57, день с 88), большие часы на y=45 (часы ≈44, «:» на 84 и 145, минуты с 105, секунды с 165).
# Камера 2026-10-16: цифры даты занимают строки 6–21, большие цифры — 47–72; подписи — в полосе 23–44 между ними.
LIVE_LABELS = [((25, 28), "GPU %"), ((97, 28), "RAM, ГБ"), ((62, 39), "VRAM, ГБ"), ((123, 39), "CPU %")]


def status_background(live=False):
    t = Tile(240, 135, INK1)
    # лёгкое затемнение к краям сверху и снизу, кроме однотонной полосы
    for y in range(135):
        if FLAT_ROWS[0] <= y <= FLAT_ROWS[1]:
            continue
        k = min(abs(y - 83) / 60, 1) ** 1.6
        c = tuple(round(a + (b - a) * k) for a, b in zip(rgb(INK1), rgb(INK0)))
        t.d.rectangle(t.S([0, y, 240, y + 1]), fill=c)
    # гравировка: шкала координат по верхнему краю и линия над нижним рядом
    for x in range(10, 240, 20):
        t.line([(x, 0), (x, 2 if x % 40 else 3.5)], LINE_STRONG, 1)
    t.line([(6, 95.5), (234, 95.5)], LINE, 1)
    # звёзды атласа: только по краям, мимо даты, процентов, часов и значков
    stars = [(6, 24, .9, SILVER_DIM), (232, 32, .8, SILVER_FAINT), (14, 60, .7, SILVER_FAINT),
             (226, 64, 1.1, GOLD), (118, 92, .7, SILVER_FAINT), (200, 92, .8, SILVER_DIM),
             (64, 26, .6, SILVER_FAINT), (172, 27, .7, SILVER_FAINT), (36, 92, .6, SILVER_DIM)]
    for x, y, r, c in stars:
        if not (live and y < 45):            # подписи живого экрана занимают полосу 23–44
            t.dot(x, y, r, c)
    if live:
        for (x, y), s in LIVE_LABELS:
            t.text((x, y), s, 8, GOLD, wght=600, spacing=0.04)
    # тонкий серп у правого края — знак Lunacy
    t.dot(225, 49, 9, GOLD_DIM)
    t.dot(229, 46.5, 8.6, INK1)
    img = t.done()
    a = np.asarray(img).copy()
    a[FLAT_ROWS[0]:FLAT_ROWS[1] + 1] = rgb(INK1)
    return Image.fromarray(a)


# ---------- значки ----------

def battery(level, charging=False, bg=INK1):
    t = Tile(35, 18, bg)
    t.rect([2, 3, 30, 15], outline=SILVER, r=2.5, width=1.25)
    t.rect([30.6, 7, 32.6, 11], fill=SILVER, r=0.6)
    if charging:
        t.d.polygon(t.S([18, 4.5, 11.5, 9.6, 15.6, 9.6, 13.5, 13.5, 20.5, 8.2, 16.4, 8.2]), fill=rgb(GOLD))
    else:
        color = DANGER if level <= 1 else WARN if level == 2 else OK
        for i in range(level):
            x = 4.6 + i * 4.9
            t.rect([x, 5.6, x + 3.6, 12.4], fill=color, r=0.8)
        if level == 0:
            t.line([(5, 9), (8, 9)], DANGER, 1.4)
    return t.done()


def g_usb(t, cx, cy, c):
    t.line([(cx, cy - 7), (cx, cy + 7)], c)
    t.d.polygon(t.S([cx - 2.2, cy - 6, cx + 2.2, cy - 6, cx, cy - 9]), fill=rgb(c))
    t.line([(cx, cy + 2), (cx - 4, cy - 1), (cx - 4, cy - 3)], c)
    t.line([(cx, cy), (cx + 4, cy - 3), (cx + 4, cy - 4.5)], c)
    t.dot(cx - 4, cy - 3.6, 1.1, c)
    t.rect([cx + 3, cy - 6, cx + 5, cy - 4], fill=c)
    t.dot(cx, cy + 7.6, 1.6, c)


def g_dongle(t, cx, cy, c):
    t.rect([cx - 4, cy - 2, cx + 4, cy + 8], outline=c, r=1.5)
    t.rect([cx - 2.6, cy - 7, cx + 2.6, cy - 2], outline=c, r=0.6)
    t.arc([cx - 5.5, cy - 12, cx + 5.5, cy - 1], 220, 320, c, 1.1)


def connection(active, bt, bg):
    """Три ячейки: [USB][2.4G][BT n]; active: 'usb' | '24g' | 'bt'."""
    t = Tile(94, 28, bg)
    cells = [(1, 29), (32, 60), (63, 93)]
    for (x0, x1), kind in zip(cells, ("usb", "24g", "bt")):
        on = kind == active
        edge = GOLD if on else LINE_STRONG
        ink = SILVER_BRIGHT if on else SILVER_FAINT
        t.rect([x0 + .5, 1.5, x1 - .5, 26.5], outline=edge, fill=INK3 if on else None, r=6, width=1.25)
        cx = (x0 + x1) / 2
        if kind == "usb":
            g_usb(t, cx, 14, ink)
        elif kind == "24g":
            t.text((cx, 14.5), "2.4G", 10, ink, wght=600)
        else:
            t.text((cx - 0.5, 14.5), f"BT{bt}", 11, ink, wght=600)
    return t.done()


def badge(label, on, bg, size=10.5):
    t = Tile(29, 28, bg)
    t.rect([1.5, 1.5, 27.5, 26.5], outline=GOLD if on else LINE_STRONG, fill=INK3 if on else None, r=6)
    t.text((14.5, 14.5), label, size, SILVER_BRIGHT if on else SILVER_FAINT, wght=600)
    return t.done()


def os_badge(name, bg):
    t = Tile(29, 28, bg)
    t.rect([1.5, 1.5, 27.5, 26.5], outline=LINE_STRONG, r=6)
    t.text((14.5, 15), name, 9.5 if len(name) > 3 else 10.5, SILVER, wght=600)
    t.dot(14.5, 5.2, .8, GOLD)
    return t.done()


def os_selector():
    """Экран выбора ОС (Fn-сочетание Win/Mac), 240×135. Прошивка S98 берёт его адрес из [0x200001c8]: английский
    вариант 0x260870 (корейский 0x1004dc). Курсор 20×2 (0x21bd00) она рисует сама под пунктом: x = 65 (Win)
    и x = 158 (Mac), y = 108, и перерисовывает строки 30…134 из этой же картинки, поэтому под пунктами — чистый фон."""
    t = Tile(240, 135, INK1)
    for y in range(135):
        k = min(abs(y - 70) / 70, 1) ** 1.6
        c = tuple(round(a + (b - a) * k) for a, b in zip(rgb(INK1), rgb(INK0)))
        t.d.rectangle(t.S([0, y, 240, y + 1]), fill=c)
    t.text((12, 13), "Система", 12, SILVER_BRIGHT, anchor="lm", path=INTER)
    t.line([(12, 24.5), (228, 24.5)], LINE, 1)
    t.dot(12, 24.5, 1.2, GOLD)
    for cx, name, sub in [(75, "WIN", "Windows"), (168, "MAC", "macOS")]:
        t.rect([cx - 33, 35.5, cx + 33, 95.5], outline=LINE_STRONG, fill=INK2, r=9)
        t.text((cx, 58), name, 20, SILVER_BRIGHT, wght=700)
        t.text((cx, 81), sub, 10.5, SILVER_DIM, path=INTER)
        t.dot(cx, 42.5, 1, GOLD)
    t.line([(40, 108.5), (200, 108.5)], LINE, 1)            # дорожка курсора: сам курсор рисует прошивка
    return t.done()


def lock(on, bg):
    t = Tile(29, 28, bg)
    t.rect([1.5, 1.5, 27.5, 26.5], outline=GOLD if on else LINE_STRONG, fill=INK3 if on else None, r=6)
    c = SILVER_BRIGHT if on else SILVER_FAINT
    t.rect([8.5, 12.5, 20.5, 21.5], outline=c, r=1.8)
    if on:
        t.arc([10.6, 6, 18.4, 17], 180, 360, c)
    else:                                   # дужка открыта
        t.arc([10.6, 4.5, 18.4, 15.5], 180, 300, c)
    t.dot(14.5, 17, 1.1, c)
    return t.done()


def caption(text, bg=INK1):
    t = Tile(99, 28, bg)
    t.line([(4, 22.5), (95, 22.5)], LINE_STRONG, 1)
    t.dot(4, 22.5, 1.2, GOLD)
    t.text((6, 12), text, 12, SILVER_BRIGHT, anchor="lm", path=INTER)
    return t.done()


def speaker(w, h, plus, frame, bg=INK1):
    t = Tile(w, h, bg)
    s = h / 29
    c = SILVER_BRIGHT if frame else SILVER_DIM
    cy = h / 2
    t.d.polygon(t.S([3 * s, cy - 4 * s, 7 * s, cy - 4 * s, 12 * s, cy - 9 * s, 12 * s, cy + 9 * s,
                     7 * s, cy + 4 * s, 3 * s, cy + 4 * s]), outline=rgb(c), width=max(1, round(1.25 * SS)))
    for i in range(2 if frame else 1):
        r = (6 + i * 5) * s
        t.arc([12 * s - r, cy - r, 12 * s + r, cy + r], -45, 45, GOLD if frame else c)
    x = w - 9 * s
    t.line([(x - 4 * s, cy), (x + 4 * s, cy)], GOLD if frame else c, 1.6)
    if plus:
        t.line([(x, cy - 4 * s), (x, cy + 4 * s)], GOLD if frame else c, 1.6)
    return t.done()


def linking(kind, frame):
    """240×88, верх экрана при поиске: kind 'bt' | '24g', frame 0..2 — расходящиеся дуги."""
    t = Tile(240, 88, INK1)
    cx, cy = 120, 36
    t.dot(cx, cy, 15, INK3)
    t.arc([cx - 15, cy - 15, cx + 15, cy + 15], 0, 360, LINE_STRONG, 1)
    if kind == "bt":
        pts = [(cx - 5, cy - 5), (cx + 5, cy + 5), (cx, cy + 10), (cx, cy - 10), (cx + 5, cy - 5), (cx - 5, cy + 5)]
        t.line(pts, SILVER_BRIGHT, 1.6)
    else:
        g_dongle(t, cx, cy + 1, SILVER_BRIGHT)
    for i in range(3):
        r = 20 + i * 7
        on = i <= frame
        col = GOLD if i == frame else (GOLD_DIM if on else LINE)
        t.arc([cx - r, cy - r, cx + r, cy + r], 200, 340, col, 1.4)
        t.arc([cx - r, cy - r, cx + r, cy + r], 20, 160, col, 1.4)
    t.text((cx, 79), "Bluetooth · поиск" if kind == "bt" else "2.4G · поиск", 10, SILVER, path=INTER)
    return t.done()


def service_fill():
    """Неизвестные участки: тёмный фон, тусклый адрес каждые 32 строки."""
    rows = -(-SIZE // 480)
    rows += -rows % 32
    img = Image.new("RGB", (240, rows), rgb(INK0))
    d = ImageDraw.Draw(img)
    f = font(11)
    for r in range(0, rows, 32):
        d.text((6, r + 10), f"{r * 480:06X}", font=f, fill=rgb("#273049"))
    return bytearray(rgb565(img)[:SIZE])


def main():
    buf = service_fill()
    regions = {int(p["addr"], 16): p for p in json.load(open(ROOT / "tools" / "data" / "diag_regions.json", encoding="utf-8"))}
    bg = status_background()
    crop = lambda x, y, w, h: bg.crop((x, y, x + w, y + h))
    tiles = {0x0: bg}
    # батарея B1..B6 = уровни 0..5, B7 = зарядка (S98: события 0x10..0x15 и 0x0E)
    for i, a in enumerate([0xfd20, 0x1020c, 0x106f8, 0x10be4, 0x110d0, 0x115bc]):
        tiles[a] = battery(i, bg=crop(197, 6, 35, 18))
    tiles[0x1f4f8] = battery(0, charging=True, bg=crop(197, 6, 35, 18))
    # тип связи (40,100): события 9/10/11 = USB / 2.4G / BT, номер 1→BT1, 2→BT2, 0→BT3
    cb = crop(40, 100, 94, 28)
    for a, act, n in [(0x1aa98, "usb", 1), (0x1bf28, "usb", 2), (0x1d3b8, "usb", 3),
                      (0x16ce8, "24g", 1), (0x18178, "24g", 2), (0x19608, "24g", 3),
                      (0x11aa8, "bt", 1), (0x12f38, "bt", 2), (0x143c8, "bt", 3)]:
        tiles[a] = connection(act, n, cb)
    # нижний ряд: K (8) — ОС, L (138) — блокировка Win, M (171) — Caps, N (204) — Num
    for a, name in [(0x2199c, "WIN"), (0x21344, "MAC"), (0x20cec, "iOS"), (0x20694, "AND")]:
        tiles[a] = os_badge(name, crop(8, 100, 29, 28))
    # экран выбора ОС (камера 2026-10-18: адрес по сдвигу служебных подписей, см. recon/spi/find_screen_ptr.py)
    tiles[0x260870] = os_selector()
    tiles[0x21ff4] = lock(False, crop(138, 100, 29, 28))
    tiles[0x2264c] = lock(True, crop(138, 100, 29, 28))
    tiles[0x1e848] = badge("A", False, crop(171, 100, 29, 28), 13)
    tiles[0x1eea0] = badge("A", True, crop(171, 100, 29, 28), 13)
    tiles[0x1f9e4] = badge("1", False, crop(204, 100, 29, 28), 13)
    tiles[0x2003c] = badge("1", True, crop(204, 100, 29, 28), 13)
    # подписи регулировки подсветки 99×28 в (0,0): T1/T2 — корейский набор AULA, T3/T4 — английский
    for a, s in [(0x23b790, "Яркость"), (0x23cd38, "Скорость"), (0x23e2e0, "Яркость"), (0x23f888, "Скорость")]:
        tiles[a] = caption(s, crop(0, 0, 99, 28))
    # громкость: V 49×29 в (170,57) — «+», v 35×19 в (20,62) — «−», по два кадра
    tiles[0x3245f0] = speaker(49, 29, True, 0, crop(170, 57, 49, 29))
    tiles[0x32510a] = speaker(49, 29, True, 1, crop(170, 57, 49, 29))
    tiles[0x325c24] = speaker(35, 19, False, 0, crop(20, 62, 35, 19))
    tiles[0x326156] = speaker(35, 19, False, 1, crop(20, 62, 35, 19))
    # поиск: 3 кадра BT, 3 кадра 2.4G (F108: «BT Linking Animation», «WiFi Linking Animation»)
    for i, a in enumerate([0x17ee68, 0x189368, 0x193868]):
        tiles[a] = linking("bt", i)
    for i, a in enumerate([0x1ada88, 0x1b7f88, 0x1c2488]):
        tiles[a] = linking("24g", i)
    # линии-курсоры: золото
    for a, (w, h) in {0xe0a60: (15, 2), 0x15f3ec: (15, 2), 0x1cca74: (59, 2), 0x21bd00: (20, 2)}.items():
        tiles[a] = Image.new("RGB", (w, h), rgb(GOLD))

    written = []
    for a in sorted(tiles):
        data = rgb565(tiles[a])
        if a in regions:
            p = regions[a]
            assert tiles[a].size == (p["w"], p["h"]), (hex(a), tiles[a].size, p)
        buf[a:a + len(data)] = data
        written.append((a, tiles[a].size))
    # C1 (0x913c) лежит внутри фона: проверяем, что его байты — однотонная полоса фона
    c1 = np.frombuffer(bytes(buf[0x913c:0x913c + 94 * 28 * 2]), "<u2")
    assert len(set(c1.tolist())) == 1, "полоса C1 в фоне не однотонная"

    out = ROOT / "studio" / "assets" / "graphics"
    prev = out / "preview"
    prev.mkdir(parents=True, exist_ok=True)
    (out / "pack.bin.gz").write_bytes(gzip.compress(bytes(buf), 9, mtime=0))   # 7,4 МБ почти пустого фона → ~100 КБ
    # живой экран: те же первые 16 блоков, только фон с подписями
    live_bg = status_background(live=True)
    head = bytearray(buf[:LIVE_BLOCKS * 4096])
    head[:240 * 135 * 2] = rgb565(live_bg)
    c1 = np.frombuffer(bytes(head[0x913c:0x913c + 94 * 28 * 2]), "<u2")
    assert len(set(c1.tolist())) == 1, "полоса C1 в фоне живого экрана не однотонная"
    assert head[240 * 135 * 2:] == buf[240 * 135 * 2:LIVE_BLOCKS * 4096]
    (out / "live_head.bin.gz").write_bytes(gzip.compress(bytes(head), 9, mtime=0))
    live_bg.resize((960, 540), Image.NEAREST).save(prev / "_live.png")
    for a, im in tiles.items():
        im.resize((im.width * 4, im.height * 4), Image.NEAREST).save(prev / f"{a:06x}.png")
    print(f"{len(written)} ресурсов, {len(buf) // 4096} блоков")


if __name__ == "__main__":
    main()
