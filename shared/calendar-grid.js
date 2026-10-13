export const GRID_START_MINUTES = 9 * 60;
export const GRID_END_MINUTES = 24 * 60;
export const GRID_STEP_MINUTES = 30;
export const GRID_ROW_COUNT = (GRID_END_MINUTES - GRID_START_MINUTES) / GRID_STEP_MINUTES;
export const MAX_SLOT_MINUTES = 6 * 60;

export function formatMinutes(minutes) {
  const clock = minutes === GRID_END_MINUTES ? 0 : minutes;
  const hour = String(Math.floor(clock / 60)).padStart(2, "0");
  const minute = String(clock % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

export function pastRowCount(dayKey, todayKey, nowMinutes) {
  if (dayKey < todayKey) return GRID_ROW_COUNT;
  if (dayKey > todayKey) return 0;
  if (nowMinutes < GRID_START_MINUTES) return 0;
  if (nowMinutes >= GRID_END_MINUTES) return GRID_ROW_COUNT;
  let count = 0;
  for (let index = 0; index < GRID_ROW_COUNT; index += 1) {
    const start = GRID_START_MINUTES + index * GRID_STEP_MINUTES;
    if (start <= nowMinutes) count += 1;
    else break;
  }
  return count;
}

export function resolveSelection(anchorIndex, currentIndex, pastRows, limits = {}) {
  const maxMinutes = limits.maxMinutes ?? MAX_SLOT_MINUTES;
  const pastMessage = limits.pastMessage ?? "Нельзя создать слот в прошлом";
  const longMessage = limits.longMessage ?? "Длительность слота от 30 минут до 6 часов";
  const first = Math.min(anchorIndex, currentIndex);
  const last = Math.max(anchorIndex, currentIndex);
  if (last < pastRows) {
    return { ok: false, message: pastMessage };
  }
  const start = Math.max(first, pastRows);
  const startMin = GRID_START_MINUTES + start * GRID_STEP_MINUTES;
  const endMin = GRID_START_MINUTES + (last + 1) * GRID_STEP_MINUTES;
  if (endMin - startMin > maxMinutes) {
    return {
      ok: false,
      message: longMessage,
      startMin,
      endMin,
    };
  }
  return { ok: true, message: "", startMin, endMin };
}

export function visibleSpan(startMin, endMin) {
  const start = Math.max(startMin, GRID_START_MINUTES);
  const end = Math.min(endMin, GRID_END_MINUTES);
  if (end <= start) return null;
  return {
    startRow: (start - GRID_START_MINUTES) / GRID_STEP_MINUTES,
    rows: (end - start) / GRID_STEP_MINUTES,
  };
}

export function assignLanes(items) {
  const sorted = [...items].sort((left, right) => left.startMin - right.startMin || left.endMin - right.endMin);
  const laneEnds = [];
  const placed = sorted.map((item) => {
    let lane = laneEnds.findIndex((end) => end <= item.startMin);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(item.endMin);
    } else {
      laneEnds[lane] = item.endMin;
    }
    return { ...item, lane };
  });
  const laneCount = Math.max(1, laneEnds.length);
  return placed.map((item) => ({ ...item, laneCount }));
}
