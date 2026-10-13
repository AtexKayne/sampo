import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, Navigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, logout } from "../api/client.js";
import { RequestStatus } from "../components/RequestStatus.jsx";
import { Shell } from "../components/Shell.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import { formatDayTitle, formatSlotTime } from "../time/zone.js";
import styles from "./user.module.scss";

const soloAttendanceEnabled = false;

function invalidate(queryClient, id) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["slot", id] }),
    queryClient.invalidateQueries({ queryKey: ["slots"] }),
    queryClient.invalidateQueries({ queryKey: ["requests"] }),
    queryClient.invalidateQueries({ queryKey: ["free", id] }),
    queryClient.invalidateQueries({ queryKey: ["windows"] }),
  ]);
}

export function SlotPanel({ id, onClose }) {
  const session = useSession();
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const slotQuery = useQuery({
    queryKey: ["slot", id],
    queryFn: () => api(`/api/slots/${id}`),
    enabled: session.status === "ready" && Boolean(session.user),
  });
  const freeQuery = useQuery({
    queryKey: ["free", id],
    queryFn: () => api(`/api/slots/${id}/free`),
    enabled: session.status === "ready" && session.user?.appRole !== "admin" && slotQuery.isSuccess,
  });

  const run = useMutation({
    mutationFn: ({ path, method, body }) => api(path, { method, body }),
    onSuccess: async () => {
      setError("");
      await invalidate(queryClient, id);
    },
    onError: (reason) => setError(reason.message),
  });

  const [choice, setChoice] = useState(null);
  const dancer = session.user?.appRole !== "admin";
  const slot = slotQuery.data;
  const requests = visibleRequests(slot?.requests);
  const started = slot ? new Date(slot.startsAt).getTime() <= Date.now() : false;
  const open = slot?.status === "open" && !started;

  useEffect(() => {
    if (choice === null) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape" && !run.isPending) setChoice(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [choice, run.isPending]);

  async function confirmChoice() {
    try {
      await run.mutateAsync({
        path: `/api/slots/${id}/attendance`,
        method: "POST",
        body: { withPartner: choice },
      });
      setChoice(null);
    } catch {
      // The request error stays in the confirmation dialog.
    }
  }

  return (
    <div className={styles.panel}>
      {slotQuery.isLoading ? <p className={styles.status}>Загрузка</p> : null}
      {slotQuery.isError ? <p className={styles.error}>{slotQuery.error.message}</p> : null}
      {slot ? (
        <article className={styles.panel}>
          <div className={styles.cluster}>
            <header className={onClose ? styles.dialogShell : styles.section}>
              <div className={onClose ? styles.dialogHead : undefined}>
                <h2 className={onClose ? styles.dialogTitle : styles.panelTitle} id="slot-dialog-title">
                  {onClose ? (
                    <Link className={styles.dialogLink} to={`/slots/${id}`} target="_blank" rel="noopener noreferrer" title="Открыть страницу слота">
                      <span>{formatDayTitle(new Date(slot.startsAt))}</span>
                      <svg className={styles.dialogLinkIcon} viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                        <path d="M14 5h5v5M19 5l-8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M17 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </Link>
                  ) : (
                    <span>{formatDayTitle(new Date(slot.startsAt))}</span>
                  )}
                  {onClose ? null : (
                    <span className={styles.panelMeta}>
                      {formatSlotTime(slot.startsAt, slot.endsAt)}, {slot.place}
                    </span>
                  )}
                </h2>
                {onClose ? (
                  <button className={styles.close} type="button" aria-label="Закрыть" onClick={onClose}>
                    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                ) : null}
              </div>
              {onClose ? (
                <div className={styles.dialogNotes}>
                  <p className={styles.panelMeta}>
                    {formatSlotTime(slot.startsAt, slot.endsAt)}, {slot.place}
                  </p>
                </div>
              ) : (
                <>
                  {slot.status === "cancelled" ? <p className={styles.lead}>Отменён</p> : null}
                  {slot.myPair ? <PairLine pair={slot.myPair} /> : null}
                  <SlotDetails slot={slot} viewerId={session.user.id} />
                </>
              )}
            </header>
            {dancer ? (
            <div className={styles.section}>
              {error ? <p className={styles.error}>{error}</p> : null}
              {open && !slot.myAttendance && !slot.myPair ? (
                <div className={styles.switch}>
                  {slot.myAvailability ? (
                    <button
                      className={styles.switchStop}
                      type="button"
                      disabled={run.isPending}
                      onClick={() => {
                        setError("");
                        run.mutate({ path: `/api/slots/${id}/availability`, method: "PUT", body: { open: false } });
                      }}
                    >
                      Не приглашать в этот слот
                    </button>
                  ) : (
                    <button
                      className={styles.switchWait}
                      type="button"
                      disabled={run.isPending}
                      onClick={() => {
                        setError("");
                        run.mutate({ path: `/api/slots/${id}/availability`, method: "PUT", body: { open: true } });
                      }}
                    >
                      Жду приглашения на этот слот
                    </button>
                  )}
                </div>
              ) : null}
              <div className={styles.row}>
            {soloAttendanceEnabled && open && !slot.myAttendance ? (
              <>
                <button
                  className={styles.button}
                  type="button"
                  disabled={run.isPending}
                  onClick={() => {
                    setError("");
                    setChoice(false);
                  }}
                >
                  Приду один
                </button>
                <button
                  className={styles.button}
                  type="button"
                  disabled={run.isPending}
                  onClick={() => {
                    setError("");
                    setChoice(true);
                  }}
                >
                  Приду с партнёром
                </button>
              </>
            ) : null}
            {slot.myAttendance && !slot.myPair && !started ? (
              <button className={styles.button} type="button" disabled={run.isPending} onClick={() => run.mutate({ path: `/api/slots/${id}/attendance`, method: "DELETE" })}>
                Отменить выбор
              </button>
            ) : null}
            {slot.myAttendance && started ? <p className={styles.hint}>Я иду</p> : null}
            {slot.myPair && !started ? (
              <button className={styles.button} type="button" disabled={run.isPending} onClick={() => run.mutate({ path: `/api/pairs/${slot.myPair.id}/cancel`, method: "POST" })}>
                Отменить пару
              </button>
            ) : null}
              </div>
            </div>
            ) : null}
          </div>
          {dancer ? (
          <section className={styles.section}>
            <h2 className={styles.lead}>Запросы</h2>
            {requests.length ? (
            <ul className={styles.list}>
              {requests.map((item) => (
                <li className={styles.person} key={item.id}>
                  <span className={styles.requestMain}>
                    <RequestStatus status={item.status} />
                    <span>
                      {item.direction === "incoming" ? "Вам" : "Вы"}:{" "}
                      <Link className={styles.personLink} to={`/dancers/${item.otherId}`}>
                        {item.otherName}
                      </Link>
                    </span>
                  </span>
                  <span className={styles.row}>
                    {item.direction === "incoming" && item.status === "pending" ? (
                      <>
                        <button className={styles.primary} type="button" disabled={run.isPending} onClick={() => run.mutate({ path: `/api/requests/${item.id}/accept`, method: "POST" })}>
                          Подтвердить
                        </button>
                        <button className={styles.button} type="button" disabled={run.isPending} onClick={() => run.mutate({ path: `/api/requests/${item.id}/decline`, method: "POST" })}>
                          Отказать
                        </button>
                      </>
                    ) : null}
                    {item.direction === "outgoing" && item.status === "pending" ? (
                      <button className={styles.button} type="button" disabled={run.isPending} onClick={() => run.mutate({ path: `/api/requests/${item.id}/cancel`, method: "POST" })}>
                        Отозвать запрос
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.hint}>Запросов на этот слот нет</p>
            )}
          </section>
          ) : null}
          {dancer && open ? (
            <section className={styles.section}>
              <h2 className={styles.lead}>Можно пригласить</h2>
              {slot.inviteBlocked ? <p className={styles.hint}>{slot.inviteBlocked}</p> : null}
              {freeQuery.isLoading ? <p className={styles.hint}>Загрузка</p> : null}
              {freeQuery.isError ? <p className={styles.error}>{freeQuery.error.message}</p> : null}
              {freeQuery.isSuccess && freeQuery.data.users.length === 0 ? <p className={styles.hint}>Никого нет</p> : null}
              {freeQuery.isSuccess && freeQuery.data.users.length > 0 ? (
                <InvitePicker
                  people={freeQuery.data.users}
                  pending={run.isPending}
                  blocked={Boolean(slot.inviteBlocked)}
                  locked={Boolean(slot.myAttendance || slot.myPair)}
                  onInvite={(userId) => run.mutateAsync({ path: `/api/slots/${id}/requests`, method: "POST", body: { toUserId: userId } })}
                />
              ) : null}
            </section>
          ) : null}
        </article>
      ) : null}
      {choice === null
        ? null
        : createPortal(
            <div className={styles.backdrop} onClick={() => !run.isPending && setChoice(null)}>
              <div
                className={styles.dialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby="attend-confirm-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div className={styles.dialogHead}>
                  <h2 className={styles.dialogTitle} id="attend-confirm-title">
                    {choice ? "Приду с партнёром" : "Приду один"}
                  </h2>
                  <button className={styles.close} type="button" aria-label="Закрыть" disabled={run.isPending} onClick={() => setChoice(null)}>
                    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
                <p className={styles.dialogText}>
                  {choice ? "Займу два места." : "Займу одно место."} Отправленные запросы на это время будут отозваны.
                </p>
                {error ? <p className={styles.error}>{error}</p> : null}
                <div className={styles.row}>
                  <button className={styles.primary} type="button" disabled={run.isPending} onClick={confirmChoice}>
                    Подтвердить
                  </button>
                  <button className={styles.button} type="button" disabled={run.isPending} onClick={() => setChoice(null)}>
                    Отмена
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )}
    </div>
  );
}

export function SlotPage() {
  const { id } = useParams();
  const session = useSession();
  const [pendingLogout, setPendingLogout] = useState(false);

  if (session.status === "loading") return <p className={styles.status}>Загрузка</p>;
  if (!session.user) return <Navigate to="/login" replace />;

  async function onLogout() {
    setPendingLogout(true);
    try {
      await logout();
      session.setUser(null);
    } catch {
      setPendingLogout(false);
    }
  }

  return (
    <Shell user={session.user} onLogout={onLogout} pending={pendingLogout}>
      <Link className={styles.back} to="/calendar">
        К календарю
      </Link>
      <SlotPanel id={id} />
    </Shell>
  );
}

function matchesName(name, query) {
  const needle = query.trim().toLocaleLowerCase("ru");
  if (!needle) return true;
  return name.toLocaleLowerCase("ru").includes(needle);
}

function InvitePicker({ people, pending, blocked, locked, onInvite }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef(null);
  const fieldRef = useRef(null);
  const menuRef = useRef(null);
  const activeRef = useRef(null);
  const [place, setPlace] = useState(null);
  const matches = people.filter((person) => matchesName(person.displayName, query));
  const activeIndex = matches.length === 0 ? 0 : Math.min(active, matches.length - 1);

  useLayoutEffect(() => {
    if (!open) return undefined;
    function updatePlace() {
      const field = fieldRef.current;
      if (!field) return;
      const rect = field.getBoundingClientRect();
      const gap = 4;
      const limit = 220;
      const spaceBelow = window.innerHeight - rect.bottom - gap;
      const spaceAbove = rect.top - gap;
      const upward = spaceBelow < 160 && spaceAbove > spaceBelow;
      setPlace({
        left: rect.left,
        width: rect.width,
        maxHeight: Math.max(44, Math.min(limit, upward ? spaceAbove : spaceBelow)),
        top: upward ? undefined : rect.bottom + gap,
        bottom: upward ? window.innerHeight - rect.top + gap : undefined,
      });
    }
    updatePlace();
    window.addEventListener("resize", updatePlace);
    window.addEventListener("scroll", updatePlace, true);
    return () => {
      window.removeEventListener("resize", updatePlace);
      window.removeEventListener("scroll", updatePlace, true);
    };
  }, [open]);

  useEffect(() => {
    if (locked) setOpen(false);
  }, [locked]);

  useEffect(() => {
    function onPointerDown(event) {
      const target = event.target;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    const item = activeRef.current;
    const menu = menuRef.current;
    if (!open || !item || !menu) return;
    const top = item.offsetTop;
    const bottom = top + item.offsetHeight;
    if (top < menu.scrollTop) menu.scrollTop = top;
    else if (bottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = bottom - menu.clientHeight;
  }, [activeIndex, open]);

  function canAsk(person) {
    return Boolean(person?.canInvite) && !blocked && !pending;
  }

  function onKeyDown(event) {
    if (locked) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      if (matches.length === 0) return;
      setActive(open ? Math.min(activeIndex + 1, matches.length - 1) : activeIndex);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (matches.length === 0) return;
      setActive(Math.max(activeIndex - 1, 0));
      return;
    }
    if (event.key === "Enter" && open && canAsk(matches[activeIndex])) {
      event.preventDefault();
      invite(matches[activeIndex]);
      return;
    }
    if (event.key === "Escape") setOpen(false);
  }

  async function invite(person) {
    if (!canAsk(person)) return;
    try {
      await onInvite(person.id);
    } catch {
      // The request error is shown above the form.
    }
  }

  return (
    <div className={styles.combo} ref={rootRef}>
      <div className={styles.comboField} ref={fieldRef}>
        <input
          className={styles.input}
          role="combobox"
          aria-expanded={open}
          aria-controls="invite-list"
          aria-autocomplete="list"
          aria-disabled={locked}
          aria-label="Поиск по имени"
          disabled={locked}
          value={query}
          placeholder="Имя"
          onChange={(event) => {
            if (locked) return;
            setQuery(event.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => {
            if (!locked) setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        <button
          className={styles.comboToggle}
          type="button"
          aria-label={open ? "Скрыть список" : "Показать список"}
          aria-expanded={open}
          disabled={locked}
          onClick={() => {
            if (!locked) setOpen((value) => !value);
          }}
        >
          ▾
        </button>
      </div>
      {open && !locked && place
        ? createPortal(
            <ul
              className={styles.menu}
              id="invite-list"
              role="list"
              ref={menuRef}
              style={{ left: place.left, width: place.width, maxHeight: place.maxHeight, top: place.top, bottom: place.bottom }}
            >
              {matches.map((person, index) => (
                <li
                  key={person.id}
                  className={index === activeIndex ? styles.optionOn : styles.option}
                  ref={index === activeIndex ? activeRef : null}
                  onMouseEnter={() => setActive(index)}
                >
                  <Link className={`${styles.optionName} ${styles.personLink}`} to={`/dancers/${person.id}`}>
                    {person.displayName}
                  </Link>
                  <RequestStatus status={person.requestStatus === "cancelled" ? null : person.requestStatus} />
                  <button
                    className={`${styles.button} ${styles.invite}`}
                    type="button"
                    disabled={!canAsk(person)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => invite(person)}
                  >
                    Пригласить
                  </button>
                </li>
              ))}
              {matches.length === 0 ? <li className={styles.menuEmpty}>Никого нет</li> : null}
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
}

function visibleRequests(requests) {
  return (requests ?? []).filter((item) => item.status !== "cancelled");
}

function SlotDetails({ slot, viewerId }) {
  if (!slot.description && !slot.responsible) return null;
  const responsible = slot.responsible;
  return (
    <>
      {slot.description ? <p className={styles.note}>{slot.description}</p> : null}
      {responsible ? (
        <p className={styles.lead}>
          Ответственный за сампо:{" "}
          <Link className={styles.personLink} to={responsible.id === viewerId ? "/me" : `/dancers/${responsible.id}`}>
            {responsible.displayName}
          </Link>
        </p>
      ) : null}
    </>
  );
}

function PairLine({ pair }) {
  return (
    <p className={styles.lead}>
      Пара с{" "}
      <Link className={styles.personLink} to={`/dancers/${pair.partnerId}`}>
        {pair.partnerName}
      </Link>
    </p>
  );
}

