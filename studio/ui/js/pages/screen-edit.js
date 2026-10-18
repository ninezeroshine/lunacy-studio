// Редактор экрана: из видео, анимации или картинки — кадры 240×135 RGB565 для слота клавиатуры.
// Всё считается в браузере: правки не трогают флеш, пишет только финальная заливка.
// Рамка железа (команда 04 72): до 69 кадров, задержка кадра = байт × 2 мс (1…255 → 2…510 мс).

export const W = 240, H = 135, MAX_FRAMES = 69, FRAME_BYTES = W * H * 2;
export const DELAY_MIN = 20, DELAY_MAX = 510;          // ниже 20 мс прошивка кадр не успеет показать — не обещаем
export const FPS_MIN = 2, FPS_MAX = 20, FPS_DEFAULT = 10;
export const MAX_FILE = 2 * 1024 ** 3;                 // файл не уходит на сервер, читаем его по кусочкам
const CACHE_SIDE = 960;                                // кадры источника держим уменьшенными: 69 кадров 4K — это 2 ГБ

export const ACCEPT = "video/*,image/*,.mp4,.m4v,.webm,.mov,.mkv,.gif,.webp,.apng,.png,.jpg,.jpeg,.bmp,.avif";
const VIDEO_RE = /\.(mp4|m4v|webm|mov|mkv|ogv)$/i;
const IMAGE_RE = /\.(gif|webp|apng|png|jpe?g|bmp|avif)$/i;

export function defaults() {
  return {
    in: 0, out: 0, mode: "fragment", fps: FPS_DEFAULT, speed: 1, reverse: false, pingpong: false,
    fit: "cover", zoom: 1, cx: 0.5, cy: 0.5, rotate: 0, flipH: false, flipV: false, bg: "#000000",
    bright: 0, contrast: 0, satur: 0, sharp: 0, dither: true,
    text: { s: "", pos: "bottom", size: "M", style: "light", band: true },
  };
}

// ---------- источники ----------
// src = { kind: "video"|"anim"|"image", name, size, w, h, duration, frameAt(t) → ImageBitmap (не закрывать), close() }

export function kindOf(file) {
  if (/^video\//.test(file.type) || VIDEO_RE.test(file.name)) return "video";
  if (/^image\//.test(file.type) || IMAGE_RE.test(file.name)) return "image";
  return null;
}

export async function open(file) {
  const kind = kindOf(file);
  if (!kind) throw new Error(`«${file.name}» — не видео и не картинка. Подойдут MP4, WebM, MOV, GIF, WebP, PNG, JPG, BMP.`);
  if (file.size > MAX_FILE) throw new Error(`«${file.name}» больше 2 ГБ. Обрежь видео в любом редакторе и открой снова.`);
  return kind === "video" ? openVideo(file) : openImage(file);
}

// Готовая картинка (фон, пустая карточка) как источник.
export async function fromCanvas(canvas, name) {
  const bmp = await createImageBitmap(canvas);
  return still(bmp, name, 0);
}

function still(bmp, name, size, w = bmp.width, h = bmp.height) {
  return { kind: "image", name, size, w, h, duration: 0, frames: 1,
    frameAt: async () => bmp, close: () => bmp.close?.() };
}

async function shrink(img, w, h) {
  const k = Math.min(1, CACHE_SIDE / Math.max(w, h));
  if (k === 1) return createImageBitmap(img);
  return createImageBitmap(img, { resizeWidth: Math.max(1, Math.round(w * k)), resizeHeight: Math.max(1, Math.round(h * k)), resizeQuality: "high" });
}

async function openVideo(file) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true; video.playsInline = true; video.preload = "auto"; video.src = url;
  try {
    await new Promise((res, rej) => {
      video.onloadeddata = res;
      video.onerror = () => rej(new Error(`Браузер не умеет показывать «${file.name}». Обычно так бывает с MOV/HEVC с телефона: сохрани видео как MP4 (H.264) и открой снова.`));
    });
  } catch (e) { URL.revokeObjectURL(url); throw e; }
  const w = video.videoWidth, h = video.videoHeight, duration = video.duration;
  if (!w || !h || !isFinite(duration) || duration <= 0) {
    URL.revokeObjectURL(url);
    throw new Error(`В «${file.name}» нет видео, которое можно прочитать. Попробуй другой файл.`);
  }
  let chain = Promise.resolve();
  const cache = new Map();                              // время (мс) → кадр, уменьшенный до CACHE_SIDE
  const grab = (t) => new Promise((res, rej) => {
    const target = Math.min(Math.max(0, t), duration - 0.001);
    if (Math.abs(video.currentTime - target) < 0.0005 && video.readyState >= 2) { res(); return; }
    const ok = () => { clear(); res(); }, bad = () => { clear(); rej(new Error("Видео не перематывается на этот момент. Попробуй другой отрезок.")); };
    const clear = () => { video.removeEventListener("seeked", ok); video.removeEventListener("error", bad); };
    video.addEventListener("seeked", ok); video.addEventListener("error", bad);
    video.currentTime = target;
  }).then(() => shrink(video, w, h));
  return {
    kind: "video", name: file.name, size: file.size, w, h, duration,
    frameAt(t) {
      const key = Math.round(t * 1000);
      if (cache.has(key)) return cache.get(key);
      const p = (chain = chain.then(() => grab(t), () => grab(t)));   // перемотка одна на всех: <video> один
      cache.set(key, p);
      p.catch(() => cache.delete(key));
      if (cache.size > 400) { const k = cache.keys().next().value; cache.get(k).then((b) => b.close(), () => {}); cache.delete(k); }
      return p;
    },
    close() { cache.forEach((p) => p.then((b) => b.close(), () => {})); cache.clear(); video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url); },
  };
}

async function openImage(file) {
  const type = file.type || ({ gif: "image/gif", webp: "image/webp", png: "image/png", apng: "image/apng" }[file.name.split(".").pop().toLowerCase()] || "");
  if ("ImageDecoder" in window && type && await ImageDecoder.isTypeSupported(type).catch(() => false)) {
    const dec = new ImageDecoder({ data: await file.arrayBuffer(), type });
    try {
      await dec.tracks.ready;
      await dec.completed;
      const n = dec.tracks.selectedTrack?.frameCount || 1;
      if (n > 1) return animation(dec, file, n);
      const { image } = await dec.decode({ frameIndex: 0 });
      const bmp = await shrink(image, image.displayWidth, image.displayHeight);
      const s = still(bmp, file.name, file.size, image.displayWidth, image.displayHeight);
      image.close(); dec.close();
      return s;
    } catch (e) {
      dec.close();
      throw new Error(`Не удалось открыть «${file.name}»: файл повреждён или формат не тот. Попробуй другой.`);
    }
  }
  // Без ImageDecoder (не Chrome/Edge): картинка открывается, но у анимации берём только первый кадр.
  let bmp;
  try { bmp = await createImageBitmap(file); }
  catch { throw new Error(`Не удалось открыть «${file.name}»: файл повреждён или это не картинка.`); }
  const small = await shrink(bmp, bmp.width, bmp.height);
  const s = still(small, file.name, file.size, bmp.width, bmp.height);
  bmp.close();
  s.note = /gif|webp|png/.test(type) ? "Этот браузер не разбирает анимацию по кадрам — взят первый кадр. Открой Studio в Chrome или Edge." : "";
  return s;
}

async function animation(dec, file, n) {
  // Длительности кадров: декодируем каждый кадр по разу, сам кадр сразу отпускаем.
  const starts = [], durs = [];
  let t = 0, w = 0, h = 0;
  for (let i = 0; i < n; i++) {
    const { image } = await dec.decode({ frameIndex: i });
    if (!i) { w = image.displayWidth; h = image.displayHeight; }
    const d = image.duration ? image.duration / 1e6 : 0.1;
    starts.push(t); durs.push(d > 0.005 ? d : 0.1);   // нулевая задержка в GIF — по обычаю браузеров 100 мс
    t += durs[i];
    image.close();
  }
  const cache = new Map();
  let chain = Promise.resolve();
  const idxAt = (x) => { let lo = 0, hi = n - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= x) lo = m; else hi = m - 1; } return lo; };
  return {
    kind: "anim", name: file.name, size: file.size, w, h, duration: t, frames: n, starts, durs,
    frameAt(x) {
      const i = idxAt(Math.min(Math.max(0, x), t - 1e-6));
      if (cache.has(i)) return cache.get(i);
      const p = (chain = chain.then(async () => {
        const { image } = await dec.decode({ frameIndex: i });
        try { return await shrink(image, w, h); } finally { image.close(); }
      }));
      cache.set(i, p);
      p.catch(() => cache.delete(i));
      if (cache.size > 400) { const k = cache.keys().next().value; cache.get(k).then((b) => b.close(), () => {}); cache.delete(k); }
      return p;
    },
    close() { cache.forEach((p) => p.then((b) => b.close(), () => {})); cache.clear(); dec.close(); },
  };
}

// Начальные правки под источник: GIF до 69 кадров — как в файле; иначе плавный фрагмент от начала.
export function initFor(src, prev) {
  const e = { ...defaults(), ...(prev ? { fit: prev.fit, bg: prev.bg, bright: prev.bright, contrast: prev.contrast,
    satur: prev.satur, sharp: prev.sharp, dither: prev.dither, text: { ...prev.text } } : {}) };
  if (src.kind === "image") return e;
  e.mode = src.kind === "anim" && src.frames <= MAX_FRAMES ? "orig" : "fragment";
  e.in = 0;
  e.out = e.mode === "orig" ? src.duration : Math.min(src.duration, maxSpan(e));
  return e;
}

// ---------- план кадров ----------
const quant = (ms) => Math.min(DELAY_MAX, Math.max(DELAY_MIN, Math.round(ms / 2) * 2));
export const budget = (e) => (e.pingpong ? Math.floor((MAX_FRAMES + 2) / 2) : MAX_FRAMES);
// Самый длинный отрезок, который «плавный фрагмент» уложит в бюджет при текущих кадрах/с и скорости.
export const maxSpan = (e) => (budget(e) * e.speed) / e.fps;

export function plan(src, e) {
  if (!src || src.kind === "image") return [{ t: 0, delay: DELAY_MAX }];   // один кадр: задержка не важна, но в пределах прошивки
  const span = Math.max(0.01, e.out - e.in);
  let times, delay;
  if (e.mode === "orig" && src.starts) {
    // как в файле: кадры анимации, попавшие в отрезок, со своими задержками (÷ скорость), не больше бюджета
    let idx = src.starts.map((s, i) => i).filter((i) => src.starts[i] + src.durs[i] > e.in + 1e-6 && src.starts[i] < e.out - 1e-6);
    if (!idx.length) idx = [0];
    idx = idx.slice(0, budget(e));
    if (e.reverse) idx.reverse();
    let frames = idx.map((i) => ({ t: src.starts[i] + 1e-4, delay: quant((src.durs[i] * 1000) / e.speed) }));
    if (e.pingpong && frames.length > 2) frames = frames.concat(frames.slice(1, -1).reverse());
    return frames;
  }
  if (e.mode === "fragment" || e.mode === "orig") {
    const step = e.speed / e.fps;
    const n = Math.max(1, Math.min(budget(e), Math.floor(span / step + 1e-6)));
    times = Array.from({ length: n }, (_, i) => e.in + i * step);
    delay = quant(1000 / e.fps);
  } else {
    const n = Math.max(2, Math.min(budget(e), src.frames ? src.frames : budget(e)));
    times = Array.from({ length: n }, (_, i) => e.in + (i + 0.5) * span / n);
    delay = quant((span / e.speed / n) * 1000);
  }
  if (e.reverse) times.reverse();
  let frames = times.map((t) => ({ t, delay }));
  if (e.pingpong && frames.length > 2) frames = frames.concat(frames.slice(1, -1).reverse());
  return frames;
}

// Сводка для человека: сколько кадров, сколько длится петля, во сколько раз быстрее оригинала.
export function summary(src, e) {
  const f = plan(src, e);
  const loop = f.reduce((a, x) => a + x.delay, 0) / 1000;
  const span = src && src.kind !== "image" ? Math.max(0.01, e.out - e.in) : 0;
  const unique = e.pingpong && f.length > 2 ? Math.floor(f.length / 2) + 1 : f.length;
  const speedup = span && loop ? (span / (e.pingpong ? loop / 2 : loop)) : 1;
  return { frames: f.length, unique, loop, speedup, delay: f[0].delay };
}

// ---------- рендер ----------
export function renderer() {
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d", { willReadFrequently: true });
  return {
    canvas: cv,
    // Кадр источника → ImageData 240×135 до квантования (с цветом, резкостью, рисунком и текстом).
    // overlay — слой «Рисунок» (canvas 240×135 с прозрачностью), ложится поверх каждого кадра.
    draw(img, e, overlay = null) {
      const geo = geometry(img.width, img.height, e);
      g.save();
      g.filter = "none";
      g.fillStyle = e.bg; g.fillRect(0, 0, W, H);
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
      const f = [];
      if (e.bright) f.push(`brightness(${1 + e.bright / 100})`);
      if (e.contrast) f.push(`contrast(${1 + e.contrast / 100})`);
      if (e.satur) f.push(`saturate(${1 + e.satur / 100})`);
      g.filter = f.length ? f.join(" ") : "none";
      g.translate(geo.x + geo.dw / 2, geo.y + geo.dh / 2);
      g.rotate((e.rotate * Math.PI) / 180);
      g.scale(e.flipH ? -1 : 1, e.flipV ? -1 : 1);
      g.drawImage(img, -geo.sw / 2, -geo.sh / 2, geo.sw, geo.sh);
      g.restore();
      let id = g.getImageData(0, 0, W, H);
      if (e.sharp) id = sharpen(id, e.sharp / 100);
      if (overlay || e.text?.s?.trim()) {
        g.putImageData(id, 0, 0);
        if (overlay) g.drawImage(overlay, 0, 0);
        if (e.text?.s?.trim()) drawText(g, e.text);
        id = g.getImageData(0, 0, W, H);
      }
      return id;
    },
  };
}

// Геометрия кадра: размер картинки после поворота, масштаб «с обрезкой»/«целиком» × zoom, центр (cx, cy) в долях.
export function geometry(w, h, e) {
  const turned = e.rotate % 180 !== 0;
  const ow = turned ? h : w, oh = turned ? w : h;
  const s0 = e.fit === "contain" ? Math.min(W / ow, H / oh) : Math.max(W / ow, H / oh);
  const s = s0 * e.zoom, dw = ow * s, dh = oh * s;
  let x = W / 2 - e.cx * dw, y = H / 2 - e.cy * dh;
  x = dw >= W ? Math.min(0, Math.max(W - dw, x)) : (W - dw) / 2;   // при обрезке без пустых полей
  y = dh >= H ? Math.min(0, Math.max(H - dh, y)) : (H - dh) / 2;
  return { x, y, dw, dh, sw: w * s, sh: h * s, s };
}

// Сдвиг картинки мышью: на сколько поменять cx, cy, чтобы она ушла на (dx, dy) пикселей экрана.
export function pan(img, e, dx, dy) {
  const { dw, dh } = geometry(img.width, img.height, e);
  const cl = (v) => Math.min(1, Math.max(0, v));
  return { cx: cl(e.cx - dx / dw), cy: cl(e.cy - dy / dh) };
}

function sharpen(id, amount) {
  const s = id.data, out = new ImageData(W, H), d = out.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0, n = 0;
        for (let yy = Math.max(0, y - 1); yy <= Math.min(H - 1, y + 1); yy++)
          for (let xx = Math.max(0, x - 1); xx <= Math.min(W - 1, x + 1); xx++) { sum += s[(yy * W + xx) * 4 + c]; n++; }
        d[i + c] = s[i + c] + (s[i + c] - sum / n) * amount * 1.6;
      }
      d[i + 3] = 255;
    }
  }
  return out;
}

const TEXT_STYLES = {
  light: { fg: "#ffffff", band: "rgba(5,8,15,.55)", shadow: "rgba(0,0,0,.85)" },
  gold: { fg: "#ecd6a6", band: "rgba(5,8,15,.6)", shadow: "rgba(0,0,0,.85)" },
  silver: { fg: "#c4cfe8", band: "rgba(5,8,15,.6)", shadow: "rgba(0,0,0,.85)" },
  dark: { fg: "#05080f", band: "rgba(230,235,247,.7)", shadow: "rgba(255,255,255,.6)" },
};

function drawText(g, t) {
  const S = TEXT_STYLES[t.style] || TEXT_STYLES.light;
  const lines = t.s.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 2);
  if (!lines.length) return;
  const base = { S: 13, M: 18, L: 26 }[t.size] || 18;
  const font = (px, i) => `${i ? 500 : 600} ${px}px "Inter", "Segoe UI", system-ui, sans-serif`;
  const sizes = lines.map((s, i) => { let px = i ? Math.round(base * 0.72) : base; g.font = font(px, i); while (g.measureText(s).width > W - 16 && px > 8) g.font = font(--px, i); return px; });
  const gap = 3, block = sizes.reduce((a, b) => a + b, 0) + gap * (lines.length - 1);
  const pad = 6, top = t.pos === "top" ? pad + 1 : t.pos === "center" ? (H - block) / 2 : H - block - pad - 1;
  if (t.band) { g.fillStyle = S.band; g.fillRect(0, Math.max(0, top - pad + 1), W, block + pad * 2 - 2); }
  g.textAlign = "center"; g.textBaseline = "top";
  let y = top;
  lines.forEach((s, i) => {
    g.font = font(sizes[i], i);
    g.fillStyle = S.shadow; g.fillText(s, W / 2 + 1, y + 1);
    g.fillStyle = S.fg; g.fillText(s, W / 2, y);
    y += sizes[i] + gap;
  });
}

// ImageData → RGB565 LE (как ждёт прошивка) + превью ровно из тех же 65 тысяч цветов.
// Сглаживание полос — Флойд–Стейнберг: ошибка округления уходит соседям, градиенты не ступенятся.
export function to565(id, dither) {
  const src = id.data, n = W * H;
  const buf = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { buf[i * 3] = src[i * 4]; buf[i * 3 + 1] = src[i * 4 + 1]; buf[i * 3 + 2] = src[i * 4 + 2]; }
  const bytes = new Uint8Array(n * 2), dv = new DataView(bytes.buffer);
  const prev = new ImageData(W, H), p = prev.data;
  const LV = [31, 63, 31];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x, q = [0, 0, 0];
      for (let c = 0; c < 3; c++) {
        const old = Math.min(255, Math.max(0, buf[i * 3 + c]));
        const lv = Math.round((old * LV[c]) / 255);
        q[c] = lv;
        const back = c === 1 ? (lv << 2) | (lv >> 4) : (lv << 3) | (lv >> 2);
        p[i * 4 + c] = back;
        if (dither) {
          const err = old - back;
          if (x + 1 < W) buf[(i + 1) * 3 + c] += (err * 7) / 16;
          if (y + 1 < H) {
            if (x > 0) buf[(i + W - 1) * 3 + c] += (err * 3) / 16;
            buf[(i + W) * 3 + c] += (err * 5) / 16;
            if (x + 1 < W) buf[(i + W + 1) * 3 + c] += err / 16;
          }
        }
      }
      p[i * 4 + 3] = 255;
      dv.setUint16(i * 2, (q[0] << 11) | (q[1] << 5) | q[2], true);
    }
  }
  return { bytes, preview: prev };
}

// Полоска миниатюр для шкалы времени.
export async function filmstrip(src, n, hgt = 36) {
  if (!src || src.kind === "image") return [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (src.duration * (i + 0.5)) / n;
    const b = await src.frameAt(t);
    out.push(await createImageBitmap(b, { resizeHeight: hgt, resizeWidth: Math.max(1, Math.round((hgt * b.width) / b.height)), resizeQuality: "medium" }));
  }
  return out;
}
