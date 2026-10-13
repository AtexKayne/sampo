import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, logout } from "../api/client.js";
import { Shell } from "../components/Shell.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import { formatDayTitle, formatSlotTime } from "../time/zone.js";
import styles from "./user.module.scss";

export function DancerPage() {
  const { id } = useParams();
  const session = useSession();
  const queryClient = useQueryClient();
  const [pendingLogout, setPendingLogout] = useState(false);
  const [error, setError] = useState("");
  const profileQuery = useQuery({
    queryKey: ["dancer", id],
    queryFn: () => api(`/api/dancers/${id}`),
    enabled: session.status === "ready" && Boolean(session.user) && session.user.id !== id,
  });
  const run = useMutation({
    mutationFn: ({ path, method, body }) => api(path, { method, body }),
    onSuccess: async () => {
      setError("");
      await queryClient.invalidateQueries({ queryKey: ["dancer", id] });
      await queryClient.invalidateQueries({ queryKey: ["profile-settings"] });
    },
    onError: (reason) => setError(reason.message),
  });

  if (session.status === "loading") return <p className={styles.status}>Загрузка</p>;
  if (!session.user) return <Navigate to="/login" replace />;
  if (session.user.id === id) return <Navigate to="/me" replace />;

  async function onLogout() {
    setPendingLogout(true);
    try {
      await logout();
      session.setUser(null);
    } catch {
      setPendingLogout(false);
    }
  }

  const profile = profileQuery.data;

  function toggleList(kind) {
    const listed = kind === "white" ? profile.whitelisted : profile.blacklisted;
    const base = kind === "white" ? "/api/me/whitelist" : "/api/me/blacklist";
    run.mutate(listed ? { path: `${base}/${id}`, method: "DELETE" } : { path: base, method: "POST", body: { userId: id } });
  }

  return (
    <Shell user={session.user} onLogout={onLogout} pending={pendingLogout}>
      {profileQuery.isLoading ? <p className={styles.status}>Загрузка</p> : null}
      {profileQuery.isError ? <p className={styles.error}>{profileQuery.error.message}</p> : null}
      {profile ? (
        <div className={styles.profile}>
          <header className={styles.group}>
            <h1 className={styles.title}>{profile.displayName}</h1>
            <p className={styles.groupHint}>Уровень: {profile.danceLevel ?? "Не указан"}</p>
          </header>
          <section className={styles.visits} aria-labelledby="dancer-visits-title">
            <h2 className={styles.groupTitle} id="dancer-visits-title">Посещения</h2>
            <dl className={styles.stats}>
              <div className={styles.stat}>
                <dt className={styles.statLabel}>За месяц</dt>
                <dd className={styles.statValue}>{profile.visits.month}</dd>
              </div>
              <div className={styles.stat}>
                <dt className={styles.statLabel}>Всего</dt>
                <dd className={styles.statValue}>{profile.visits.total}</dd>
              </div>
            </dl>
          </section>
          <div className={styles.row}>
            <button className={styles.button} type="button" disabled={run.isPending} onClick={() => toggleList("black")}>
              {profile.blacklisted ? "Убрать из чёрного списка" : "В чёрный список"}
            </button>
            <button className={styles.button} type="button" disabled={run.isPending} onClick={() => toggleList("white")}>
              {profile.whitelisted ? "Убрать из белого списка" : "В белый список"}
            </button>
          </div>
          {error ? <p className={styles.error}>{error}</p> : null}
          {profile.slots ? (
            <section className={styles.group} aria-labelledby="free-slots-title">
              <h2 className={styles.groupTitle} id="free-slots-title">Ближайшие свободные слоты</h2>
              {profile.slots.length === 0 ? <p className={styles.groupHint}>Нет свободных слотов</p> : null}
              {profile.slots.length > 0 ? (
                <ul className={styles.list}>
                  {profile.slots.map((slot) => (
                    <li className={styles.person} key={slot.id}>
                      <Link className={styles.personLink} to={`/slots/${slot.id}`}>
                        {formatDayTitle(new Date(slot.startsAt))}, {formatSlotTime(slot.startsAt, slot.endsAt)}, {slot.place}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : null}
    </Shell>
  );
}
