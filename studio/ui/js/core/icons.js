// Иконки «Обсерватории»: линия 1.25 на сетке 20×20, currentColor. Свои, чтобы всё было в одном почерке.
const P = {
  moon: '<path d="M13.6 3.2a7 7 0 1 0 3.2 11.4 6 6 0 0 1-3.2-11.4Z"/>',
  keys: '<rect x="2.5" y="5" width="15" height="10" rx="1.5"/><path d="M5.5 8h1M8.5 8h1M11.5 8h1M14 8h.5M5.5 10.5h1M8.5 10.5h1M11.5 10.5h1M14 10.5h.5M7 12.8h6"/>',
  macros: '<ellipse cx="10" cy="10" rx="7.5" ry="3.6" transform="rotate(-24 10 10)"/><circle cx="10" cy="10" r="1.8"/><circle cx="16.1" cy="6.9" r="1.1" fill="currentColor" stroke="none"/>',
  light: '<circle cx="10" cy="10" r="3"/><path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.7 4.7l1.5 1.5M13.8 13.8l1.5 1.5M4.7 15.3l1.5-1.5M13.8 6.2l1.5-1.5"/>',
  screen: '<circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="4.2"/><path d="M10 3v1.5M10 15.5V17M3 10h1.5M15.5 10H17"/>',
  signals: '<path d="M4.5 15.5 13 7"/><circle cx="14.3" cy="5.7" r="2"/><path d="M3.2 11.2a6 6 0 0 1 5.6-5.6M3 14.6a9.6 9.6 0 0 1 9-9"/>',
  settings: '<circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="2"/><path d="M10 3.5v2M10 14.5v2M3.5 10h2M14.5 10h2M5.4 5.4l1.4 1.4M13.2 13.2l1.4 1.4M5.4 14.6l1.4-1.4M13.2 6.8l1.4-1.4"/>',
  star: '<path d="M10 2.5 11.3 8.7 17.5 10l-6.2 1.3L10 17.5l-1.3-6.2L2.5 10l6.2-1.3Z"/>',
  sparkle: '<path d="M10 4v12M4 10h12M6 6l8 8M14 6l-8 8" opacity=".55"/><circle cx="10" cy="10" r="1.6" fill="currentColor" stroke="none"/>',
  check: '<path d="m4.5 10.5 3.5 3.5 7.5-8"/>',
  close: '<path d="m5.5 5.5 9 9M14.5 5.5l-9 9"/>',
  plus: '<path d="M10 4.5v11M4.5 10h11"/>',
  minus: '<path d="M4.5 10h11"/>',
  chevron: '<path d="m6 8 4 4 4-4"/>',
  right: '<path d="M4 10h12M11.5 5.5 16 10l-4.5 4.5"/>',
  left: '<path d="M16 10H4M8.5 5.5 4 10l4.5 4.5"/>',
  search: '<circle cx="8.8" cy="8.8" r="5"/><path d="m12.5 12.5 4 4"/>',
  upload: '<path d="M10 13V3.5M6 7.5l4-4 4 4M3.5 13.5v3h13v-3"/>',
  download: '<path d="M10 3.5V13M6 9l4 4 4-4M3.5 13.5v3h13v-3"/>',
  undo: '<path d="M7 5 3.5 8.5 7 12"/><path d="M3.5 8.5h8.5a4.5 4.5 0 0 1 0 9H9"/>',
  trash: '<path d="M4 6h12M8 6V4h4v2M5.5 6l.8 10.5h7.4L14.5 6M8.5 9v5M11.5 9v5"/>',
  edit: '<path d="M4 16l1-3.5L13.5 4l2.5 2.5L7.5 15Z"/>',
  grip: '<circle cx="8" cy="6" r=".9" fill="currentColor"/><circle cx="12" cy="6" r=".9" fill="currentColor"/><circle cx="8" cy="10" r=".9" fill="currentColor"/><circle cx="12" cy="10" r=".9" fill="currentColor"/><circle cx="8" cy="14" r=".9" fill="currentColor"/><circle cx="12" cy="14" r=".9" fill="currentColor"/>',
  record: '<circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="3" fill="currentColor" stroke="none"/>',
  text: '<path d="M4 5.5h12M10 5.5V16M7.5 16h5"/>',
  link: '<path d="M8.5 11.5 11.5 8.5M7 9.5 5.3 11.2a2.8 2.8 0 0 0 4 4L11 13.5M13 10.5l1.7-1.7a2.8 2.8 0 0 0-4-4L9 6.5"/>',
  palette: '<rect x="3" y="4.5" width="14" height="11" rx="2"/><path d="M6 8.5h2M6 11.5h8"/>',
  brush: '<path d="M15.5 3.5 9 10l1.5 1.5L17 5Z"/><path d="M8.6 11.2c-2.3-.4-3.7 1-3.9 2.9-.1 1-.6 1.9-1.7 2.4 2.7.6 6-.3 6.4-3"/>',
  bucket: '<path d="m9 3.5 6.5 6.5L10 15.5 3.5 9Z"/><path d="M3.5 9h12M16.8 12.5s1.2 1.6 1.2 2.5a1.2 1.2 0 0 1-2.4 0c0-.9 1.2-2.5 1.2-2.5Z"/>',
  dropper: '<path d="m12 5 3 3M10.5 6.5l3 3L7 16H4v-3Z"/><path d="M13 3.5a2.1 2.1 0 0 1 3 3l-1.5 1.5-3-3Z"/>',
  gradient: '<rect x="3" y="5" width="14" height="10" rx="1.5"/><path d="M6 5v10M9 5v10" opacity=".35"/><path d="M12 5v10M15 5v10" opacity=".75"/>',
  eraser: '<path d="m8 16 8.5-8.5-4-4L4 12l4 4h8"/><path d="m6 10 4 4"/>',
  play: '<path d="M7 4.5v11l9-5.5Z"/>',
  pause: '<path d="M7 5v10M13 5v10"/>',
  playpause: '<path d="M4 5v10l6-5Z"/><path d="M13 5v10M16 5v10"/>',
  stop: '<rect x="5" y="5" width="10" height="10" rx="1"/>',
  next: '<path d="M4.5 5v10l7-5Z"/><path d="M15 5v10"/>',
  prev: '<path d="M15.5 5v10l-7-5Z"/><path d="M5 5v10"/>',
  volup: '<path d="M3.5 8v4h3l4 3.5v-11L6.5 8Z"/><path d="M13.5 7.5a3.5 3.5 0 0 1 0 5M15.5 5.5a6.4 6.4 0 0 1 0 9"/>',
  voldown: '<path d="M3.5 8v4h3l4 3.5v-11L6.5 8Z"/><path d="M13.5 7.5a3.5 3.5 0 0 1 0 5"/>',
  mute: '<path d="M3.5 8v4h3l4 3.5v-11L6.5 8Z"/><path d="m13 8 4 4M17 8l-4 4"/>',
  calc: '<rect x="4.5" y="3" width="11" height="14" rx="1.5"/><path d="M7 6h6M7 9.5h1M10 9.5h1M13 9.5h0M7 12.5h1M10 12.5h1M13 12.5v2"/>',
  mail: '<rect x="3" y="5" width="14" height="10" rx="1.5"/><path d="m3.5 6 6.5 5 6.5-5"/>',
  computer: '<rect x="3" y="4" width="14" height="9.5" rx="1.2"/><path d="M8 16.5h4M10 13.5v3"/>',
  media: '<circle cx="10" cy="10" r="7"/><path d="M8.5 7v6l4.5-3Z"/>',
  home: '<path d="M3.5 9.5 10 4l6.5 5.5M5.5 8v8h9V8"/>',
  refresh: '<path d="M15.5 6.5A6 6 0 1 0 16 11"/><path d="M15.8 3v3.8H12"/>',
  back: '<path d="M16 10H4.5M9 5.5 4.5 10 9 14.5"/>',
  forward: '<path d="M4 10h11.5M11 5.5l4.5 4.5-4.5 4.5"/>',
  bookmark: '<path d="M6 3.5h8V17l-4-3-4 3Z"/>',
  mouse: '<rect x="6" y="3" width="8" height="14" rx="4"/><path d="M10 3v5"/>',
  mouseL: '<rect x="6" y="3" width="8" height="14" rx="4"/><path d="M10 3v5H6V7a4 4 0 0 1 4-4Z" fill="currentColor"/>',
  mouseR: '<rect x="6" y="3" width="8" height="14" rx="4"/><path d="M10 3v5h4V7a4 4 0 0 0-4-4Z" fill="currentColor"/>',
  mouseM: '<rect x="6" y="3" width="8" height="14" rx="4"/><rect x="9.2" y="5" width="1.6" height="3.4" rx=".8" fill="currentColor"/>',
  wheelUp: '<rect x="6" y="5" width="8" height="12" rx="4"/><path d="M10 1.5v4M8 3.3l2-1.8 2 1.8"/>',
  wheelDown: '<rect x="6" y="3" width="8" height="12" rx="4"/><path d="M10 14.5v4M8 16.7l2 1.8 2-1.8"/>',
  sideBack: '<rect x="6" y="3" width="8" height="14" rx="4"/><path d="M6 10.5h-2.5M4.8 9 3.3 10.5 4.8 12"/>',
  sideFwd: '<rect x="6" y="3" width="8" height="14" rx="4"/><path d="M14 10.5h2.5M15.2 9l1.5 1.5-1.5 1.5"/>',
  disabled: '<circle cx="10" cy="10" r="6.5"/><path d="m5.5 14.5 9-9"/>',
  reset: '<path d="M4.5 10a5.5 5.5 0 1 0 1.8-4.1"/><path d="M4 3.5v3.2h3.2"/>',
  clock: '<circle cx="10" cy="10" r="7"/><path d="M10 6v4.5l3 1.8"/>',
  timer: '<circle cx="10" cy="11" r="6"/><path d="M10 7.5V11l2.2 1.5M8 2.5h4M10 2.5V5"/>',
  cpu: '<rect x="5.5" y="5.5" width="9" height="9" rx="1"/><path d="M8 2.5v3M12 2.5v3M8 14.5v3M12 14.5v3M2.5 8h3M2.5 12h3M14.5 8h3M14.5 12h3"/>',
  plug: '<path d="M7 3v4M13 3v4M5.5 7h9v2.5a4.5 4.5 0 0 1-9 0ZM10 14v3.5"/>',
  warn: '<path d="M10 3.5 17.5 16.5h-15Z"/><path d="M10 8.5v3.5M10 14.3v.2"/>',
  info: '<circle cx="10" cy="10" r="7"/><path d="M10 9v5M10 6.5v.2"/>',
  command: '<rect x="3" y="4.5" width="14" height="11" rx="2"/><path d="M6.5 8.5 9 10l-2.5 1.5M10.5 12.5h3"/>',
  telescope: '<path d="m3.5 11 10-5.5 1.8 3.2-10 5.5Z"/><path d="m15.3 5.5 1.5-.8 1.2 2.2-1.5.8M8.5 12.3 7 17.5M10 11.5l2.5 6"/>',
  eye: '<path d="M2.5 10s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5Z"/><circle cx="10" cy="10" r="2.3"/>',
  layers: '<path d="m10 3.5 7 3.5-7 3.5-7-3.5Z"/><path d="m3 10.5 7 3.5 7-3.5"/>',
  fn: '<rect x="3" y="4.5" width="14" height="11" rx="1.5"/><path d="M7 13V8h2.5M7 10.3h2M11.5 13V9.8a1.4 1.4 0 0 1 2.8 0V13"/>',
  arrows: '<path d="M3.5 10h13M6.5 7 3.5 10l3 3M13.5 7l3 3-3 3"/>',
};

export function icon(name, cls = "") {
  const body = P[name] || P.star;
  return `<svg class="ico ${cls}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export const ICONS = Object.keys(P);

// Фаза луны k из 0..n-1: 0 — новолуние (только контур), n-1 — полнолуние.
export function moonPhase(k, n = 6, size = 22) {
  const r = size / 2 - 1.5, c = size / 2, f = k / (n - 1);
  let lit = "";
  if (f >= 1) lit = `<circle cx="${c}" cy="${c}" r="${r}" fill="currentColor"/>`;
  else if (f > 0) {
    // освещённая правая часть: полуокружность + эллипс терминатора
    const ex = Math.abs(1 - 2 * f) * r, sweep = f < .5 ? 0 : 1;
    lit = `<path d="M${c} ${c - r} A${r} ${r} 0 0 1 ${c} ${c + r} A${ex} ${r} 0 0 ${sweep} ${c} ${c - r}Z" fill="currentColor"/>`;
  }
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="currentColor" stroke-width="1" opacity=".55"/>${lit}</svg>`;
}
