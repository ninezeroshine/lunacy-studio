"""Загрузка системы для режима «Нагрузка», живого экрана и /api/stats: CPU по разнице GetSystemTimes, RAM из
GlobalMemoryStatusEx, GPU и видеопамять из nvidia-smi (если есть). Всё меряет фоновый поток раз в секунду, чтение
мгновенное — живая подсветка и HTTP никогда не ждут nvidia-smi."""
import ctypes, ctypes.wintypes as wt, shutil, subprocess, threading, time, logging, collections

log = logging.getLogger("stats")
k32 = ctypes.WinDLL("kernel32", use_last_error=True)
CREATE_NO_WINDOW = 0x08000000
GPU_EVERY = 2.0        # nvidia-smi не чаще раза в 2 с
GPU_TIMEOUT = 1.5
GPU_IDLE = 10.0        # GPU меряем, только пока кто-то спрашивал за последние 10 с


class MEMSTAT(ctypes.Structure):
    _fields_ = [("dwLength", wt.DWORD), ("dwMemoryLoad", wt.DWORD), ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong), ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong), ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong), ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]


def _times():
    idle, kern, user = wt.FILETIME(), wt.FILETIME(), wt.FILETIME()
    k32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kern), ctypes.byref(user))
    v = lambda f: (f.dwHighDateTime << 32) | f.dwLowDateTime
    return v(idle), v(kern), v(user)          # kernel включает idle


def _mem():
    m = MEMSTAT(); m.dwLength = ctypes.sizeof(m)
    return m if k32.GlobalMemoryStatusEx(ctypes.byref(m)) else None


def ram():
    m = _mem()
    return float(m.dwMemoryLoad) if m else None


def ram_gb():
    """Занято RAM, ГБ (2^30)."""
    m = _mem()
    return round((m.ullTotalPhys - m.ullAvailPhys) / 2 ** 30, 1) if m else None


def ram_total_gb():
    m = _mem()
    return round(m.ullTotalPhys / 2 ** 30, 1) if m else None


class Stats:
    def __init__(self):
        self.cpu, self.gpu, self.vram, self.vram_total, self.gpu_temp = 0.0, None, None, None, None
        self.history = collections.deque(maxlen=150)       # 5 минут по 2 с: (время, cpu, gpu, ram %) — для «Обзора»
        self.smi = shutil.which("nvidia-smi")
        self._gpu_t, self._asked = 0.0, time.monotonic()      # при старте один замер GPU
        threading.Thread(target=self._loop, name="stats", daemon=True).start()

    def _sample_gpu(self):
        try:
            r = subprocess.run([self.smi, "--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu",
                                "--format=csv,noheader,nounits"],
                               capture_output=True, text=True, timeout=GPU_TIMEOUT, stdin=subprocess.DEVNULL,
                               creationflags=CREATE_NO_WINDOW)
            rows = []
            for line in r.stdout.splitlines():               # «41, 4944, 12288, 57» — загрузка %, занято и всего МиБ, °C
                parts = [x.strip() for x in line.split(",")]
                num = lambda x: float(x) if x.replace(".", "", 1).isdigit() else None   # «[N/A]» у некоторых карт
                if len(parts) >= 2 and num(parts[0]) is not None and num(parts[1]) is not None:
                    rows.append((num(parts[0]), num(parts[1]), num(parts[2]) if len(parts) > 2 else None,
                                 num(parts[3]) if len(parts) > 3 else None))
            if rows:
                top = max(rows, key=lambda r: (r[0], r[1]))   # несколько видеокарт: самая загруженная
                self.gpu, self.vram = top[0], round(top[1] / 1024, 1)
                self.vram_total = round(top[2] / 1024, 1) if top[2] else None
                self.gpu_temp = top[3]
            else:
                self.gpu = self.vram = self.vram_total = self.gpu_temp = None
        except (OSError, subprocess.SubprocessError, ValueError) as e:
            log.info("nvidia-smi: %s", e)
            self.gpu = self.vram = self.vram_total = self.gpu_temp = None

    def _loop(self):
        prev = _times()
        while True:
            time.sleep(1)
            cur = _times()
            idle, total = cur[0] - prev[0], (cur[1] - prev[1]) + (cur[2] - prev[2])
            if total > 0:
                self.cpu = max(0.0, min(100.0, 100.0 * (total - idle) / total))
            prev = cur
            now = time.monotonic()
            if not self.history or now - self.history[-1][0] >= 2:
                self.history.append((now, round(self.cpu, 1), self.gpu, ram()))
            if self.smi and now - self._asked < GPU_IDLE and now - self._gpu_t >= GPU_EVERY:
                self._gpu_t = now
                self._sample_gpu()

    def get(self):
        self._asked = time.monotonic()
        return {"cpu": round(self.cpu, 1), "ram": ram(), "ram_gb": ram_gb(), "ram_total_gb": ram_total_gb(),
                "gpu": self.gpu if self.smi else None, "vram_gb": self.vram if self.smi else None,
                "vram_total_gb": self.vram_total if self.smi else None, "gpu_temp": self.gpu_temp if self.smi else None}

    def series(self):
        """История для графиков «Обзора»: секунды назад и значения; GPU — None, пока его не спрашивали."""
        now = time.monotonic()
        h = list(self.history)
        return {"t": [round(now - t) for t, *_ in h], "cpu": [c for _, c, _, _ in h],
                "gpu": [g for _, _, g, _ in h], "ram": [r for *_, r in h]}


if __name__ == "__main__":
    s = Stats()
    for _ in range(3):
        time.sleep(1.2)
        print(s.get())
