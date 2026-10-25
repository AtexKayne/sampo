import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, logout } from "../api/client.js";
import { Sheet } from "../components/Sheet.jsx";
import { Shell } from "../components/Shell.jsx";
import { TimeGrid } from "../components/TimeGrid.jsx";
import { SlotPanel } from "./SlotPage.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import { GRID_END_MINUTES, GRID_START_MINUTES, GRID_STEP_MINUTES, formatMinutes } from "../../../shared/calendar-grid.js";
import {
  addStudioDays,
  calendarAnchor,
  dayStarts,
  formatDayNumber,
  formatDayTitle,
  formatRange,
  formatSlotTime,
  formatWeekday,
  slotClock,
  studioDayKey,
  studioLocalValue,
  studioWeekday,
} from "../time/zone.js";
import styles from "./CalendarPage.module.scss";

const CALENDAR_VIEW_KEY = "sampo.calendar-view";

function readCalendarView() {
  try {
    return localStorage.getItem(CALENDAR_VIEW_KEY) === "list";
  } catch {
    return false;
  }
}

function rememberCalendarView(list) {
  try {
    localStorage.setItem(CALENDAR_VIEW_KEY, list ? "list" : "grid");
  } catch {
    // Текущий заход всё равно держит выбранный вид.
  }
}

function useWide() {
  const query = "(min-width: 800px)";
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setWide(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return wide;
}

export function CalendarPage({ heading = "Календарь", adminOnly = false, availabilityOnly = false }) {
  const session = useSession();
  const queryClient = useQueryClient();
  const wide = useWide();
  const [weekOffset, setWeekOffset] = useState(0);
  const [pickedDay, setPickedDay] = useState(0);
  const [pending, setPending] = useState(false);
  const [selection, setSelection] = useState(null);
  const [place, setPlace] = useState("Зал 1");
  const [capacity, setCapacity] = useState("20");
  const [description, setDescription] = useState("");
  const [responsible, setResponsible] = useState(null);
  const [repeatWeekly, setRepeatWeekly] = useState("0");
  const [formError, setFormError] = useState("");
  const [editing, setEditing] = useState(null);
  const [editPlace, setEditPlace] = useState("");
  const [editCapacity, setEditCapacity] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editResponsible, setEditResponsible] = useState(null);
  const [editError, setEditError] = useState("");
  const [deletePrompt, setDeletePrompt] = useState(false);
  const [purpose, setPurpose] = useState("slot");
  const [windowEdit, setWindowEdit] = useState(null);
  const [windowDelete, setWindowDelete] = useState(false);
  const [windowError, setWindowError] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [agenda, setAgenda] = useState(readCalendarView);
  const [repeat, setRepeat] = useState("once");
  const [intervalDays, setIntervalDays] = useState("2");
  const anchor = calendarAnchor(weekOffset);
  const days = dayStarts(anchor, 7);
  const rangeEnd = addStudioDays(anchor, 7);
  const visibleDays = wide ? days : [days[pickedDay] ?? days[0]];
  const canCreate = session.user?.appRole === "admin";
  const slotsQuery = useQuery({
    queryKey: ["slots", anchor.toISOString(), rangeEnd.toISOString()],
    queryFn: () =>
      api(`/api/slots?from=${encodeURIComponent(anchor.toISOString())}&to=${encodeURIComponent(rangeEnd.toISOString())}`),
    enabled: session.status === "ready" && Boolean(session.user),
  });
  const windowsQuery = useQuery({
    queryKey: ["windows"],
    queryFn: () => api("/api/me/windows"),
    enabled: session.status === "ready" && session.user?.appRole !== "admin",
  });

  useEffect(() => {
    if (!editing && !windowEdit) return undefined;
    const clear = () => {
      const picked = window.getSelection();
      if (!picked || picked.isCollapsed) return;
      const node = picked.anchorNode;
      const element = node instanceof Element ? node : node?.parentElement;
      if (element?.closest("input, textarea, select")) return;
      picked.removeAllRanges();
    };
    clear();
    const frame = requestAnimationFrame(clear);
    document.addEventListener("selectionchange", clear);
    let tail = 0;
    const stop = () => {
      document.removeEventListener("pointerup", stop, true);
      document.removeEventListener("pointercancel", stop, true);
      clear();
      window.clearTimeout(tail);
      tail = window.setTimeout(() => document.removeEventListener("selectionchange", clear), 400);
    };
    document.addEventListener("pointerup", stop, true);
    document.addEventListener("pointercancel", stop, true);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(tail);
      document.removeEventListener("selectionchange", clear);
      document.removeEventListener("pointerup", stop, true);
      document.removeEventListener("pointercancel", stop, true);
    };
  }, [editing, windowEdit]);

  useEffect(() => {
    if (!editing && !selection && !windowEdit && !helpOpen) return undefined;
    function onKey(event) {
      if (event.key !== "Escape") return;
      if (helpOpen) {
        setHelpOpen(false);
        return;
      }
      if (windowDelete) {
        setWindowDelete(false);
        return;
      }
      if (windowEdit) {
        setWindowEdit(null);
        setWindowError("");
        return;
      }
      if (editing) {
        setEditing(null);
        return;
      }
      setSelection(null);
      setFormError("");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, selection, windowEdit, windowDelete, helpOpen]);

  const createSlot = useMutation({
    mutationFn: (body) => api("/api/admin/slots", { method: "POST", body }),
    onSuccess: async () => {
      setSelection(null);
      setFormError("");
      setDescription("");
      setResponsible(null);
      await queryClient.invalidateQueries({ queryKey: ["slots"] });
    },
    onError: (error) => setFormError(error.message),
  });

  const saveSlot = useMutation({
    mutationFn: ({ id, body }) => api(`/api/admin/slots/${id}`, { method: "PATCH", body }),
    onSuccess: async () => {
      setEditing(null);
      setEditError("");
      await queryClient.invalidateQueries({ queryKey: ["slots"] });
    },
    onError: (error) => setEditError(error.message),
  });

  const createWindow = useMutation({
    mutationFn: (body) => api("/api/me/windows", { method: "POST", body }),
    onSuccess: async () => {
      setSelection(null);
      setFormError("");
      await queryClient.invalidateQueries({ queryKey: ["windows"] });
      await queryClient.invalidateQueries({ queryKey: ["slots"] });
    },
    onError: (error) => setFormError(error.message),
  });

  const saveWindow = useMutation({
    mutationFn: ({ id, body }) => api(`/api/me/windows/${id}`, { method: "PATCH", body }),
    onSuccess: async () => {
      setWindowEdit(null);
      setWindowDelete(false);
      setWindowError("");
      await queryClient.invalidateQueries({ queryKey: ["windows"] });
      await queryClient.invalidateQueries({ queryKey: ["slots"] });
    },
    onError: (error) => setWindowError(error.message),
  });

  const removeWindow = useMutation({
    mutationFn: ({ id, scope, day }) => api(`/api/me/windows/${id}?scope=${scope}&day=${encodeURIComponent(day ?? "")}`, { method: "DELETE" }),
    onSuccess: async () => {
      setWindowEdit(null);
      setWindowDelete(false);
      setWindowError("");
      await queryClient.invalidateQueries({ queryKey: ["windows"] });
      await queryClient.invalidateQueries({ queryKey: ["slots"] });
    },
    onError: (error) => setWindowError(error.message),
  });

  const deleteSlot = useMutation({
    mutationFn: ({ id, scope }) => api(`/api/admin/slots/${id}?scope=${scope}`, { method: "DELETE" }),
    onSuccess: async () => {
      setEditing(null);
      setEditError("");
      await queryClient.invalidateQueries({ queryKey: ["slots"] });
    },
    onError: (error) => setEditError(error.message),
  });

  if (session.status === "loading") return <p className={styles.status}>Загрузка</p>;
  if (session.status === "error") {
    return (
      <main className={styles.fallback}>
        <p className={styles.error}>Нет сети</p>
        <button className={styles.button} type="button" onClick={session.retry}>
          Повторить
        </button>
      </main>
    );
  }
  if (!session.user) return <Navigate to="/login" replace />;
  if (adminOnly && session.user.appRole !== "admin") return <Navigate to="/calendar" replace />;
  if (availabilityOnly && session.user.appRole === "admin") return <Navigate to="/calendar" replace />;

  async function onLogout() {
    setPending(true);
    try {
      await logout();
      session.setUser(null);
    } catch {
      setPending(false);
    }
  }

  function chooseView(list) {
    setAgenda(list);
    rememberCalendarView(list);
  }

  function changeWeek(next) {
    if (next < 0) return;
    setWeekOffset(next);
    setSelection(null);
    setWindowEdit(null);
    setWindowDelete(false);
    setFormError("");
  }

  function openEdit(slot) {
    if (new Date(slot.endsAt).getTime() <= Date.now()) return;
    setSelection(null);
    setWindowEdit(null);
    setWindowDelete(false);
    setFormError("");
    setEditing(slot);
    setEditPlace(slot.place);
    setEditCapacity(String(slot.capacity));
    setEditDescription(slot.description ?? "");
    setEditResponsible(slot.responsible ?? null);
    setEditError("");
    setDeletePrompt(false);
  }

  function closeEdit() {
    setEditing(null);
    setDeletePrompt(false);
  }

  function choosePurpose(next) {
    setPurpose(next);
    setSelection(null);
    setWindowEdit(null);
    setWindowDelete(false);
    setFormError("");
  }

  function onSelect(dayKey, result) {
    const index = days.findIndex((day) => studioDayKey(day) === dayKey);
    if (index >= 0) setPickedDay(index);
    if (result.startMin == null) {
      setSelection(null);
      setFormError(result.message);
      return;
    }
    setWindowEdit(null);
    setWindowDelete(false);
    setSelection({
      dayKey,
      startMin: result.startMin,
      endMin: result.endMin,
      ok: result.ok,
      insideFree: result.insideFree,
      committed: result.committed,
    });
    setFormError(result.ok ? "" : result.message);
  }

  function onSubmit(event) {
    event.preventDefault();
    if (!selection?.ok) return;
    setFormError("");
    createSlot.mutate({
      startsAtLocal: studioLocalValue(selection.dayKey, selection.startMin),
      endsAtLocal: studioLocalValue(selection.dayKey, selection.endMin),
      place,
      capacity: Number(capacity),
      description,
      responsibleUserId: responsible?.id ?? null,
      repeatWeekly: Number(repeatWeekly),
    });
  }

  const now = new Date();
  const todayKey = studioDayKey(now);
  const selectedDay = days.find((day) => studioDayKey(day) === selection?.dayKey);
  const slots = slotsQuery.data?.slots ?? [];
  const slotDays = new Set(slots.map((slot) => dayKeyOfSlot(slot)));
  const upcomingSlots = slots
    .filter((slot) => new Date(slot.endsAt).getTime() > now.getTime())
    .sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt));
  const showAgenda = !wide && agenda;
  const dancer = session.user.appRole !== "admin";
  const markingAvailability = dancer && !adminOnly && (availabilityOnly || !canCreate || purpose !== "slot");
  const selectionBusy = Boolean(selection?.insideFree);
  const freeLimits = {
    maxMinutes: 15 * 60,
    pastMessage: "Нельзя отметить прошедшее время",
    longMessage: "Окно — от 30 минут до 15 часов",
  };
  const freeSpan = selection ? selection.endMin - selection.startMin : 0;
  const onceOk = Boolean(selection?.ok) && freeSpan <= 15 * 60;
  const repeatSpanOk = freeSpan >= GRID_STEP_MINUTES;
  const repeatEndOk = !selection || selection.endMin <= GRID_END_MINUTES;
  const weeklyOk = Boolean(selection?.ok) && repeatSpanOk && repeatEndOk;
  const windows = windowsQuery.data?.windows ?? [];
  const editedWindow = windowEdit ? windows.find((item) => item.id === windowEdit.id && !item.blocked) : null;
  const editedDay = windowEdit ? days.find((day) => studioDayKey(day) === windowEdit.dayKey) : null;
  const freeBlocks = days.flatMap((day) => blocksOnDay(windows, day));
  const fillGap = Boolean(
    selection &&
      !selection.insideFree &&
      freeBlocks.some(
        (block) => block.dayKey === selection.dayKey && block.startMin <= selection.endMin && selection.startMin <= block.endMin,
      ),
  );
  const busyBlocks = [];
  const startedSlot = editing ? new Date(editing.startsAt).getTime() <= Date.now() : false;
  const canEditSlot = Boolean(editing) && editing.status === "open" && !startedSlot;

  return (
    <Shell user={session.user} onLogout={onLogout} pending={pending}>
      <div className={styles.head}>
        <h1 className={styles.title}>{heading}</h1>
        {dancer ? (
          <button className={styles.helpLink} type="button" onClick={() => setHelpOpen(true)}>
            Как пользоваться?
          </button>
        ) : null}
      </div>
      {dancer && canCreate && !adminOnly && !availabilityOnly ? (
        <div className={styles.modes}>
          <button
            className={purpose === "slot" ? styles.primary : styles.button}
            type="button"
            onClick={() => choosePurpose(!dancer || purpose !== "slot" ? "slot" : "free")}
          >
            Новый слот
          </button>
        </div>
      ) : null}
      <div className={styles.gridBar}>
        {slotsQuery.isSuccess && markingAvailability ? (
          <div className={styles.legend}>
            <span className={styles.legendBusy}>Недоступен</span>
            <span className={styles.legendFree}>Свободен</span>
          </div>
        ) : null}
        <div className={styles.barMain}>
          <div className={styles.pager}>
            <button
              className={styles.navButton}
              type="button"
              aria-label="Предыдущая неделя"
              disabled={weekOffset <= 0}
              onClick={() => changeWeek(weekOffset - 1)}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="M14.5 6.5 9 12l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <p className={styles.range}>{formatRange(anchor, rangeEnd)}</p>
            <button className={styles.navButton} type="button" aria-label="Следующая неделя" onClick={() => changeWeek(weekOffset + 1)}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="M9.5 6.5 15 12l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          {wide ? null : (
            <div className={styles.viewSwitch} role="group" aria-label="Вид календаря">
              <button
                className={[styles.navButton, agenda ? "" : styles.navOn].filter(Boolean).join(" ")}
                type="button"
                aria-label="Сетка"
                aria-pressed={!agenda}
                onClick={() => chooseView(false)}
              >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path d="M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </button>
              <button
                className={[styles.navButton, agenda ? styles.navOn : ""].filter(Boolean).join(" ")}
                type="button"
                aria-label="Список"
                aria-pressed={agenda}
                onClick={() => chooseView(true)}
              >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <circle cx="5" cy="7" r="1.15" fill="currentColor" />
                  <circle cx="5" cy="12" r="1.15" fill="currentColor" />
                  <circle cx="5" cy="17" r="1.15" fill="currentColor" />
                  <path d="M9 7h11M9 12h11M9 17h11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
      {!wide && !agenda ? (
        <div className={styles.strip}>
          {days.map((day, index) => {
            const key = studioDayKey(day);
            const past = key < todayKey;
            const hasSlots = slotDays.has(key);
            return (
              <button
                className={[index === pickedDay && !past ? styles.stripOn : styles.stripDay, hasSlots ? styles.stripHas : ""].filter(Boolean).join(" ")}
                key={key}
                type="button"
                disabled={past}
                onClick={() => setPickedDay(index)}
              >
                <span>{formatWeekday(day)}</span>
                <span>{formatDayNumber(day)}</span>
                {hasSlots ? <span className={styles.stripNote}>есть слоты</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
      {slotsQuery.isLoading ? <p className={styles.status}>Загрузка</p> : null}
      {slotsQuery.isError ? (
        <div className={styles.fallback}>
          <p className={styles.error}>{slotsQuery.error.message}</p>
          <button className={styles.button} type="button" onClick={() => slotsQuery.refetch()}>
            Повторить
          </button>
        </div>
      ) : null}
      {slotsQuery.isSuccess && showAgenda ? (
        <SlotAgenda slots={upcomingSlots} markingAvailability={markingAvailability} freeBlocks={freeBlocks} onOpen={openEdit} />
      ) : null}
      {slotsQuery.isSuccess && !showAgenda ? (
        <>
          <TimeGrid
            days={visibleDays}
            slots={slots}
            freeBlocks={freeBlocks}
            busyBlocks={busyBlocks}
            selection={selection}
            selectionLimits={markingAvailability ? freeLimits : undefined}
            interactive={markingAvailability || canCreate}
            selectInsideFree={markingAvailability}
            showAvailability={markingAvailability}
            now={now}
            onSelect={onSelect}
            onOpenSlot={openEdit}
            onOpenWindow={(item) => {
              setSelection(null);
              setFormError("");
              setWindowError("");
              setWindowDelete(false);
              setWindowEdit(item);
            }}
          />
        </>
      ) : null}
      {markingAvailability && selection?.committed && selectedDay ? (
        <FreeTimeDialog
          day={selectedDay}
          selection={selection}
          repeat={repeatForDay(repeat, studioWeekday(selectedDay))}
          intervalDays={intervalDays}
          formError={formError}
          blocked={selectionBusy}
          fillGap={fillGap}
          onceOk={onceOk}
          recurringOk={weeklyOk}
          repeatSpanOk={repeatSpanOk}
          repeatEndOk={repeatEndOk}
          pending={createWindow.isPending}
          onRepeat={setRepeat}
          onIntervalDays={(value) => {
            setRepeat("interval");
            setIntervalDays(value);
          }}
          onClose={() => {
            setSelection(null);
            setFormError("");
          }}
          onSave={(body) => {
            setFormError("");
            createWindow.mutate(selectionBusy ? { ...body, blocked: true } : body);
          }}
        />
      ) : null}
      {editedWindow && editedDay ? (
        <WindowEditDialog
          key={`${editedWindow.id}:${windowEdit.dayKey}`}
          window={editedWindow}
          day={editedDay}
          confirming={windowDelete}
          error={windowError}
          pending={saveWindow.isPending || removeWindow.isPending}
          onClose={() => {
            setWindowEdit(null);
            setWindowDelete(false);
            setWindowError("");
          }}
          onAskDelete={() => {
            setWindowError("");
            setWindowDelete(true);
          }}
          onBack={() => setWindowDelete(false)}
          onSave={(body) => {
            setWindowError("");
            saveWindow.mutate({ id: editedWindow.id, body });
          }}
          onDelete={(scope) => {
            setWindowError("");
            removeWindow.mutate({ id: editedWindow.id, scope, day: windowEdit.dayKey });
          }}
        />
      ) : null}
      {canCreate && !markingAvailability && selection?.committed && selectedDay ? (
        <form className={styles.dock} onSubmit={onSubmit}>
          <p className={styles.selectionLabel}>
            {formatDayTitle(selectedDay)}, {formatMinutes(selection.startMin)}–{formatMinutes(selection.endMin)}
          </p>
          <label className={styles.field}>
            <span className={styles.label}>Зал</span>
            <input className={styles.input} required value={place} onChange={(event) => setPlace(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Вместимость</span>
            <input
              className={styles.input}
              type="number"
              min="1"
              max="200"
              required
              value={capacity}
              onChange={(event) => setCapacity(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Описание</span>
            <textarea className={styles.area} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <ResponsibleField value={responsible} onChange={setResponsible} />
          <label className={styles.field}>
            <span className={styles.label}>Ещё столько же недель</span>
            <input
              className={styles.input}
              type="number"
              min="0"
              max="12"
              required
              value={repeatWeekly}
              onChange={(event) => setRepeatWeekly(event.target.value)}
            />
          </label>
          {formError ? <p className={styles.error}>{formError}</p> : null}
          <div className={styles.actions}>
            <button className={styles.primary} type="submit" disabled={!selection.ok || createSlot.isPending}>
              Создать слот
            </button>
            <button
              className={styles.button}
              type="button"
              onClick={() => {
                setSelection(null);
                setFormError("");
              }}
            >
              Сбросить
            </button>
          </div>
        </form>
      ) : null}
      {!selection && formError ? <p className={styles.error}>{formError}</p> : null}
      {editing ? (
        <Sheet onClose={closeEdit} labelledBy="slot-dialog-title" size="l">
            <SlotPanel id={editing.id} onClose={closeEdit} />
            {canCreate ? (
              <form
                className={styles.adminFields}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!canEditSlot) return;
                  setEditError("");
                  saveSlot.mutate({
                    id: editing.id,
                    body: {
                      place: editPlace,
                      capacity: Number(editCapacity),
                      description: editDescription,
                      responsibleUserId: editResponsible?.id ?? null,
                    },
                  });
                }}
              >
                <label className={styles.field}>
                  <span className={styles.label}>Зал</span>
                  <input
                    className={styles.input}
                    required
                    value={editPlace}
                    disabled={!canEditSlot}
                    onChange={(event) => setEditPlace(event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Вместимость</span>
                  <input
                    className={styles.input}
                    type="number"
                    min="1"
                    max="200"
                    required
                    value={editCapacity}
                    disabled={!canEditSlot}
                    onChange={(event) => setEditCapacity(event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Описание</span>
                  <textarea
                    className={styles.area}
                    maxLength={1000}
                    value={editDescription}
                    disabled={!canEditSlot}
                    onChange={(event) => setEditDescription(event.target.value)}
                  />
                </label>
                <ResponsibleField value={editResponsible} disabled={!canEditSlot} onChange={setEditResponsible} />
                {startedSlot ? <p className={styles.error}>Нельзя изменить начавшийся слот</p> : null}
                {deletePrompt ? (
                  <p className={styles.lead}>Слот повторён на другие недели. Удалить только его или все связанные? Уже начавшиеся останутся.</p>
                ) : null}
                {editError ? <p className={styles.error}>{editError}</p> : null}
                <div className={styles.actions}>
                  {deletePrompt ? (
                    <>
                      <button
                        className={styles.button}
                        type="button"
                        disabled={deleteSlot.isPending}
                        onClick={() => deleteSlot.mutate({ id: editing.id, scope: "one" })}
                      >
                        Только этот слот
                      </button>
                      <button
                        className={styles.danger}
                        type="button"
                        disabled={deleteSlot.isPending}
                        onClick={() => deleteSlot.mutate({ id: editing.id, scope: "series" })}
                      >
                        Все связанные
                      </button>
                      <button className={styles.button} type="button" onClick={() => setDeletePrompt(false)}>
                        Назад
                      </button>
                    </>
                  ) : (
                    <>
                      {canEditSlot ? (
                        <button className={styles.primary} type="submit" disabled={saveSlot.isPending || deleteSlot.isPending}>
                          Сохранить
                        </button>
                      ) : null}
                      {startedSlot ? null : (
                        <button
                          className={styles.danger}
                          type="button"
                          disabled={saveSlot.isPending || deleteSlot.isPending}
                          onClick={() => {
                            if (editing.seriesId) {
                              setDeletePrompt(true);
                              return;
                            }
                            deleteSlot.mutate({ id: editing.id, scope: "one" });
                          }}
                        >
                          Удалить слот
                        </button>
                      )}
                    </>
                  )}
                </div>
              </form>
            ) : null}
        </Sheet>
      ) : null}
      {helpOpen ? <HelpDialog onClose={() => setHelpOpen(false)} /> : null}
    </Shell>
  );
}

function dayKeyOfSlot(slot) {
  return slotClock(slot.startsAt, slot.endsAt)?.dayKey ?? studioDayKey(new Date(slot.startsAt));
}

function slotNotes(slot) {
  const notes = [];
  if (slot.status === "cancelled") notes.push("Отменён");
  if (slot.myAttendance && !slot.myPair && !slot.withPartner) notes.push("Приду один");
  if (slot.unavailable) notes.push("Недоступен");
  if (slot.myPendingOutgoing) notes.push("Ждём ответ");
  if (slot.myPendingIncomingCount > 0) notes.push("Вас пригласили");
  if (slot.myPair?.partnerName) notes.push(`Пара с ${slot.myPair.partnerName}`);
  return notes;
}

function slotOverlapsFree(slot, freeBlocks) {
  const clock = slotClock(slot.startsAt, slot.endsAt);
  if (!clock) return false;
  return freeBlocks.some((block) => block.dayKey === clock.dayKey && block.startMin < clock.endMin && clock.startMin < block.endMin);
}

function agendaGroups(slots) {
  const groups = [];
  for (const slot of slots) {
    const dayKey = dayKeyOfSlot(slot);
    const last = groups.at(-1);
    if (last?.dayKey === dayKey) last.slots.push(slot);
    else groups.push({ dayKey, slots: [slot] });
  }
  return groups;
}

function SlotAgenda({ slots, markingAvailability, freeBlocks, onOpen }) {
  const groups = agendaGroups(slots);
  if (groups.length === 0) return <p className={styles.status}>Ближайших слотов нет</p>;
  return (
    <div className={styles.agenda}>
      {groups.map((group) => (
        <section key={group.dayKey}>
          <h2 className={styles.agendaDay}>{formatDayTitle(new Date(group.slots[0].startsAt))}</h2>
          <ul className={styles.agendaList}>
            {group.slots.map((slot) => {
              const notes = slotNotes(slot);
              const inFree = markingAvailability && slotOverlapsFree(slot, freeBlocks);
              const tone =
                slot.status === "cancelled" ? styles.slotRowMuted : markingAvailability ? (inFree ? styles.slotRowFree : styles.slotRowBusy) : "";
              return (
                <li key={slot.id}>
                  <button className={[styles.slotRow, tone].filter(Boolean).join(" ")} type="button" onClick={() => onOpen(slot)}>
                    <span className={styles.slotRowMain}>
                      <span className={styles.slotRowTime}>{formatSlotTime(slot.startsAt, slot.endsAt)}</span>
                      <span>{slot.place}</span>
                    </span>
                    {notes.length > 0 ? <span className={styles.slotRowMeta}>{notes.join(" · ")}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function HelpDialog({ onClose }) {
  return (
    <Sheet onClose={onClose} labelledBy="calendar-help-title" size="xl">
        <div className={styles.modalHead}>
          <h2 className={styles.modalTitle} id="calendar-help-title">
            Как пользоваться
          </h2>
          <ModalClose onClick={onClose} />
        </div>
        <div className={styles.guide}>
          <p className={styles.guideText}>
            Отмечай в календаре свободные даты и время. Можно задать повторяющиеся интервалы, например по будням с 18:00. Редактировать интервалы можно правым кликом мыши или удержанием тапа на телефоне.
          </p>
          <p className={styles.guideText}>
            Если слот сампо попадает в отмеченный интервал, он становится активным, и другой пользователь увидит тебя в списке тех, кого можно пригласить. Или выбери конкретный слот и сделай его активным одной кнопкой.
          </p>
          <p className={styles.guideText}>
            В профиле можешь настроить списки тех, кто может приглашать тебя на сампо, а также быстрый вход по логину и уведомления. При установке на телефон можно включить пуш-уведомления.
          </p>
          <p className={styles.guideText}>
            Подробная инструкция и другие вопросы — в разделе <Link className={styles.guideLink} to="/faq">FAQ</Link>.
          </p>
        </div>
    </Sheet>
  );
}

function ResponsibleField({ value, onChange, disabled = false }) {
  const [query, setQuery] = useState("");
  const [needle, setNeedle] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setNeedle(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);
  const dancers = useQuery({
    queryKey: ["dancers", "responsible", needle],
    queryFn: () => api(`/api/dancers?includeSelf=1&q=${encodeURIComponent(needle)}`),
    enabled: !disabled && needle.length > 0,
  });
  const trimmed = query.trim();

  return (
    <div className={styles.field}>
      <span className={styles.label}>Ответственный за сампо</span>
      {value ? (
        <div className={styles.picked}>
          <span>{value.displayName}</span>
          <button className={styles.button} type="button" disabled={disabled} onClick={() => onChange(null)}>
            Убрать
          </button>
        </div>
      ) : (
      <>
      <input
        className={styles.input}
        value={query}
        placeholder="Имя"
        aria-label="Поиск ответственного по имени"
        autoComplete="off"
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }}
      />
      {trimmed && !disabled ? (
        needle !== trimmed || dancers.isLoading ? (
          <p className={styles.hint}>Загрузка</p>
        ) : dancers.isError ? (
          <p className={styles.error}>{dancers.error.message}</p>
        ) : dancers.data.users.length === 0 ? (
          <p className={styles.hint}>Никого нет</p>
        ) : (
          <ul className={styles.hits}>
            {dancers.data.users.map((person) => (
              <li key={person.id}>
                <button
                  className={styles.hit}
                  type="button"
                  onClick={() => {
                    onChange({ id: person.id, displayName: person.displayName });
                    setQuery("");
                  }}
                >
                  {person.displayName}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
      </>
      )}
    </div>
  );
}

const WEEKDAY_NAMES = ["", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];

function windowRange(window) {
  if (window.kind === "once" && window.startsAt && window.endsAt) {
    const clock = slotClock(window.startsAt, window.endsAt);
    if (clock && clock.endMin > clock.startMin) return { startMin: clock.startMin, endMin: clock.endMin };
  }
  const startMin = minutesOf(window.localStart);
  const endMin = minutesOf(window.localEnd);
  if (Number.isInteger(startMin) && Number.isInteger(endMin) && endMin > startMin) return { startMin, endMin };
  return { startMin: GRID_START_MINUTES, endMin: GRID_START_MINUTES + 60 };
}

function timeChoices(from, to) {
  const items = [];
  for (let minutes = from; minutes <= to; minutes += GRID_STEP_MINUTES) items.push(minutes);
  return items;
}

function placeTimeMenu(anchor, menu) {
  const rect = anchor.getBoundingClientRect();
  const gap = 4;
  const margin = 8;
  const limit = 240;
  const spaceBelow = window.innerHeight - rect.bottom - gap - margin;
  const spaceAbove = rect.top - gap - margin;
  const upward = spaceBelow < 160 && spaceAbove > spaceBelow;
  const maxHeight = Math.max(44, Math.min(limit, upward ? spaceAbove : spaceBelow));
  let left = rect.left;
  if (left + rect.width > window.innerWidth - margin) left = window.innerWidth - margin - rect.width;
  if (left < margin) left = margin;
  return {
    left: Math.round(left),
    top: Math.round(upward ? rect.top - gap : rect.bottom + gap),
    width: Math.round(rect.width),
    maxHeight: Math.round(maxHeight),
    upward,
  };
}

function TimeSelect({ label, value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState(null);
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const activeRef = useRef(null);
  const alignedRef = useRef(false);
  const selected = options.includes(value) ? value : options[0];
  const activeIndex = options.length === 0 ? 0 : Math.min(active, options.length - 1);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const anchor = rootRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return undefined;
    function update(event) {
      if (event?.target instanceof Node && menu.contains(event.target)) return;
      const next = placeTimeMenu(anchor, menu);
      setPlace((prev) =>
        prev &&
        prev.left === next.left &&
        prev.top === next.top &&
        prev.width === next.width &&
        prev.maxHeight === next.maxHeight &&
        prev.upward === next.upward
          ? prev
          : next,
      );
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, options]);

  useEffect(() => {
    if (!open) {
      alignedRef.current = false;
      return;
    }
    if (!place || alignedRef.current) return;
    alignedRef.current = true;
    const item = activeRef.current;
    const menu = menuRef.current;
    if (!item || !menu) return;
    const top = item.offsetTop;
    const bottom = top + item.offsetHeight;
    if (top < menu.scrollTop) menu.scrollTop = top;
    else if (bottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = bottom - menu.clientHeight;
  }, [open, place]);

  useEffect(() => {
    const item = activeRef.current;
    const menu = menuRef.current;
    if (!open || !alignedRef.current || !item || !menu) return;
    const top = item.offsetTop;
    const bottom = top + item.offsetHeight;
    if (top < menu.scrollTop) menu.scrollTop = top;
    else if (bottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = bottom - menu.clientHeight;
  }, [open, activeIndex]);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      const target = event.target;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function reveal(index) {
    setActive(index);
    setOpen(true);
  }

  function choose(minutes) {
    onChange(minutes);
    setOpen(false);
  }

  function onKeyDown(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      const current = Math.max(0, options.indexOf(selected));
      if (!open) {
        reveal(current);
        return;
      }
      const next = event.key === "ArrowDown" ? Math.min(activeIndex + 1, options.length - 1) : Math.max(activeIndex - 1, 0);
      setActive(next);
      return;
    }
    if (event.key === "Enter" && open) {
      event.preventDefault();
      event.stopPropagation();
      choose(options[activeIndex]);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <div className={styles.timeSelect} ref={rootRef}>
      <button
        className={styles.timeTrigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          reveal(Math.max(0, options.indexOf(selected)));
        }}
        onKeyDown={onKeyDown}
      >
        <span>{formatMinutes(selected)}</span>
        <svg className={open ? styles.timeChevronOn : styles.timeChevron} viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open
        ? createPortal(
            <ul
              className={[styles.timeMenu, place?.upward ? styles.timeMenuUp : ""].filter(Boolean).join(" ")}
              role="listbox"
              aria-label={label}
              ref={menuRef}
              style={
                place
                  ? {
                      left: place.left,
                      top: place.top,
                      width: place.width,
                      maxHeight: place.maxHeight,
                      transform: place.upward ? "translateY(-100%)" : undefined,
                    }
                  : { visibility: "hidden" }
              }
            >
              {options.map((minutes, index) => (
                <li key={minutes}>
                  <button
                    className={[styles.timeOption, minutes === selected ? styles.timeOptionChosen : "", index === activeIndex ? styles.timeOptionOn : ""]
                      .filter(Boolean)
                      .join(" ")}
                    type="button"
                    role="option"
                    aria-selected={minutes === selected}
                    ref={index === activeIndex ? activeRef : null}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(minutes)}
                  >
                    {formatMinutes(minutes)}
                  </button>
                </li>
              ))}
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
}

function WindowEditDialog({ window, day, confirming, error, pending, onClose, onAskDelete, onBack, onSave, onDelete }) {
  const initial = windowRange(window);
  const [startMin, setStartMin] = useState(initial.startMin);
  const [endMin, setEndMin] = useState(initial.endMin);
  const [repeat, setRepeat] = useState(window.kind);
  const [intervalDays, setIntervalDays] = useState(String(window.intervalDays ?? 2));
  const dayKey = studioDayKey(day);
  const weekday = studioWeekday(day);
  const intervalCount = Number(intervalDays);
  const intervalOk = Number.isInteger(intervalCount) && intervalCount >= 2 && intervalCount <= 30;
  const span = endMin - startMin;
  const onceOk = span >= GRID_STEP_MINUTES && span <= 15 * 60;
  const repeatSpanOk = span >= GRID_STEP_MINUTES;
  const repeatEndOk = endMin <= GRID_END_MINUTES;
  const ready = repeat === "once" ? onceOk : repeat === "interval" ? repeatSpanOk && repeatEndOk && intervalOk : repeatSpanOk && repeatEndOk;
  const options = [
    { id: "once", label: "Один раз" },
    { id: "daily", label: "Каждый день" },
    ...(weekday <= 5 || window.kind === "weekdays" ? [{ id: "weekdays", label: "По будням" }] : []),
    ...(weekday >= 6 || window.kind === "weekends" ? [{ id: "weekends", label: "По выходным" }] : []),
    ...(window.kind === "weekly" ? [{ id: "weekly", label: `Каждый ${WEEKDAY_NAMES[window.weekday] ?? "день"}` }] : []),
  ];

  function changeStart(value) {
    const next = Number(value);
    setStartMin(next);
    if (endMin <= next) setEndMin(Math.min(next + GRID_STEP_MINUTES, GRID_END_MINUTES));
  }

  function save() {
    if (!ready) return;
    if (repeat === "once") {
      onSave({
        kind: "once",
        startsAtLocal: studioLocalValue(dayKey, startMin),
        endsAtLocal: studioLocalValue(dayKey, endMin),
      });
      return;
    }
    const body = {
      kind: repeat,
      localStart: formatMinutes(startMin),
      localEnd: formatMinutes(endMin),
    };
    if (repeat === "weekly") body.weekday = window.weekday ?? weekday;
    if (repeat === "interval") {
      body.intervalDays = intervalCount;
      body.anchorDate = window.kind === "interval" && window.anchorDate ? window.anchorDate : dayKey;
    }
    onSave(body);
  }

  if (confirming) {
    return (
      <Sheet onClose={onBack} labelledBy="free-delete-title" size="l">
          <div className={styles.modalHead}>
            <h2 className={styles.modalTitle} id="free-delete-title">
              Удаление
            </h2>
            <ModalClose onClick={onBack} />
          </div>
          <p className={styles.lead}>Удалить свободное время только в этот день или всю серию повторов?</p>
          {error ? <p className={styles.error}>{error}</p> : null}
          <div className={styles.actions}>
            <button className={styles.button} type="button" disabled={pending} onClick={() => onDelete("one")}>
              Удалить один раз
            </button>
            <button className={styles.danger} type="button" disabled={pending} onClick={() => onDelete("series")}>
              Удалить всю серию
            </button>
            <button className={styles.button} type="button" onClick={onBack}>
              Назад
            </button>
          </div>
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose} labelledBy="free-edit-title" size="l">
        <div className={styles.modalHead}>
          <h2 className={styles.modalTitle} id="free-edit-title">
            {formatDayTitle(day)}
          </h2>
          <ModalClose onClick={onClose} />
        </div>
        <div className={styles.timeFields}>
          <label className={styles.field}>
            <span className={styles.label}>Начало</span>
            <TimeSelect
              label="Начало"
              value={startMin}
              options={timeChoices(GRID_START_MINUTES, GRID_END_MINUTES - GRID_STEP_MINUTES)}
              onChange={changeStart}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Конец</span>
            <TimeSelect
              label="Конец"
              value={endMin}
              options={timeChoices(startMin + GRID_STEP_MINUTES, GRID_END_MINUTES)}
              onChange={setEndMin}
            />
          </label>
        </div>
        <fieldset className={styles.choices}>
          <legend className={styles.label}>Повтор</legend>
          {options.map((option) => (
            <label className={styles.choice} key={option.id}>
              <input type="radio" name="edit-repeat" value={option.id} checked={repeat === option.id} onChange={() => setRepeat(option.id)} />
              <span>{option.label}</span>
            </label>
          ))}
          <label className={styles.choice}>
            <input type="radio" name="edit-repeat" value="interval" checked={repeat === "interval"} onChange={() => setRepeat("interval")} />
            <span>Каждые</span>
            <input
              className={styles.intervalInput}
              type="number"
              min="2"
              max="30"
              inputMode="numeric"
              aria-label="Число дней"
              value={intervalDays}
              onFocus={() => setRepeat("interval")}
              onChange={(event) => {
                setRepeat("interval");
                setIntervalDays(event.target.value);
              }}
            />
            <span>{daysWord(intervalCount)}</span>
          </label>
        </fieldset>
        {error ? <p className={styles.error}>{error}</p> : null}
        {repeat === "once" && !onceOk ? <p className={styles.error}>Разовое окно — не дольше 15 часов</p> : null}
        {repeat !== "once" && !repeatEndOk ? <p className={styles.error}>Повтор можно отметить до 23:30</p> : null}
        {repeat === "interval" && !intervalOk ? <p className={styles.error}>Интервал — от 2 до 30 дней</p> : null}
        <div className={styles.actions}>
          <button className={styles.primary} type="button" disabled={!ready || pending} onClick={save}>
            Сохранить
          </button>
          <button className={styles.danger} type="button" disabled={pending} onClick={onAskDelete}>
            Удалить
          </button>
        </div>
    </Sheet>
  );
}

function ModalClose({ onClick }) {
  return (
    <button className={styles.close} type="button" aria-label="Закрыть" onClick={onClick}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </button>
  );
}

function minutesOf(value) {
  const [hour, minute] = String(value).slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

function daysWord(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "дня";
  return "дней";
}

function repeatForDay(repeat, weekday) {
  if (repeat === "weekdays" && weekday >= 6) return "once";
  if (repeat === "weekends" && weekday <= 5) return "once";
  return repeat;
}

function daySpan(fromKey, toKey) {
  const [fromYear, fromMonth, fromDay] = fromKey.split("-").map(Number);
  const [toYear, toMonth, toDay] = toKey.split("-").map(Number);
  return Math.round((Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / 86400000);
}

function repeatsOn(window, dayKey, weekday) {
  if (window.kind === "weekly") return window.weekday === weekday;
  if (window.kind === "daily") return true;
  if (window.kind === "weekdays") return weekday >= 1 && weekday <= 5;
  if (window.kind === "weekends") return weekday >= 6;
  if (window.kind === "interval") {
    const anchor = String(window.anchorDate ?? "").slice(0, 10);
    const step = Number(window.intervalDays);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor) || !Number.isInteger(step) || step < 1) return false;
    const span = daySpan(anchor, dayKey);
    return span >= 0 && span % step === 0;
  }
  return false;
}

function skipKeys(window) {
  const value = window.skipDates ?? window.skip_dates ?? [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((item) => String(item).slice(0, 10)).filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item));
}

function layerOnDay(window, dayKey, weekday) {
  if (skipKeys(window).includes(dayKey)) return null;
  if (window.kind === "once") {
    const clock = window.startsAt && window.endsAt ? slotClock(window.startsAt, window.endsAt) : null;
    if (!clock || clock.dayKey !== dayKey) return null;
    return { ...window, startMin: clock.startMin, endMin: clock.endMin };
  }
  if (!window.localStart || !window.localEnd || !repeatsOn(window, dayKey, weekday)) return null;
  const startMin = minutesOf(window.localStart);
  const endMin = minutesOf(window.localEnd);
  if (endMin <= startMin) return null;
  return { ...window, startMin, endMin };
}

function newerLayer(left, right) {
  const leftAt = left.createdAt ?? "";
  const rightAt = right.createdAt ?? "";
  if (leftAt !== rightAt) return leftAt > rightAt;
  return String(left.id) > String(right.id);
}

function blocksOnDay(windows, day) {
  const dayKey = studioDayKey(day);
  const layers = windows.map((window) => layerOnDay(window, dayKey, studioWeekday(day))).filter(Boolean);
  const pieces = [];
  for (let startMin = GRID_START_MINUTES; startMin < GRID_END_MINUTES; startMin += GRID_STEP_MINUTES) {
    const endMin = startMin + GRID_STEP_MINUTES;
    let winner = null;
    for (const layer of layers) {
      if (layer.startMin > startMin || layer.endMin < endMin) continue;
      if (!winner || newerLayer(layer, winner)) winner = layer;
    }
    if (!winner || winner.blocked) continue;
    const last = pieces[pieces.length - 1];
    if (last && last.windowId === winner.id && last.endMin === startMin) {
      last.endMin = endMin;
      continue;
    }
    pieces.push({
      id: `${winner.id}-${startMin}`,
      windowId: winner.id,
      dayKey,
      startMin,
      endMin,
      label: winner.label,
      once: winner.kind === "once",
    });
  }
  return pieces;
}

function FreeTimeDialog({
  day,
  selection,
  repeat,
  intervalDays,
  formError,
  blocked = false,
  fillGap = false,
  onceOk,
  recurringOk,
  repeatSpanOk,
  repeatEndOk,
  pending,
  onRepeat,
  onIntervalDays,
  onClose,
  onSave,
}) {
  const weekday = studioWeekday(day);
  const intervalCount = Number(intervalDays);
  const intervalOk = Number.isInteger(intervalCount) && intervalCount >= 2 && intervalCount <= 30;
  const chosen = blocked || fillGap ? "once" : repeat;
  const ready = chosen === "once" ? onceOk : chosen === "interval" ? recurringOk && intervalOk : recurringOk;
  const options = [
    { id: "once", label: "Один раз" },
    { id: "daily", label: "Каждый день" },
    ...(weekday <= 5 ? [{ id: "weekdays", label: "По будням" }] : []),
    ...(weekday >= 6 ? [{ id: "weekends", label: "По выходным" }] : []),
  ];

  function save() {
    if (!ready) return;
    if (chosen === "once") {
      onSave({
        kind: "once",
        startsAtLocal: studioLocalValue(selection.dayKey, selection.startMin),
        endsAtLocal: studioLocalValue(selection.dayKey, selection.endMin),
      });
      return;
    }
    const body = {
      kind: repeat,
      localStart: formatMinutes(selection.startMin),
      localEnd: formatMinutes(selection.endMin),
    };
    if (repeat === "interval") {
      body.intervalDays = intervalCount;
      body.anchorDate = selection.dayKey;
    }
    onSave(body);
  }

  return (
    <Sheet onClose={onClose} labelledBy="free-dialog-title" size="l">
        <header className={styles.modalShell}>
          <div className={styles.modalHead}>
            <h2 className={styles.modalTitle} id="free-dialog-title">
              {formatDayTitle(day)}
            </h2>
            <ModalClose onClick={onClose} />
          </div>
          <p className={styles.modalNote}>
            {formatMinutes(selection.startMin)}–{formatMinutes(selection.endMin)}
          </p>
        </header>
        <p className={styles.lead}>
          {blocked
            ? "В это время пригласить нельзя. Остальное свободное время дня сохраняется."
            : "Пригласить можно и тогда, когда слот только частично попадает в это время. Без отметки пригласить нельзя."}
        </p>
        {blocked || fillGap ? null : (
          <fieldset className={styles.choices}>
            <legend className={styles.label}>Повтор</legend>
            {options.map((option) => (
              <label className={styles.choice} key={option.id}>
                <input type="radio" name="free-repeat" value={option.id} checked={repeat === option.id} onChange={() => onRepeat(option.id)} />
                <span>{option.label}</span>
              </label>
            ))}
            <label className={styles.choice}>
              <input type="radio" name="free-repeat" value="interval" checked={repeat === "interval"} onChange={() => onRepeat("interval")} />
              <span>Каждые</span>
              <input
                className={styles.intervalInput}
                type="number"
                min="2"
                max="30"
                inputMode="numeric"
                aria-label="Число дней"
                value={intervalDays}
                onFocus={() => onRepeat("interval")}
                onChange={(event) => onIntervalDays(event.target.value)}
              />
              <span>{daysWord(intervalCount)}</span>
            </label>
          </fieldset>
        )}
        {formError ? <p className={styles.error}>{formError}</p> : null}
        {chosen === "once" && selection.ok && !onceOk ? <p className={styles.error}>Разовое окно — не дольше 15 часов</p> : null}
        {chosen !== "once" && selection.ok && !repeatEndOk ? <p className={styles.error}>Повтор можно отметить до 23:30</p> : null}
        {chosen === "interval" && !intervalOk ? <p className={styles.error}>Интервал — от 2 до 30 дней</p> : null}
        <div className={styles.actions}>
          <button className={styles.primary} type="button" disabled={!ready || pending} onClick={save}>
            {blocked ? "Недоступен" : "Отметить"}
          </button>
          <button className={styles.button} type="button" onClick={onClose}>
            Сбросить
          </button>
        </div>
    </Sheet>
  );
}
