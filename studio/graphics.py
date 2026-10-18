"""Набор графики экрана во внешней SPI-флеш (команда 04 38): фон экрана статуса, значки, анимации поиска.
Набор поставляется с программой (assets/graphics/pack.bin.gz, превью в preview/), собирает его tools/build_pack.py.
Клавиатура флеш не отдаёт, поэтому «что залито» — по журналу записей в данных пользователя
(%APPDATA%\\LunacyStudio\\graphics-runs)."""
import datetime, gzip, hashlib, json, os, re

from .store import DIR

GFX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "graphics")
PACK = os.path.join(GFX, "pack.bin.gz")
LIVE_HEAD = os.path.join(GFX, "live_head.bin.gz")   # первые 16 блоков набора с фоном живого экрана
LIVE_BLOCKS = 16
BG_BYTES = 240 * 135 * 2                          # фон экрана статуса: 0…0xFD20
PREVIEW = os.path.join(GFX, "preview")
RUNS = os.path.join(DIR, "graphics-runs")
BLOCK = 4096
SECONDS = 280                     # замер 2026-10-16: 1856 блоков за 277–280 с
PREVIEW_NAME = re.compile(r"^(?:[0-9a-f]{6}|_sheet|_live)$")

_cache = {}                       # (путь, mtime, размер) → (байты, SHA-256): 7 МБ не распаковываем на каждый запрос


def _read(path):
    """Распакованный набор и его SHA-256 (хеш — от распакованных байтов, как у записи в клавиатуру)."""
    st = os.stat(path)
    key = (path, st.st_mtime_ns, st.st_size)
    if key not in _cache:
        with gzip.open(path, "rb") as f:
            data = f.read()
        _cache.clear()
        _cache[key] = (data, hashlib.sha256(data).hexdigest())
    return _cache[key]


def sha256(path):
    return _read(path)[1]


def pack():
    """Набор для заливки: {sha256, blocks, built_at, tiles} или None, если build_pack ещё не запускали."""
    try:
        st = os.stat(PACK)
    except OSError:
        return None
    tiles = sorted(f[:-4] for f in os.listdir(PREVIEW) if f.endswith(".png") and PREVIEW_NAME.match(f[:-4])) \
        if os.path.isdir(PREVIEW) else []
    data, sha = _read(PACK)
    return {"sha256": sha, "blocks": len(data) // BLOCK, "size": len(data),
            "built_at": datetime.datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds"), "tiles": tiles}


def last_run():
    """Последняя полная запись 04 38 из журнала (имя файла начинается с метки времени)."""
    try:
        names = sorted(f for f in os.listdir(RUNS) if f.endswith(".json"))
    except OSError:
        return None
    for name in reversed(names):
        try:
            with open(os.path.join(RUNS, name), encoding="utf-8") as f:
                r = json.load(f)
            at = datetime.datetime.strptime(r["at"], "%Y%m%d-%H%M%S").isoformat(timespec="seconds")
        except (OSError, ValueError, KeyError):
            continue
        return {"sha256": r.get("sha256"), "blocks": r.get("blocks"), "at": at, "seconds": r.get("seconds"),
                "image": os.path.basename(r.get("image") or ""), "source": r.get("source", "cli")}
    return None


def status():
    p, w = pack(), last_run()
    return {"pack": p, "written": w, "matches": bool(p and w and p["sha256"] == w["sha256"]), "seconds": SECONDS}


def load():
    """Байты набора и его SHA-256 для записи. Граница доверия — длина: целые блоки, не дальше слота 04 72."""
    from lunacy import spiflash as sf
    if not os.path.isfile(PACK):
        raise ValueError("набора графики нет в установленной программе — переустанови Lunacy Studio")
    data = _read(PACK)[0]
    blocks = len(data) // BLOCK
    if len(data) % BLOCK or not 1 <= blocks <= sf.MAX_BLOCKS:
        raise ValueError(f"pack.bin: {len(data)} байт — нужно от 1 до {sf.MAX_BLOCKS} целых блоков по 4096")
    return data, blocks, hashlib.sha256(data).hexdigest()


def head(live):
    """Первые 16 блоков для смены фона экрана статуса: обычный (из pack.bin) или с подписями живого экрана.
    Остальные байты этих блоков (начало батареи) у обоих вариантов обязаны совпадать — иначе набор и
    live_head.bin собраны в разное время, и смена фона испортила бы значок."""
    size = LIVE_BLOCKS * BLOCK
    try:
        plain = _read(PACK)[0][:size]
        if not live:
            if len(plain) != size:
                raise ValueError
            return plain
        with gzip.open(LIVE_HEAD, "rb") as f:
            lh = f.read()
    except (OSError, ValueError):
        raise ValueError("нет набора графики с фоном живого экрана — переустанови Lunacy Studio")
    if len(lh) != size or len(plain) != size or lh[BG_BYTES:] != plain[BG_BYTES:]:
        raise ValueError("live_head.bin.gz не от этого набора графики: пересобери набор (python -I tools/build_pack.py)")
    return lh


def check_acks(r, blocks):
    bad = sum(1 for a in r["acks"] if not a or bytes.fromhex(a)[1] != 1)
    if bad:
        raise RuntimeError(f"клавиатура не подтвердила {bad} блоков из {blocks}: фон экрана может быть испорчен. "
                           "Повтори переключение")


def save_run(res, sha, info):
    """Запись в журнал в формате spiflash.py, чтобы CLI и Studio видели одну историю."""
    os.makedirs(RUNS, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    bad = [i for i, a in enumerate(res["acks"]) if a is None]
    doc = dict(res, image=os.path.basename(PACK), sha256=sha, info=info, at=stamp, missing_acks=bad, source="studio")
    with open(os.path.join(RUNS, f"{stamp}-38-{res['blocks']}.json"), "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1)


def write(kb, data, blocks, progress):
    """Запись через lunacy.spiflash.write (тот же транспорт, что Keyboard.upload)."""
    from lunacy import spiflash
    return spiflash.write(kb, data, blocks, progress)
