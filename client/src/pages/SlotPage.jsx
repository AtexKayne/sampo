import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, Navigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, logout } from "../api/client.js";
import { RequestStatus } from "../components/RequestStatus.jsx";
import { Sheet } from "../components/Sheet.jsx";
import { Shell } from "../components/Shell.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import { formatDayTitle, formatSlotTime } from "../time/zone.js";
import styles from "./user.module.scss";

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

  const [confirming, setConfirming] = useState(false);
  const dancer = session.user?.appRole !== "admin";
  const slot = slotQuery.data;
  const requests = visibleRequests(slot?.requests);
  const started = slot ? new Date(slot.startsAt).getTime() <= Date.now() : false;
  const open = slot?.status === "open" && !started;

  useEffect(() => {
    if (!confirming) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape" && !run.isPending) setConfirming(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirming, run.isPending]);

  async function confirmChoice() {
    try {
      await run.mutateAsync({
        path: `/api/slots/${id}/attendance`,
        method: "POST",
        body: { withPartner: false },
      });
      setConfirming(false);
    } catch {
      // The request error stays in the confirmation dialog.
    }
  }

  const requestsSection = dancer && slot ? (
    <section className={[styles.section, onClose ? styles.slotRequests : ""].filter(Boolean).join(" ")}>
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
                    Отозвать
                  </button>
                ) : null}
                {item.status === "accepted" && slot.myPair && !started && item.otherId === slot.myPair.partnerId ? (
                  <button className={styles.button} type="button" disabled={run.isPending} onClick={() => run.mutate({ path: `/api/pairs/${slot.myPair.id}/cancel`, method: "POST" })}>
                    <span className={styles.inviteLabelFull}>Отменить пару</span>
                    <span className={styles.inviteLabelShort}>Отменить</span>
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
  ) : null;
  const inviteSection = dancer && slot && open ? (
    <section className={styles.section}>
      <h2 className={styles.lead}>Можно пригласить</h2>
      {slot.inviteBlocked ? (
        <p className={[styles.hint, slot.inviteBlocked === "У вас уже есть пара на это время" ? styles.invitePairHint : ""].filter(Boolean).join(" ")}>
          {slot.inviteBlocked}
        </p>
      ) : null}
      {freeQuery.isLoading ? <p className={styles.hint}>Загрузка</p> : null}
      {freeQuery.isError ? <p className={styles.error}>{freeQuery.error.message}</p> : null}
      {freeQuery.isSuccess && freeQuery.data.users.length === 0 ? <p className={styles.hint}>Никого нет</p> : null}
      {freeQuery.isSuccess && freeQuery.data.users.length > 0 ? (
        <InvitePicker
          people={freeQuery.data.users}
          pending={run.isPending}
          blocked={Boolean(slot.inviteBlocked)}
          locked={Boolean(slot.myAttendance || slot.myPair)}
          compact={Boolean(onClose)}
          onInvite={(userId) => run.mutateAsync({ path: `/api/slots/${id}/requests`, method: "POST", body: { toUserId: userId } })}
        />
      ) : null}
    </section>
  ) : null;

  return (
    <div className={styles.panel}>
      {slotQuery.isLoading ? <p className={styles.status}>Загрузка</p> : null}
      {slotQuery.isError ? <p className={styles.error}>{slotQuery.error.message}</p> : null}
      {slot ? (
        <article className={[styles.panel, onClose ? styles.slotDialog : ""].filter(Boolean).join(" ")}>
          <div className={styles.cluster}>
            <header className={onClose ? styles.dialogShell : styles.section}>
              <div className={onClose ? styles.dialogHead : undefined}>
                <h2 className={onClose ? styles.dialogTitle : styles.panelTitle} id="slot-dialog-title">
                  {onClose ? (
                    <>
                      <Link className={styles.dialogLink} to={`/slots/${id}`} target="_blank" rel="noopener noreferrer" title="Открыть страницу слота">
                        <span>{formatDayTitle(new Date(slot.startsAt))}</span>
                        <svg className={styles.dialogLinkIcon} viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                          <path d="M14 5h5v5M19 5l-8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M17 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </Link>
                      <span className={styles.dialogTitlePlain}>{formatDayTitle(new Date(slot.startsAt))}</span>
                    </>
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
              <div className={onClose ? styles.slotActionRow : styles.slotActionStack}>
              {open && !slot.myAttendance && !slot.myPair ? (
                <div className={onClose ? styles.slotActionFit : styles.switch}>
                  {slot.myAvailability ? (
                    <button
                      className={[styles.switchStop, onClose ? styles.slotHalf : ""].filter(Boolean).join(" ")}
                      type="button"
                      disabled={run.isPending}
                      onClick={() => {
                        setError("");
                        run.mutate({ path: `/api/slots/${id}/availability`, method: "PUT", body: { open: false } });
                      }}
                    >
                      <span className={styles.inviteLabelFull}>Не приглашать в этот слот</span>
                      <span className={styles.inviteLabelShort}>Не приглашать</span>
                    </button>
                  ) : (
                    <button
                      className={[styles.switchWait, onClose ? styles.slotHalf : ""].filter(Boolean).join(" ")}
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
              <div className={onClose ? styles.slotActionFit : styles.row}>
            {open && !slot.myAttendance ? (
              <button
                className={onClose ? `${styles.button} ${styles.slotHalf}` : `${styles.button} ${styles.wide}`}
                type="button"
                disabled={run.isPending}
                onClick={() => {
                  setError("");
                  setConfirming(true);
                }}
              >
                Приду один
              </button>
            ) : null}
            {slot.myAttendance && !slot.myPair && !started ? (
              <button className={onClose ? styles.button : `${styles.button} ${styles.wide}`} type="button" disabled={run.isPending} onClick={() => run.mutate({ path: `/api/slots/${id}/attendance`, method: "DELETE" })}>
                Отменить выбор
              </button>
            ) : null}
            {slot.myAttendance && started ? <p className={styles.hint}>Я иду</p> : null}
              </div>
              </div>
            </div>
            ) : null}
          </div>
          {onClose ? inviteSection : requestsSection}
          {onClose ? requestsSection : inviteSection}
        </article>
      ) : null}
      {confirming ? (
        <Sheet
          onClose={() => {
            if (!run.isPending) setConfirming(false);
          }}
          labelledBy="attend-confirm-title"
        >
          <div className={styles.dialogHead}>
            <h2 className={styles.dialogTitle} id="attend-confirm-title">
              Приду один
            </h2>
            <button className={styles.close} type="button" aria-label="Закрыть" disabled={run.isPending} onClick={() => setConfirming(false)}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <p className={styles.dialogText}>Займу одно место. Отправленные запросы на это время будут отозваны.</p>
          {error ? <p className={styles.error}>{error}</p> : null}
          <div className={styles.row}>
            <button className={styles.primary} type="button" disabled={run.isPending} onClick={confirmChoice}>
              Подтвердить
            </button>
            <button className={styles.button} type="button" disabled={run.isPending} onClick={() => setConfirming(false)}>
              Отмена
            </button>
          </div>
        </Sheet>
      ) : null}
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

function samePlace(prev, next) {
  return prev.left === next.left && prev.top === next.top && prev.width === next.width && prev.maxHeight === next.maxHeight && prev.upward === next.upward;
}

function sameShade(prev, next) {
  return (
    prev &&
    next &&
    prev.top === next.top &&
    prev.left === next.left &&
    prev.right === next.right &&
    prev.bottom === next.bottom &&
    prev.width === next.width &&
    prev.height === next.height
  );
}

function visualCover() {
  const viewport = window.visualViewport;
  if (!viewport) {
    return { width: window.innerWidth, height: window.innerHeight };
  }
  return { width: viewport.width, height: viewport.height };
}

function menuPlace(field, probe) {
  const rect = field.getBoundingClientRect();
  const origin = probe.getBoundingClientRect();
  const cover = visualCover();
  const top = rect.top - origin.top;
  const bottom = rect.bottom - origin.top;
  const gap = 4;
  const limit = 220;
  const spaceBelow = cover.height - bottom - gap;
  const spaceAbove = top - gap;
  const upward = spaceBelow < 160 && spaceAbove > spaceBelow;
  const anchor = upward ? top - gap : bottom + gap;
  return {
    left: Math.round(rect.left - origin.left),
    top: Math.round(anchor),
    width: Math.round(rect.width),
    maxHeight: Math.round(Math.max(44, Math.min(limit, upward ? spaceAbove : spaceBelow))),
    upward,
  };
}

function InvitePicker({ people, pending, blocked, locked, compact = false, onInvite }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef(null);
  const fieldRef = useRef(null);
  const inputRef = useRef(null);
  const menuRef = useRef(null);
  const activeRef = useRef(null);
  const [place, setPlace] = useState(null);
  const [hole, setHole] = useState(null);
  const matches = people.filter((person) => matchesName(person.displayName, query));
  const activeIndex = active >= 0 && matches.length > 0 ? Math.min(active, matches.length - 1) : -1;

  useLayoutEffect(() => {
    if (!open) return undefined;
    const field = fieldRef.current;
    if (!field) return undefined;
    const probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;visibility:hidden";
    document.body.appendChild(probe);
    let frame = 0;

    function updatePlace() {
      const current = fieldRef.current;
      if (!current) return;
      const next = menuPlace(current, probe);
      setPlace((prev) => (prev && samePlace(prev, next) ? prev : next));
      const mobile = window.matchMedia("(max-width: 799px)").matches;
      if (!compact || !mobile) {
        setHole((prev) => (prev === null ? prev : null));
        return;
      }
      const origin = probe.getBoundingClientRect();
      const rect = (inputRef.current ?? current).getBoundingClientRect();
      const cover = visualCover();
      const nextHole = {
        top: Math.round(rect.top - origin.top),
        left: Math.round(rect.left - origin.left),
        right: Math.round(rect.right - origin.left),
        bottom: Math.round(rect.bottom - origin.top),
        width: Math.round(cover.width),
        height: Math.round(cover.height),
      };
      setHole((prev) => (sameShade(prev, nextHole) ? prev : nextHole));
    }

    function schedule() {
      updatePlace();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updatePlace);
    }

    updatePlace();
    const observer = new ResizeObserver(schedule);
    let node = field;
    while (node) {
      observer.observe(node);
      node = node.parentElement;
    }
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      probe.remove();
    };
  }, [compact, open]);

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
      setActive(activeIndex < 0 ? 0 : Math.min(activeIndex + 1, matches.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (matches.length === 0) return;
      setActive(activeIndex < 0 ? matches.length - 1 : Math.max(activeIndex - 1, 0));
      return;
    }
    if (event.key === "Enter" && open && activeIndex >= 0 && canAsk(matches[activeIndex])) {
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
          ref={inputRef}
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
            setActive(-1);
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
            <>
              {hole ? <InviteShade rect={hole} onClose={() => setOpen(false)} /> : null}
              <ul
              className={[styles.menu, compact ? styles.menuCompact : "", hole ? styles.menuLift : ""].filter(Boolean).join(" ")}
              id="invite-list"
              role="list"
              ref={menuRef}
              style={{
                left: place.left,
                top: place.top,
                width: place.width,
                maxHeight: place.maxHeight,
                transform: place.upward ? "translateY(-100%)" : undefined,
              }}
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
                  {person.requestStatus && person.requestStatus !== "cancelled" ? <RequestStatus status={person.requestStatus} /> : null}
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
            </ul>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}

function InviteShade({ rect, onClose }) {
  const { width, height } = rect;
  return (
    <svg
      className={styles.inviteShade}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ width, height }}
    >
      <path d={inviteShadePath(rect, width, height)} fill="var(--overlay)" fillRule="evenodd" onPointerDown={onClose} />
    </svg>
  );
}

function inviteShadePath(rect, width, height) {
  const holeWidth = rect.right - rect.left;
  const holeHeight = rect.bottom - rect.top;
  const radius = Math.min(10, holeWidth / 2, holeHeight / 2);
  return `M 0 0 H ${width} V ${height} H 0 Z ${roundedHole(rect.left, rect.top, holeWidth, holeHeight, radius)}`;
}

function roundedHole(x, y, width, height, radius) {
  return [
    `M ${x + radius} ${y}`,
    `H ${x + width - radius}`,
    `A ${radius} ${radius} 0 0 1 ${x + width} ${y + radius}`,
    `V ${y + height - radius}`,
    `A ${radius} ${radius} 0 0 1 ${x + width - radius} ${y + height}`,
    `H ${x + radius}`,
    `A ${radius} ${radius} 0 0 1 ${x} ${y + height - radius}`,
    `V ${y + radius}`,
    `A ${radius} ${radius} 0 0 1 ${x + radius} ${y}`,
    "Z",
  ].join(" ");
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

