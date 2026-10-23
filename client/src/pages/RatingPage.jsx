import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, logout } from "../api/client.js";
import { Achievements } from "../components/Achievements.jsx";
import { Shell } from "../components/Shell.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import styles from "./user.module.scss";

const MEDALS = [
  { light: "#fff5c4", mid: "#e8b53e", dark: "#7a4f08" },
  { light: "#ffffff", mid: "#c3cad4", dark: "#58616e" },
  { light: "#ffe2c2", mid: "#cd8d52", dark: "#6b3b17" },
];

function SortMark({ active }) {
  return (
    <svg className={active ? styles.sortOn : styles.sort} viewBox="0 0 12 16" width="12" height="16" aria-hidden="true">
      <path d="M6 1.5 10.2 7H1.8Z" />
      <path d="M6 14.5 1.8 9h8.4Z" />
    </svg>
  );
}

function RankMedal({ place }) {
  const metal = MEDALS[place - 1];
  if (!metal) return place;
  return (
    <svg className={styles.medal} viewBox="0 0 32 32" width="36" height="36" aria-hidden="true">
      <circle cx="16" cy="16" r="14.2" fill={metal.mid} />
      <circle cx="16" cy="16" r="11.4" fill={metal.light} />
      <circle cx="16" cy="16" r="14.2" fill="none" stroke={metal.dark} strokeWidth="1.6" />
      <text x="16" y="17" textAnchor="middle" dominantBaseline="middle" fill={metal.dark} fontFamily="Manrope, sans-serif" fontSize="12" fontWeight="700">
        {place}
      </text>
    </svg>
  );
}

function formatDelta(delta) {
  return delta > 0 ? `+${delta}` : String(delta);
}

function deltaClass(delta) {
  if (delta > 0) return styles.deltaUp;
  if (delta < 0) return styles.deltaDown;
  return styles.deltaSame;
}

export function RatingPage() {
  const session = useSession();
  const [pendingLogout, setPendingLogout] = useState(false);
  const [sort, setSort] = useState("total");
  const dancer = session.status === "ready" && session.user?.appRole !== "admin";
  const rating = useQuery({
    queryKey: ["rating"],
    queryFn: () => api("/api/me/rating"),
    enabled: dancer,
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

  const visits = rating.data?.visits;
  const leaders = rating.data?.leaders?.[sort] ?? [];
  const myPlace = rating.data?.place?.[sort];
  const delta = visits ? visits.month - visits.previous : 0;

  return (
    <Shell user={session.user} onLogout={onLogout} pending={pendingLogout}>
      <h1 className={styles.title}>Рейтинг</h1>
      <div className={styles.profile}>
        {rating.isLoading ? <p className={styles.status}>Загрузка</p> : null}
        {rating.isError ? <p className={styles.error}>{rating.error.message}</p> : null}
        {visits ? (
          <section className={styles.visits} aria-labelledby="rating-visits-title">
            <h2 className={styles.groupTitle} id="rating-visits-title">Сампо</h2>
            <dl className={styles.stats}>
              <div className={styles.stat}>
                <dt className={styles.statLabel}>За месяц</dt>
                <dd className={styles.monthValue}>
                  <span>{visits.month}</span>
                  <span className={deltaClass(delta)}>{formatDelta(delta)}</span>
                </dd>
              </div>
              <div className={styles.stat}>
                <dt className={styles.statLabel}>Всего</dt>
                <dd className={styles.statValue}>{visits.total}</dd>
              </div>
            </dl>
          </section>
        ) : null}
      </div>
      {rating.data ? (
        <section className={styles.board} aria-labelledby="rating-board-title">
          <h2 className={styles.groupTitle} id="rating-board-title">Участники</h2>
          {leaders.length === 0 ? <p className={styles.groupHint}>Пока нет завершённых сампо</p> : null}
          <table className={styles.boardTable}>
            <thead>
              <tr>
                <th className={styles.place} scope="col">Место</th>
                <th scope="col">Имя</th>
                <th className={styles.count} scope="col" aria-sort={sort === "month" ? "descending" : "none"}>
                  <button className={styles.sortHead} type="button" aria-pressed={sort === "month"} onClick={() => setSort("month")}>
                    За месяц
                    <SortMark active={sort === "month"} />
                  </button>
                </th>
                <th className={styles.count} scope="col" aria-sort={sort === "total" ? "descending" : "none"}>
                  <button className={styles.sortHead} type="button" aria-pressed={sort === "total"} onClick={() => setSort("total")}>
                    Всего
                    <SortMark active={sort === "total"} />
                  </button>
                </th>
              </tr>
            </thead>
            {leaders.length > 0 ? (
              <tbody>
                {leaders.map((person, index) => (
                  <tr className={person.id === session.user.id ? styles.mine : undefined} key={person.id}>
                    <td className={styles.place} aria-label={`${index + 1} место`}>
                      <RankMedal place={index + 1} />
                    </td>
                    <td className={styles.boardName}>
                      <Link to={person.id === session.user.id ? "/me" : `/dancers/${person.id}`}>{person.displayName}</Link>
                    </td>
                    <td className={styles.count}>{person.month}</td>
                    <td className={styles.count}>{person.total}</td>
                  </tr>
                ))}
              </tbody>
            ) : null}
          </table>
          <p className={styles.myPlace}>Моё место в рейтинге: {myPlace ?? "—"}</p>
        </section>
      ) : null}
      {rating.data?.achievements ? <Achievements items={rating.data.achievements} /> : null}
    </Shell>
  );
}
