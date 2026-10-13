import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, logout } from "../api/client.js";
import { RequestStatus } from "../components/RequestStatus.jsx";
import { Shell } from "../components/Shell.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import { formatDayTitle, formatSlotTime } from "../time/zone.js";
import { RequestActions } from "./RequestsPage.jsx";
import styles from "./user.module.scss";

export function RequestPage() {
  const { id } = useParams();
  const session = useSession();
  const queryClient = useQueryClient();
  const [pendingLogout, setPendingLogout] = useState(false);
  const [error, setError] = useState("");
  const requestQuery = useQuery({
    queryKey: ["request", id],
    queryFn: () => api(`/api/requests/${id}`),
    enabled: session.status === "ready" && Boolean(session.user),
  });
  const run = useMutation({
    mutationFn: ({ path, body }) => api(path, { method: "POST", body }),
    onSuccess: async () => {
      setError("");
      await queryClient.invalidateQueries({ queryKey: ["request", id] });
      await queryClient.invalidateQueries({ queryKey: ["requests"] });
      await queryClient.invalidateQueries({ queryKey: ["slots"] });
    },
    onError: (reason) => setError(reason.message),
  });

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

  const item = requestQuery.data;

  return (
    <Shell user={session.user} onLogout={onLogout} pending={pendingLogout}>
      <Link className={styles.back} to="/requests">
        К запросам
      </Link>
      {requestQuery.isLoading ? <p className={styles.status}>Загрузка</p> : null}
      {requestQuery.isError ? <p className={styles.error}>{requestQuery.error.message}</p> : null}
      {item ? (
        <article className={styles.profile}>
          <header className={styles.requestMain}>
            <RequestStatus status={item.status} />
            <div className={styles.group}>
              <h1 className={styles.title}>
                <Link className={styles.personLink} to={`/dancers/${item.otherId}`}>
                  {item.otherName}
                </Link>
              </h1>
              <p className={styles.groupHint}>
                {formatDayTitle(new Date(item.startsAt))}, {formatSlotTime(item.startsAt, item.endsAt)}, {item.place}
              </p>
              {item.cancelNote ? <p className={styles.groupHint}>{item.cancelNote}</p> : null}
            </div>
          </header>
          {error ? <p className={styles.error}>{error}</p> : null}
          <div className={styles.row}>
            <RequestActions item={item} pending={run.isPending} onRun={(path, body) => run.mutateAsync({ path, body })} />
            <Link className={styles.button} to={`/slots/${item.slotId}`}>
              Открыть слот
            </Link>
          </div>
        </article>
      ) : null}
    </Shell>
  );
}
