import { AchievementIcon } from "./AchievementIcon.jsx";
import styles from "./Achievements.module.scss";

export function Achievements({ items, onlyEarned = false }) {
  const visible = onlyEarned
    ? items?.filter((item) => item.earned)
    : items?.filter((item) => !item.hidden || item.earned);
  if (!visible?.length) return null;
  const ordered = [...visible].sort((left, right) => Number(right.earned) - Number(left.earned));
  const earned = ordered.filter((item) => item.earned).length;

  return (
    <section className={styles.section} aria-labelledby="achievements-title">
      <h2 className={styles.title} id="achievements-title">Достижения</h2>
      {onlyEarned ? null : <p className={styles.count}>{earned} из {visible.length}</p>}
      <ul className={styles.list}>
        {ordered.map((item) => (
          <li
            className={item.earned ? styles.badgeOn : styles.badge}
            key={item.id}
          >
            <span className={styles.icon} aria-hidden="true">
              <AchievementIcon name={item.id} />
            </span>
            <span className={styles.name}>{item.title}</span>
            <span className={styles.detail}>{item.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
