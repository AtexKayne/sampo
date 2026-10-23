import { Link } from "react-router-dom";
import { VK_COMMUNITY_URL } from "../site.js";
import styles from "./SiteFooter.module.scss";

export function SiteFooter({ className = "", hideOnMobile = false }) {
  const year = new Date().getFullYear();
  return (
    <footer className={[styles.footer, hideOnMobile ? styles.hideOnMobile : "", className].filter(Boolean).join(" ")}>
      <p className={styles.copy}>© {year} vparaplane</p>
      <a className={styles.link} href={VK_COMMUNITY_URL} target="_blank" rel="noopener noreferrer">
        Сообщество ВКонтакте
      </a>
      <Link className={styles.link} to="/cookies">
        Файлы cookie
      </Link>
    </footer>
  );
}
