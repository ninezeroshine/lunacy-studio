// План кадров редактора экрана (ui/js/pages/screen-edit.js): бюджет 69 кадров, задержки 20–510 мс с шагом 2,
// «туда-обратно», режимы «плавный фрагмент», «весь отрезок», «как в файле». Без браузера.
// node tests/t14_screen_plan.mjs
import * as ED from "../studio/ui/js/pages/screen-edit.js";

let ok = 0, fail = 0;
const check = (name, cond, info = "") => { cond ? ok++ : fail++; console.log(`${cond ? "OK  " : "FAIL"} ${name}${info ? ` — ${info}` : ""}`); };
const video = { kind: "video", duration: 12 };
const gif = (n, d = 0.1) => ({ kind: "anim", duration: n * d, frames: n, starts: Array.from({ length: n }, (_, i) => i * d), durs: Array(n).fill(d) });
const e = (over) => ({ ...ED.defaults(), ...over });
const delaysOk = (f) => f.every((x) => x.delay >= ED.DELAY_MIN && x.delay <= ED.DELAY_MAX && x.delay % 2 === 0);

// картинка
check("картинка — один кадр", ED.plan({ kind: "image" }, e({})).length === 1);
check("картинка — задержка в пределах прошивки (сервер отвергает > 510)", delaysOk(ED.plan({ kind: "image" }, e({}))));

// плавный фрагмент
let p = ED.plan(video, e({ in: 0, out: 6.9, fps: 10 }));
check("фрагмент 6,9 с при 10 к/с — 69 кадров по 100 мс", p.length === 69 && p.every((x) => x.delay === 100), `${p.length}`);
check("фрагмент: кадры идут по 0,1 с от начала", Math.abs(p[1].t - 0.1) < 1e-9 && Math.abs(p[68].t - 6.8) < 1e-9);
p = ED.plan(video, e({ in: 0, out: 12, fps: 10 }));
check("фрагмент длиннее бюджета обрезается до 69", p.length === 69);
check("maxSpan: 69 кадров при 10 к/с и скорости 1 — 6,9 с", Math.abs(ED.maxSpan(e({ fps: 10 })) - 6.9) < 1e-9);
check("maxSpan: при скорости 2 — вдвое длиннее", Math.abs(ED.maxSpan(e({ fps: 10, speed: 2 })) - 13.8) < 1e-9);
p = ED.plan(video, e({ in: 2, out: 4, fps: 15 }));
check("15 к/с: задержка 66 мс (кратна 2)", p.every((x) => x.delay === 66) && p.length === 30, `${p[0].delay} × ${p.length}`);
p = ED.plan(video, e({ in: 0, out: 1, fps: 2 }));
check("2 к/с: задержка 500 мс", p[0].delay === 500 && p.length === 2);

// весь отрезок
p = ED.plan(video, e({ mode: "whole", in: 0, out: 12 }));
check("весь отрезок 12 с — 69 кадров, задержка ≈ 174 мс", p.length === 69 && p[0].delay === 174, `${p[0].delay}`);
p = ED.plan(video, e({ mode: "whole", in: 0, out: 60 }));
check("весь отрезок 60 с — задержка упирается в 510 мс", p[0].delay === ED.DELAY_MAX && delaysOk(p));
p = ED.plan(video, e({ mode: "whole", in: 0, out: 0.5 }));
check("весь отрезок 0,5 с — задержка не меньше 20 мс", p[0].delay === ED.DELAY_MIN);

// туда-обратно и реверс
p = ED.plan(video, e({ in: 0, out: 12, fps: 10, pingpong: true }));
check("туда-обратно укладывается в 69", p.length <= ED.MAX_FRAMES, `${p.length}`);
check("туда-обратно: 35 вперёд, 33 назад без крайних", p.length === 68 && p[35].t === p[33].t && p[67].t === p[1].t);
p = ED.plan(video, e({ in: 1, out: 2, fps: 10, reverse: true }));
check("реверс: от конца к началу", p[0].t > p[p.length - 1].t);

// как в файле
const g40 = gif(40);
p = ED.plan(g40, e({ mode: "orig", in: 0, out: 4 }));
check("GIF 40 кадров по 100 мс — как в файле: 40 × 100", p.length === 40 && p.every((x) => x.delay === 100));
p = ED.plan(g40, e({ mode: "orig", in: 0, out: 4, speed: 2 }));
check("как в файле ×2 — 40 × 50 мс", p.every((x) => x.delay === 50));
p = ED.plan(gif(120), e({ mode: "orig", in: 0, out: 12 }));
check("GIF 120 кадров — как в файле: первые 69", p.length === 69);
p = ED.plan(gif(10, 0.007), e({ mode: "orig", in: 0, out: 0.07 }));
check("слишком быстрые кадры GIF поднимаются до 20 мс", p.every((x) => x.delay === 20));
const init = ED.initFor({ ...g40, kind: "anim" }, null);
check("GIF до 69 кадров открывается в режиме «как в файле»", init.mode === "orig" && init.out === 4);
const init2 = ED.initFor(video, null);
check("видео открывается плавным фрагментом 6,9 с", init2.mode === "fragment" && Math.abs(init2.out - 6.9) < 1e-9);

// сводка
const s = ED.summary(video, e({ mode: "whole", in: 0, out: 12 }));
check("сводка: 69 кадров, петля ≈ 12 с, ×1", s.frames === 69 && Math.abs(s.loop - 12.006) < 0.01 && Math.abs(s.speedup - 1) < 0.01, JSON.stringify(s));

console.log(`\nитог: ${ok} ок, ${fail} провалов`);
process.exit(fail ? 1 : 0);
