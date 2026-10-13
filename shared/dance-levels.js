export const DANCE_LEVELS = ["BG", "RS", "M", "S", "CH"];

export function parseDanceLevel(value) {
  if (value === null || value === "") return { ok: true, danceLevel: null };
  if (typeof value !== "string" || !DANCE_LEVELS.includes(value)) {
    return { ok: false, message: "Выберите уровень: BG, RS, M, S или CH" };
  }
  return { ok: true, danceLevel: value };
}

export function parseBlockedLevels(value) {
  if (!Array.isArray(value)) return { ok: false, message: "Укажите уровни" };
  const chosen = new Set();
  for (const level of value) {
    if (typeof level !== "string" || !DANCE_LEVELS.includes(level)) {
      return { ok: false, message: "Неизвестный уровень" };
    }
    chosen.add(level);
  }
  return { ok: true, levels: DANCE_LEVELS.filter((level) => chosen.has(level)) };
}
