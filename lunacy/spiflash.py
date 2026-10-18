"""Запись внешней SPI-флеш клавиатуры командой 04 38 (графика экрана: фон, значки, анимации).

- 38 пишет с адреса 0, адрес из пакета не берётся; N блоков по 4096 в байтах [8..9];
- на каждый блок прошивка стирает ровно один сектор 4 КБ и пишет его, остальное не трогает;
- N=0 прошивка не проверяет (счётчик станет 0xFFFF), поэтому здесь 1 <= N <= 0x740:
  выше 0x740000 начинается пользовательский слот экрана (04 72), его не трогаем.
Транспорт тот же, что у заливки слота (Keyboard.upload): 04 18 → 04 38 → блоки на MI_02 с ответом → 04 02.
"""
import time

from .proto import NoAck

BLOCK = 4096
MAX_BLOCKS = 0x740          # 0x740000: начало пользовательского слота 04 72


def write(kb, data, blocks, progress=None):
    if not 1 <= blocks <= MAX_BLOCKS:
        raise ValueError(f"N={blocks}: допустимо 1..{MAX_BLOCKS:#x}")
    if len(data) < blocks * BLOCK:
        raise ValueError(f"образ короче {blocks} блоков")
    img = kb.img
    acks, miss = [], 0
    t0 = time.perf_counter()
    with kb.transaction():
        ack = kb.header(0x38, 0, {8: blocks & 0xFF, 9: blocks >> 8})
        kb.wrote = True                     # дальше сектора стираются: обрыв оставит графику недописанной
        for i in range(blocks):
            w = img.write(b"\0" + data[i * BLOCK:(i + 1) * BLOCK])
            r = img.read(65, 3000) if w > 0 else None
            acks.append(r.hex() if r else None)
            miss = miss + 1 if r is None else 0
            if miss >= 3:
                raise NoAck(f"клавиатура перестала подтверждать блоки (блок {i + 1} из {blocks})")
            if progress:
                progress(i + 1, blocks)
    return {"ack": ack.hex() if ack else None, "blocks": blocks, "seconds": round(time.perf_counter() - t0, 1),
            "acks": acks}
