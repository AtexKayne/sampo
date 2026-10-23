import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, logout } from "../api/client.js";
import { RequestStatus } from "../components/RequestStatus.jsx";
import { Sheet } from "../components/Sheet.jsx";
import { Shell } from "../components/Shell.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import { formatDayTitle, formatSlotTime } from "../time/zone.js";
import styles from "./user.module.scss";

export function RequestsPage() {
  const session = useSession();
  const queryClient = useQueryClient();
  const [box, setBox] = useState("incoming");
  const [pendingLogout, setPendingLogout] = useState(false);
  const [error, setError] = useState("");
  const requestsQuery = useQuery({
    queryKey: ["requests", box],
    queryFn: () => api(`/api/requests?box=${box}`),
    enabled: session.status === "ready" && Boolean(session.user),
  });
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

  const requests = (requestsQuery.data?.requests ?? []).filter((item) => item.status !== "cancelled");

  return (
    <Shell user={session.user} onLogout={onLogout} pending={pendingLogout}>
      <h1 className={styles.title}>Запросы</h1>
      <div className={styles.profile}>
        <div className={styles.choices} role="tablist" aria-label="Запросы">
          <button className={box === "incoming" ? styles.choiceOn : styles.choice} type="button" role="tab" aria-selected={box === "incoming"} onClick={() => setBox("incoming")}>
            Мне
          </button>
          <button className={box === "outgoing" ? styles.choiceOn : styles.choice} type="button" role="tab" aria-selected={box === "outgoing"} onClick={() => setBox("outgoing")}>
            Мои
          </button>
        </div>
        <section className={styles.group} aria-labelledby="requests-list-title">
          <h2 className={styles.groupTitle} id="requests-list-title">
            {box === "incoming" ? "Входящие" : "Исходящие"}
          </h2>
          {error ? <p className={styles.error}>{error}</p> : null}
          {requestsQuery.isLoading ? <p className={styles.groupHint}>Загрузка</p> : null}
          {requestsQuery.isSuccess && requests.length === 0 ? <p className={styles.groupHint}>Запросов нет</p> : null}
          {requests.length > 0 ? (
            <ul className={styles.list}>
              {requests.map((item) => (
                <li className={styles.request} key={item.id}>
                  <div className={styles.requestMain}>
                    <RequestStatus status={item.status} />
                    <div className={styles.caption}>
                      <Link className={styles.personLink} to={`/dancers/${item.otherId}`}>
                        {item.otherName}
                      </Link>
                      <p className={styles.groupHint}>
                        <Link className={styles.personLink} to={`/requests/${item.id}`}>
                          {formatDayTitle(new Date(item.startsAt))}, {formatSlotTime(item.startsAt, item.endsAt)}, {item.place}
                        </Link>
                      </p>
                    </div>
                  </div>
                  <RequestActions item={item} pending={run.isPending} onRun={(path, body) => run.mutateAsync({ path, method: "POST", body })} />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </Shell>
  );
}

export function RequestActions({ item, pending, onRun }) {
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
      {item.status === "pending" && item.direction !== "incoming" ? (
        <button className={styles.button} type="button" disabled={pending} onClick={() => onRun(`/api/requests/${item.id}/cancel`).catch(() => {})}>
          Отозвать запрос
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
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Причина</span>
            <textarea
              className={styles.reason}
              value={reason}
              maxLength={300}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
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

