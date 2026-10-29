import styles from "./RequestStatus.module.scss";

const TONE = {
  pending: styles.wait,
  accepted: styles.ok,
  declined: styles.no,
  expired: styles.no,
};

export function requestStatusLabel(status) {
  if (status === "pending") return "Ждём ответ";
  if (status === "accepted") return "Подтверждён";
  if (status === "declined") return "Отказ";
  if (status === "expired") return "Истёк";
  return "Нет запроса";
}

export function RequestStatus({ status, labeled = false }) {
  const label = requestStatusLabel(status);
  return (
    <span className={[styles.badge, labeled ? styles.labeled : "", TONE[status] ?? ""].filter(Boolean).join(" ")} role="img" aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        {status === "accepted" ? (
          <path d="M6 12.5 10.2 17 18 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        ) : null}
        {status === "pending" ? (
          <>
            <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M12 8v5l3 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </>
        ) : null}
        {status === "declined" || status === "expired" ? (
          <path d="M8 8l8 8M16 8l-8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        ) : null}
        {!status ? <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" /> : null}
      </svg>
      {labeled ? <span className={styles.text}>{label}</span> : null}
    </span>
  );
}
