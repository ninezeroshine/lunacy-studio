// Стили набора anatomy (vendor/anatomy/iso-kit.js) — один раз на страницу, с палитрой Lunacy Studio.
// Набор рисует четырьмя тонами по направлению граней; здесь его серые тона заменены холодными тонами ночи.
// .iso-sky — фоновая станция (едва заметная), .iso-dash — приборы «Обзора» (читаемые, золотой акцент).
import { ISO_CSS } from "../../vendor/anatomy/iso-kit.js";

const THEME = `
.iso.iso-sky{
  --anatomy-paper:#050913;--anatomy-face:#081022;--anatomy-top:#0a1224;
  --anatomy-shade-0:#03060d;--anatomy-shade-1:#050912;--anatomy-shade-2:#070c18;--anatomy-shade-3:#09101e;
  --anatomy-lit-top:#10203a;--anatomy-lit-shade:#0b1628;
  --anatomy-hi:#7f9ad2;--anatomy-mid:#3b5180;--anatomy-lo:#243456;--anatomy-faint:#17223b;--anatomy-lit:#8fe3ff;
  --anatomy-halo:#000;--anatomy-halo-opacity:.8;--anatomy-dot:#9fc4ff;--anatomy-weight:.7px;
}
.iso.iso-dash{
  --anatomy-paper:#0d1426;--anatomy-face:#121b31;--anatomy-top:#16203a;
  --anatomy-shade-0:#080d1a;--anatomy-shade-1:#0b1121;--anatomy-shade-2:#0e1528;--anatomy-shade-3:#121a30;
  --anatomy-lit-top:#2a2416;--anatomy-lit-shade:#1d1910;
  --anatomy-hi:#c9d4ec;--anatomy-mid:#5b6c93;--anatomy-lo:#34425f;--anatomy-faint:#1f2942;--anatomy-lit:#f2dcab;
  --anatomy-halo:#01030a;--anatomy-halo-opacity:.85;--anatomy-dot:#dfe7f8;--anatomy-weight:.7px;
  --anatomy-mono:var(--font-note);
}
`;

let done = false;
export function ensureIsoCss() {
  if (done) return;
  done = true;
  const s = document.createElement("style");
  s.dataset.iso = "";
  s.textContent = ISO_CSS + THEME;
  document.head.appendChild(s);
}
