// «Отменить» в уведомлении о правке черновика: снимает именно этот шаг. Если после него были другие правки
// или шаг уже записан в клавиатуру, ничего не трогает и объясняет почему.
import * as D from "./drafts.js";
import { toast } from "./feedback.js";

export function undoThis(kind, pre) {
  const at = D.version();
  return () => {
    if (D.version() === at) pre?.();
    const r = D.undoIfLatest(kind, at);
    if (r === "stale") toast("Это уже не отменить отсюда", { sub: "После этого были другие правки — используй «Шаг назад»" });
    if (r === "gone") toast("Отменять нечего", { sub: "Изменение уже записано в клавиатуру" });
  };
}
