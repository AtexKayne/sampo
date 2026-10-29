import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, logout } from "../api/client.js";
import { FloatField } from "../components/FloatField.jsx";
import { RequestStatus } from "../components/RequestStatus.jsx";
import { Sheet } from "../components/Sheet.jsx";
import { Shell } from "../components/Shell.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import { formatDayTitle, formatSlotTime } from "../time/zone.js";
import styles from "./user.module.scss";

function visibleRequests(data) {
  return (data?.requests ?? []).filter((item) => item.status !== "cancelled");
}

export function RequestsPage() {
  const session = useSession();
  const queryClient = useQueryClient();
  const [box, setBox] = useState("incoming");
  const [pendingLogout, setPendingLogout] = useState(false);
  const [error, setError] = useState("");
  const ready = session.status === "ready" && Boolean(session.user);
  const incomingQuery = useQuery({
    queryKey: ["requests", "incoming"],
    queryFn: () => api("/api/requests?box=incoming"),
    enabled: ready,
  });
  const outgoingQuery = useQuery({
    queryKey: ["requests", "outgoing"],
    queryFn: () => api("/api/requests?box=outgoing"),
    enabled: ready,
  });
  const requestsQuery = box === "incoming" ? incomingQuery : outgoingQuery;
  const run = useMutation({
    mutationFn: ({ path, method, body }) => api(path, { method, body }),
    onSuccess: async () => {
      setError("");
      await queryClient.invalidateQueries({ queryKey: ["requests"] });
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
      await queryClient.invalidateQueries({ queryKey: ["slots"] });
    },
    onError: (reason) => setError(reason.message),
  });

  if (session.status === "loading") return <p className={styles.status}>Загрузка</p>;
  if (!session.user) return <Navigate to="/login" replace />;
  if (session.user.appRole === "admin") return <Navigate to="/calendar" replace />;

  async function onLogout() {
    setPendingLogout(true);
    try {
      await logout();
      session.setUser(null);
    } catch {
      setPendingLogout(false);
    }
  }

  const incoming = visibleRequests(incomingQuery.data);
  const outgoing = visibleRequests(outgoingQuery.data);
  const requests = box === "incoming" ? incoming : outgoing;
  const incomingPending = incoming.filter((item) => item.status === "pending").length;

  return (
    <Shell user={session.user} onLogout={onLogout} pending={pendingLogout}>
      <h1 className={styles.title}>Запросы</h1>
      <p className={styles.inboxLead}>Приглашения в пару: входящие вам и те, что отправили вы.</p>
      <div className={styles.profile}>
        <div className={styles.inboxSwitch} role="tablist" aria-label="Запросы">
          <button className={box === "incoming" ? styles.inboxTabOn : styles.inboxTab} type="button" role="tab" aria-selected={box === "incoming"} onClick={() => setBox("incoming")}>
            <span>Мне</span>
            <span className={incomingPending ? styles.inboxMarkOn : styles.inboxMark}>{incoming.length}</span>
          </button>
          <button className={box === "outgoing" ? styles.inboxTabOn : styles.inboxTab} type="button" role="tab" aria-selected={box === "outgoing"} onClick={() => setBox("outgoing")}>
            <span>Мои</span>
            <span className={styles.inboxMark}>{outgoing.length}</span>
          </button>
        </div>
        <section className={styles.inbox} aria-label={box === "incoming" ? "Входящие" : "Исходящие"}>
          {error ? <p className={styles.error}>{error}</p> : null}
          {requestsQuery.isLoading ? <p className={styles.groupHint}>Загрузка</p> : null}
          {requestsQuery.isSuccess && requests.length === 0 ? (
            <div className={styles.requestEmpty}>
              <svg className={styles.requestEmptyIcon} viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
                <rect x="7" y="12" width="34" height="24" rx="4" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M8 14 24 26 40 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              </svg>
              <h2 className={styles.requestEmptyTitle}>{box === "incoming" ? "Входящих пока нет" : "Вы ещё никого не позвали"}</h2>
              <p className={styles.requestEmptyText}>
                {box === "incoming"
                  ? "Когда кто-то пригласит вас в пару, запрос появится здесь — его можно будет подтвердить или отклонить."
                  : "Откройте слот в календаре и нажмите «Пригласить». Пока партнёр не ответит, запрос можно отозвать."}
              </p>
              <Link className={styles.button} to="/calendar">
                Открыть календарь
              </Link>
            </div>
          ) : null}
          {requests.length > 0 ? (
            <ul className={styles.requestList}>
              {requests.map((item) => (
                <li className={[styles.requestCard, item.status === "pending" ? styles.requestWait : "", item.status === "accepted" ? styles.requestOk : ""].filter(Boolean).join(" ")} key={item.id}>
                  <div className={styles.requestBody}>
                    <RequestStatus status={item.status} labeled />
                    <Link className={styles.requestName} to={`/dancers/${item.otherId}`}>
                      {item.otherName}
                    </Link>
                    <RequestActions aside item={item} pending={run.isPending} onRun={(path, body) => run.mutateAsync({ path, method: "POST", body })} />
                    <Link className={styles.requestWhen} to={`/requests/${item.id}`}>
                      {formatDayTitle(new Date(item.startsAt))}
                      <span aria-hidden="true"> · </span>
                      {formatSlotTime(item.startsAt, item.endsAt)}
                      <span aria-hidden="true"> · </span>
                      {item.place}
                    </Link>
                  </div>
                  <div className={styles.requestActions}>
                    <RequestActions hideWithdraw item={item} pending={run.isPending} onRun={(path, body) => run.mutateAsync({ path, method: "POST", body })} />
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </Shell>
  );
}

export function RequestActions({ item, pending, onRun, aside = false, hideWithdraw = false }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState("");
  const started = new Date(item.startsAt).getTime() <= Date.now();
  const canCancel = item.status === "accepted" && !started;

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape" && !pending) setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, pending]);

  async function confirmCancel() {
    setLocalError("");
    try {
      await onRun(`/api/requests/${item.id}/cancel-confirmation`, { reason: reason.trim() });
      setOpen(false);
      setReason("");
    } catch (error) {
      setLocalError(error.message);
    }
  }

  const withdraw = item.status === "pending" && item.direction !== "incoming";

  if (aside) {
    if (!withdraw) return null;
    return (
      <button
        className={`${styles.button} ${styles.requestAside}`}
        type="button"
        disabled={pending}
        onClick={() => onRun(`/api/requests/${item.id}/cancel`).catch(() => {})}
      >
        Отозвать
      </button>
    );
  }

  return (
    <>
      {item.status === "pending" && item.direction === "incoming" ? (
        <div className={styles.row}>
          <button className={styles.primary} type="button" disabled={pending} onClick={() => onRun(`/api/requests/${item.id}/accept`).catch(() => {})}>
            Подтвердить
          </button>
          <button className={styles.button} type="button" disabled={pending} onClick={() => onRun(`/api/requests/${item.id}/decline`).catch(() => {})}>
            Отказать
          </button>
        </div>
      ) : null}
      {withdraw && !hideWithdraw ? (
        <button className={styles.button} type="button" disabled={pending} onClick={() => onRun(`/api/requests/${item.id}/cancel`).catch(() => {})}>
          Отозвать
        </button>
      ) : null}
      {canCancel ? (
        <button
          className={styles.button}
          type="button"
          disabled={pending}
          onClick={() => {
            setLocalError("");
            setOpen(true);
          }}
        >
          Отменить
        </button>
      ) : null}
      {open ? (
        <Sheet
          onClose={() => {
            if (!pending) setOpen(false);
          }}
          labelledBy="cancel-request-title"
        >
          <div className={styles.dialogHead}>
            <h2 className={styles.dialogTitle} id="cancel-request-title">Отменить запрос</h2>
            <button className={styles.close} type="button" aria-label="Закрыть" disabled={pending} onClick={() => setOpen(false)}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <p className={styles.dialogText}>Пара будет снята. Записи на этот слот тоже снимутся.</p>
          <FloatField className={styles.field} label="Причина">
            <textarea
              className={styles.reason}
              value={reason}
              maxLength={300}
              onChange={(event) => setReason(event.target.value)}
            />
          </FloatField>
          {localError ? <p className={styles.error}>{localError}</p> : null}
          <div className={styles.row}>
            <button className={`${styles.button} ${styles.danger}`} type="button" disabled={pending} onClick={confirmCancel}>
              Отменить
            </button>
            <button className={styles.button} type="button" disabled={pending} onClick={() => setOpen(false)}>
              Назад
            </button>
          </div>
        </Sheet>
      ) : null}
    </>
  );
}

