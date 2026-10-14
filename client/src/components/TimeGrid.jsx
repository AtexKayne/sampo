import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  GRID_ROW_COUNT,
  GRID_START_MINUTES,
  GRID_STEP_MINUTES,
  assignLanes,
  formatMinutes,
  pastRowCount,
  resolveSelection,
  visibleSpan,
} from "../../../shared/calendar-grid.js";
import { formatDayNumber, formatWeekday, slotClock, studioDayKey, studioMinutes } from "../time/zone.js";
import styles from "./TimeGrid.module.scss";

function slotNotes(slot) {
  const notes = [];
  if (slot.status === "cancelled") notes.push("Отменён");
  if (slot.myAttendance) notes.push("Я иду");
  if (slot.unavailable) notes.push("Недоступен");
  else if (slot.free) notes.push("Свободен");
  if (slot.myPendingOutgoing) notes.push("Ждём ответ");
  if (slot.myPendingIncomingCount > 0) notes.push("Вас пригласили");
  return notes;
}

function indexFromY(element, clientY) {
  const rect = element.getBoundingClientRect();
  const rowHeight = rect.height / GRID_ROW_COUNT;
  const index = Math.floor((clientY - rect.top) / rowHeight);
  return Math.max(0, Math.min(GRID_ROW_COUNT - 1, index));
}

function cutFree(block, cuts) {
  let pieces = [{ startMin: block.startMin, endMin: block.endMin }];
  for (const cut of cuts) {
    pieces = pieces.flatMap((piece) => {
      const start = Math.max(cut.startMin, piece.startMin);
      const end = Math.min(cut.endMin, piece.endMin);
      if (end <= start) return [piece];
      const next = [];
      if (start > piece.startMin) next.push({ startMin: piece.startMin, endMin: start });
      if (end < piece.endMin) next.push({ startMin: end, endMin: piece.endMin });
      return next;
    });
  }
  const windowId = block.windowId ?? block.id;
  return pieces
    .filter((piece) => piece.endMin > piece.startMin)
    .map((piece) => ({
      ...block,
      id: `${windowId}-${piece.startMin}`,
      windowId,
      startMin: piece.startMin,
      endMin: piece.endMin,
    }));
}

function paintWindow(block, className) {
  const span = visibleSpan(block.startMin, block.endMin);
  if (!span) return null;
  return (
    <div
      className={className}
      data-window="true"
      data-window-id={block.windowId ?? block.id}
      data-window-label={block.label}
      data-day-key={block.dayKey}
      key={block.id}
      style={{
        top: `calc(var(--row) * ${span.startRow})`,
        height: `calc(var(--row) * ${span.rows})`,
        left: `calc(${block.lane} * 100% / ${block.laneCount} + 1px)`,
        width: `calc(100% / ${block.laneCount} - 2px)`,
      }}
    />
  );
}

function slotPassed(slot, now) {
  return new Date(slot.endsAt).getTime() <= now.getTime();
}

function rangeInsideFree(dayKey, startMin, endMin, freeBlocks, busyBlocks) {
  const cuts = busyBlocks.filter((block) => block.dayKey === dayKey);
  return freeBlocks
    .filter((block) => block.dayKey === dayKey)
    .flatMap((block) => cutFree(block, cuts))
    .some((piece) => piece.startMin < endMin && startMin < piece.endMin);
}

function cellInsideFree(day, index, freeBlocks, busyBlocks) {
  const startMin = GRID_START_MINUTES + index * GRID_STEP_MINUTES;
  return rangeInsideFree(studioDayKey(day), startMin, startMin + GRID_STEP_MINUTES, freeBlocks, busyBlocks);
}

function selectionInsideFree(day, anchor, current, freeBlocks, busyBlocks) {
  const first = Math.min(anchor, current);
  const last = Math.max(anchor, current);
  for (let index = first; index <= last; index += 1) {
    if (!cellInsideFree(day, index, freeBlocks, busyBlocks)) return false;
  }
  return true;
}

const HOLD_MS = 500;

function clearAccidentalSelection() {
  const selection = window.getSelection?.();
  if (!selection || selection.isCollapsed) return;
  const node = selection.anchorNode;
  const element = node instanceof Element ? node : node?.parentElement;
  if (element?.closest("input, textarea, select")) return;
  selection.removeAllRanges();
}

export function TimeGrid({ days, slots, freeBlocks = [], busyBlocks = [], selection, selectionLimits, interactive, now, onSelect, onOpenSlot, onOpenWindow, selectInsideFree = false, showAvailability = false }) {
  const gridRef = useRef(null);
  const dragRef = useRef(null);
  const holdRef = useRef(null);
  const [hover, setHover] = useState(null);
  const todayKey = studioDayKey(now);
  const nowMinutes = studioMinutes(now);

  useEffect(() => {
    const root = gridRef.current;
    if (!root) return undefined;
    const onTouchStart = (event) => {
      const column = event.target.closest("[data-column]");
      if (!column || !root.contains(column)) return;
      if (event.target.closest("[data-slot], a")) return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const pastRows = Number(column.dataset.pastRows);
      if (indexFromY(column, touch.clientY) < pastRows) return;
      event.preventDefault();
    };
    root.addEventListener("touchstart", onTouchStart, { passive: false });
    return () => root.removeEventListener("touchstart", onTouchStart);
  }, []);

  function trackHover(event, day) {
    const key = studioDayKey(day);
    const index = indexFromY(event.currentTarget, event.clientY);
    const pastRows = pastRowCount(key, todayKey, nowMinutes);
    const show =
      interactive &&
      selectInsideFree &&
      event.pointerType === "mouse" &&
      !dragRef.current &&
      index >= pastRows &&
      !event.target.closest("[data-slot]");
    setHover((current) => {
      if (!show) return current ? null : current;
      const insideFree = cellInsideFree(day, index, freeBlocks, busyBlocks);
      if (current && current.dayKey === key && current.index === index && current.insideFree === insideFree) return current;
      return { dayKey: key, index, insideFree };
    });
  }

  function clearHold() {
    if (!holdRef.current) return;
    clearTimeout(holdRef.current.timer);
    holdRef.current = null;
  }

  function freeBlockAt(column, day, clientY) {
    const key = studioDayKey(day);
    const index = indexFromY(column, clientY);
    const startMin = GRID_START_MINUTES + index * GRID_STEP_MINUTES;
    return freeBlocks.find((block) => block.dayKey === key && block.startMin <= startMin && startMin < block.endMin) ?? null;
  }

  function openWindow(day, block) {
    clearHold();
    dragRef.current = null;
    clearAccidentalSelection();
    onSelect(studioDayKey(day), { startMin: null, message: "" });
    onOpenWindow?.({
      id: block.windowId ?? block.id,
      label: block.label ?? "",
      dayKey: block.dayKey,
    });
  }

  function emit(day, anchor, current, committed) {
    const pastRows = pastRowCount(studioDayKey(day), todayKey, nowMinutes);
    const result = resolveSelection(anchor, current, interactive ? pastRows : GRID_ROW_COUNT, selectionLimits);
    if (result.startMin == null) {
      onSelect(studioDayKey(day), { startMin: null, message: "" });
      return;
    }
    onSelect(studioDayKey(day), {
      ...result,
      insideFree: selectionInsideFree(day, anchor, current, freeBlocks, busyBlocks),
      committed: committed && anchor !== current,
    });
  }

  function onPointerDown(event, day) {
    if (!interactive || event.button !== 0) return;
    if (event.target.closest("[data-slot]")) return;
    const pastRows = pastRowCount(studioDayKey(day), todayKey, nowMinutes);
    const index = indexFromY(event.currentTarget, event.clientY);
    const touchOnPast = event.pointerType !== "mouse" && index < pastRows;
    if (touchOnPast) return;
    const block = freeBlockAt(event.currentTarget, day, event.clientY);
    if (block && event.pointerType !== "mouse") {
      clearHold();
      const hold = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        opened: false,
        timer: null,
      };
      hold.timer = setTimeout(() => {
        hold.opened = true;
        openWindow(day, block);
      }, HOLD_MS);
      holdRef.current = hold;
    }
    if (!selectInsideFree && block) return;
    dragRef.current = {
      pointerId: event.pointerId,
      day,
      anchor: index,
      current: index,
      startX: event.clientX,
      startY: event.clientY,
      pointerType: event.pointerType,
    };
    if (event.pointerType === "mouse") setHover(null);
    if (event.pointerType !== "mouse") event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event, day) {
    trackHover(event, day);
    const hold = holdRef.current;
    if (hold && hold.pointerId === event.pointerId) {
      const moved = Math.abs(event.clientX - hold.startX) > 10 || Math.abs(event.clientY - hold.startY) > 10;
      if (moved) clearHold();
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const index = indexFromY(event.currentTarget, event.clientY);
    if (index === drag.current) return;
    drag.current = index;
    emit(drag.day, drag.anchor, index, false);
  }

  function onPointerUp(event, day) {
    const opened = Boolean(holdRef.current?.opened);
    clearHold();
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (opened) return;
    if (drag.anchor !== drag.current) {
      emit(drag.day, drag.anchor, drag.current, true);
      return;
    }
    const singleCell =
      selection?.dayKey === studioDayKey(day) &&
      !selection.committed &&
      selection.endMin - selection.startMin === GRID_STEP_MINUTES;
    if (singleCell) {
      const existing = (selection.startMin - GRID_START_MINUTES) / GRID_STEP_MINUTES;
      if (existing !== drag.anchor) {
        emit(day, existing, drag.anchor, true);
        return;
      }
      onSelect(studioDayKey(day), { startMin: null, message: "" });
      return;
    }
    emit(day, drag.anchor, drag.anchor, false);
  }

  const hours = [];
  for (let minutes = GRID_START_MINUTES + 60; minutes < 24 * 60; minutes += 60) hours.push(minutes);

  return (
    <div
      className={styles.grid}
      ref={gridRef}
      style={{ gridTemplateColumns: `64px repeat(${days.length}, minmax(0, 1fr))` }}
    >
      <div className={styles.corner} />
      {days.map((day) => {
        const key = studioDayKey(day);
        return (
          <div className={key === todayKey ? styles.today : styles.dayHead} key={key}>
            <span>{formatWeekday(day)}</span>
            <span>{formatDayNumber(day)}</span>
          </div>
        );
      })}
      <div className={styles.times}>
        {hours.map((minutes) => {
          const index = (minutes - GRID_START_MINUTES) / GRID_STEP_MINUTES;
          return (
            <span className={styles.tick} key={minutes} style={{ top: `calc(var(--row) * ${index})` }}>
              {formatMinutes(minutes)}
            </span>
          );
        })}
      </div>
      {days.map((day) => {
        const key = studioDayKey(day);
        const pastRows = pastRowCount(key, todayKey, nowMinutes);
        const dayBusy = busyBlocks.filter((block) => block.dayKey === key);
        const freePlaced = freeBlocks
          .filter((block) => block.dayKey === key)
          .flatMap((block) => cutFree(block, dayBusy))
          .map((block) => ({ ...block, lane: 0, laneCount: 1 }));
        const placed = assignLanes(
          slots
            .map((slot) => ({ slot, clock: slotClock(slot.startsAt, slot.endsAt) }))
            .filter((item) => item.clock?.dayKey === key)
            .map((item) => ({ ...item, startMin: item.clock.startMin, endMin: item.clock.endMin })),
        );
        const selected = selection?.dayKey === key ? visibleSpan(selection.startMin, selection.endMin) : null;
        return (
          <div
            className={[interactive ? styles.column : styles.columnStatic, showAvailability ? styles.availability : ""].filter(Boolean).join(" ")}
            data-column="true"
            data-past-rows={pastRows}
            key={key}
            onPointerDown={(event) => onPointerDown(event, day)}
            onPointerMove={(event) => onPointerMove(event, day)}
            onPointerUp={(event) => onPointerUp(event, day)}
            onPointerLeave={() => {
              if (!dragRef.current) clearHold();
              setHover((current) => (current ? null : current));
            }}
            onPointerCancel={() => {
              clearHold();
              dragRef.current = null;
            }}
            onContextMenu={(event) => {
              if (event.target.closest("[data-slot]")) return;
              const block = freeBlockAt(event.currentTarget, day, event.clientY);
              if (!block) return;
              event.preventDefault();
              openWindow(day, block);
            }}
          >
            {pastRows > 0 ? <div className={styles.past} style={{ height: `calc(var(--row) * ${pastRows})` }} /> : null}
            {interactive && pastRows < GRID_ROW_COUNT ? (
              <div className={styles.selectable} style={{ top: `calc(var(--row) * ${pastRows})` }} />
            ) : null}
            {showAvailability ? freePlaced.map((block) => paintWindow(block, styles.free)) : null}
            {hover?.dayKey === key ? (
              <div
                className={hover.insideFree ? styles.hoverBusy : styles.hoverFree}
                style={{ top: `calc(var(--row) * ${hover.index})` }}
              />
            ) : null}
            {selected ? (
              <div
                className={selectInsideFree ? (selection.insideFree ? styles.selectionBusy : styles.selectionFree) : styles.selection}
                style={{
                  top: `calc(var(--row) * ${selected.startRow})`,
                  height: `calc(var(--row) * ${selected.rows})`,
                }}
              />
            ) : null}
            {placed.map(({ slot, clock, lane, laneCount }) => {
              const span = visibleSpan(clock.startMin, clock.endMin);
              if (!span) return null;
              const time = `${formatMinutes(clock.startMin)}–${formatMinutes(clock.endMin)}`;
              const notes = slotNotes(slot);
              const pairName = slot.myPair?.partnerName;
              const label = [`${time}, ${slot.place}`, ...notes, pairName ? `Пара с ${pairName}` : ""].filter(Boolean).join(", ");
              const passed = slotPassed(slot, now);
              const inFree = rangeInsideFree(key, clock.startMin, clock.endMin, freeBlocks, busyBlocks);
              const boxStyle = {
                top: `calc(var(--row) * ${span.startRow})`,
                height: `calc(var(--row) * ${span.rows})`,
                left: `calc(${lane} * 100% / ${laneCount} + 1px)`,
                width: `calc(100% / ${laneCount} - 2px)`,
              };
              const body = (
                <>
                  <span>{time}</span>
                  <span>{slot.place}</span>
                  {notes.map((note) => (
                    <span key={note}>{note}</span>
                  ))}
                  {pairName ? (
                    <span>
                      Пара с{" "}
                      {slot.myPair.partnerId ? (
                        <Link className={styles.partner} to={`/dancers/${slot.myPair.partnerId}`} onClick={(event) => event.stopPropagation()}>
                          {pairName}
                        </Link>
                      ) : (
                        pairName
                      )}
                    </span>
                  ) : null}
                </>
              );
              const tone = slot.status === "cancelled" ? styles.slotCancelled : !showAvailability ? "" : inFree ? styles.slotFree : styles.slotBusy;
              const className = [styles.slot, tone, passed ? styles.slotPast : ""].filter(Boolean).join(" ");
              if (passed) {
                return (
                  <div className={className} data-slot="true" key={slot.id} title={label} style={boxStyle}>
                    {body}
                  </div>
                );
              }
              return (
                <div
                  className={className}
                  data-slot="true"
                  key={slot.id}
                  role="button"
                  tabIndex={0}
                  title={label}
                  style={boxStyle}
                  onClick={(event) => {
                    if (event.target.closest("a")) return;
                    onOpenSlot(slot);
                  }}
                  onKeyDown={(event) => {
                    if (event.target.closest("a")) return;
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    onOpenSlot(slot);
                  }}
                >
                  {body}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
