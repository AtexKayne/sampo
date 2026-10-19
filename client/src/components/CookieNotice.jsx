import { useState } from "react";
import { Link } from "react-router-dom";
import { COOKIE_NOTICE_KEY } from "../site.js";
import styles from "./CookieNotice.module.scss";

function readAccepted() {
  try {
    return localStorage.getItem(COOKIE_NOTICE_KEY) === "1";
  } catch {
    return false;
  }
}

export function CookieNotice() {
  const [accepted, setAccepted] = useState(readAccepted);

  if (accepted) return null;

  function onClose() {
    try {
      localStorage.setItem(COOKIE_NOTICE_KEY, "1");
    } catch {
      // Закрытие останется до перезагрузки вкладки.
    }
    setAccepted(true);
  }

  return (
    <div className={styles.banner} role="region" aria-label="Уведомление о cookie">
      <p className={styles.text}>
        Сайт сохраняет вход в cookie. Рекламных cookie нет.{" "}
        <Link className={styles.more} to="/cookies">
          Подробнее
        </Link>
      </p>
      <button className={styles.accept} type="button" onClick={onClose}>
        Понятно
      </button>
    </div>
  );
}
