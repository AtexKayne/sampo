import { useEffect, useId, useRef, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, switchAccount } from "../api/client.js";
import { useSession } from "../session/SessionProvider.jsx";
import { useNotifications } from "../notifications/NotificationsProvider.jsx";
import styles from "./Shell.module.scss";

export function Shell({ user, onLogout, pending, children }) {
  const [menu, setMenu] = useState(null);
  const incoming = useQuery({
    queryKey: ["requests", "incoming", "pending"],
    queryFn: () => api("/api/requests?box=incoming&status=pending"),
    enabled: Boolean(user) && user.appRole !== "admin",
  });
  const incomingCount = incoming.data?.requests?.length ?? 0;
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link className={styles.brand} to="/calendar">
          <span className={styles.brandSite}>vparaplane</span>
          <span className={styles.brandName}>Сампо</span>
        </Link>
        <nav className={styles.nav}>
          {user ? (
            <>
              {user.appRole === "admin" ? null : (
                <NoticeBell open={menu === "bell"} onToggle={() => setMenu((value) => (value === "bell" ? null : "bell"))} onClose={() => setMenu(null)} />
              )}
              <ProfileMenu
                user={user}
                onLogout={onLogout}
                pending={pending}
                incomingCount={incomingCount}
                open={menu === "profile"}
                onToggle={() => setMenu((value) => (value === "profile" ? null : "profile"))}
                onClose={() => setMenu(null)}
              />
            </>
          ) : null}
        </nav>
      </header>
      {children}
      <nav className={styles.bottom}>
        <NavLink className={({ isActive }) => (isActive ? styles.tabOn : styles.tab)} to="/calendar">
          Календарь
        </NavLink>
      </nav>
    </div>
  );
}

function NoticeBell({ open, onToggle, onClose }) {
  const { notes, openNotice, clearNotices } = useNotifications();
  const unread = notes.filter((note) => !note.readAt);
  const [clearing, setClearing] = useState(false);
  const rootRef = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) onClose();
    }
    function onKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  function onClear() {
    setClearing(true);
    clearNotices().finally(() => setClearing(false));
  }

  return (
    <div className={styles.menu} ref={rootRef}>
      <button
        className={styles.bell}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={unread.length ? `Уведомления, непрочитанных ${unread.length}` : "Уведомления"}
        onClick={onToggle}
      >
        <span className={styles.bellIcon}>
          <svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true">
            <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
            <path d="M10 19a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
          {unread.length > 0 ? (
            <span className={styles.bellCount}>
              <span className={styles.mark}>{unread.length}</span>
            </span>
          ) : null}
        </span>
      </button>
      {open ? (
        <div className={`${styles.dropdown} ${styles.noticeMenu}`} id={menuId} role="menu" aria-label="Непрочитанные уведомления">
          <div className={styles.noticeList}>
            {unread.length === 0 ? <p className={styles.noticeEmpty}>Непрочитанных нет</p> : null}
            {unread.map((note) => (
              <button
                className={styles.notice}
                type="button"
                role="menuitem"
                key={note.id}
                onClick={() => {
                  onClose();
                  openNotice(note);
                }}
              >
                {note.text}
              </button>
            ))}
          </div>
          <button className={styles.noticeClear} type="button" role="menuitem" disabled={clearing || notes.length === 0} onClick={onClear}>
            Очистить
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ProfileMenu({ user, onLogout, pending, incomingCount, open, onToggle, onClose }) {
  const rootRef = useRef(null);
  const menuId = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSession();
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState("");
  const name = user.displayName?.trim() || "Профиль";
  const initial = name.charAt(0).toLocaleUpperCase("ru");
  const accountSwitch = user.accountSwitch;

  async function onSwitch() {
    setSwitchError("");
    setSwitching(true);
    try {
      const next = await switchAccount();
      queryClient.clear();
      session.setUser(next);
      onClose();
      navigate("/calendar", { replace: true });
    } catch (error) {
      setSwitchError(error.message || "Не удалось переключить аккаунт");
    } finally {
      setSwitching(false);
    }
  }

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) onClose();
    }
    function onKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  return (
    <div className={styles.menu} ref={rootRef}>
      <button
        className={styles.profile}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={name}
        onClick={onToggle}
      >
        <span className={styles.avatar} aria-hidden="true">
          <span className={styles.mark}>{initial}</span>
        </span>
        <span className={styles.profileName}>{name}</span>
        <svg className={open ? styles.caretOpen : styles.caret} viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <nav className={styles.dropdown} id={menuId} aria-label="Аккаунт">
          <NavLink className={({ isActive }) => (isActive ? styles.itemOn : styles.item)} to="/me" onClick={onClose}>
            {user.appRole === "admin" ? "Пользователи" : "Профиль"}
          </NavLink>
          {user.appRole === "admin" ? null : (
            <NavLink className={({ isActive }) => (isActive ? styles.itemOn : styles.item)} to="/requests" onClick={onClose}>
              <span>Мои запросы</span>
              {incomingCount > 0 ? <span className={styles.count}>{incomingCount}</span> : null}
            </NavLink>
          )}
          {accountSwitch ? (
            <button className={styles.item} type="button" disabled={pending || switching} onClick={onSwitch}>
              {accountSwitch.to === "admin" ? "Переключиться на администратора" : "Вернуться в свой аккаунт"}
            </button>
          ) : null}
          {switchError ? <p className={styles.switchError}>{switchError}</p> : null}
          <button className={styles.item} type="button" disabled={pending} onClick={onLogout}>
            Выйти
          </button>
        </nav>
      ) : null}
    </div>
  );
}
