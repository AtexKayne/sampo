import { useEffect, useId, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, switchAccount } from "../api/client.js";
import { useSession } from "../session/SessionProvider.jsx";
import { useNotifications } from "../notifications/NotificationsProvider.jsx";
import { SiteFooter } from "./SiteFooter.jsx";
import styles from "./Shell.module.scss";

export function Shell({ user, onLogout, pending, fill = false, wide = false, children }) {
  const [menu, setMenu] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSession();
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState("");

  useEffect(() => {
    if (!user) return undefined;
    const root = document.documentElement;
    root.dataset.bottomNav = "1";
    return () => {
      delete root.dataset.bottomNav;
    };
  }, [user]);
  const incoming = useQuery({
    queryKey: ["requests", "incoming", "pending"],
    queryFn: () => api("/api/requests?box=incoming&status=pending"),
    enabled: Boolean(user) && user.appRole !== "admin",
  });
  const incomingCount = incoming.data?.requests?.length ?? 0;
  const accountSwitch = user?.accountSwitch;

  async function onSwitch() {
    setSwitchError("");
    setSwitching(true);
    try {
      const next = await switchAccount();
      queryClient.clear();
      session.setUser(next);
      setMenu(null);
      navigate("/calendar", { replace: true });
    } catch (error) {
      setSwitchError(error.message || "Не удалось переключить аккаунт");
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className={[styles.shell, user ? "" : styles.guest, fill ? styles.fill : "", wide ? styles.wide : ""].filter(Boolean).join(" ")}>
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
              {accountSwitch ? (
                <button className={styles.switcher} type="button" disabled={pending || switching} onClick={onSwitch}>
                  {accountSwitch.to === "admin" ? "А" : "Ю"}
                </button>
              ) : null}
              {user.appRole === "admin" ? (
                <button className={`${styles.link} ${styles.headerLogout}`} type="button" disabled={pending} onClick={onLogout}>
                  Выйти
                </button>
              ) : null}
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
          ) : (
            <Link className={styles.link} to="/login">
              Войти
            </Link>
          )}
        </nav>
      </header>
      {switchError ? <p className={styles.switchBanner}>{switchError}</p> : null}
      <div className={styles.main}>{children}</div>
      <SiteFooter hideOnMobile={location.pathname.startsWith("/calendar")} />
      {user ? (
        <nav className={styles.bottom} aria-label="Разделы">
          {user.appRole === "admin" ? (
            <>
              <Tab to="/me" label="Пользователи" icon="users" active={usersActive(location.pathname)} />
              <Tab to="/calendar" label="Календарь" icon="calendar" active={calendarActive(location.pathname)} />
            </>
          ) : (
            <>
              <Tab
                to="/requests"
                label="Запросы"
                icon="requests"
                count={incomingCount}
                active={location.pathname.startsWith("/requests")}
              />
              <Tab to="/faq" label="FAQ" icon="faq" active={location.pathname.startsWith("/faq")} />
              <Tab to="/calendar" label="Календарь" icon="calendar" active={calendarActive(location.pathname)} />
              <Tab to="/rating" label="Рейтинг" icon="rating" active={location.pathname.startsWith("/rating")} />
              <Tab to="/me" label="Профиль" icon="profile" active={profileActive(location.pathname)} />
            </>
          )}
        </nav>
      ) : null}
    </div>
  );
}

function calendarActive(pathname) {
  return pathname.startsWith("/calendar") || pathname.startsWith("/slots");
}

function usersActive(pathname) {
  return pathname === "/me" || pathname.startsWith("/admin/users");
}

function profileActive(pathname) {
  return pathname === "/me" || pathname.startsWith("/me/");
}

function Tab({ to, label, icon, count = 0, active }) {
  return (
    <NavLink
      className={active ? styles.tabOn : styles.tab}
      to={to}
      aria-current={active ? "page" : undefined}
      aria-label={count > 0 ? `${label}, ${count}` : label}
    >
      <span className={styles.tabIcon} aria-hidden="true">
        <TabIcon name={icon} />
        {count > 0 ? (
          <span className={styles.tabCount}>
            <span className={styles.mark}>{count}</span>
          </span>
        ) : null}
      </span>
      <span className={styles.tabLabel}>{label}</span>
    </NavLink>
  );
}

function TabIcon({ name }) {
  const common = {
    viewBox: "0 0 24 24",
    width: "24",
    height: "24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.75",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
  };
  if (name === "requests") {
    return (
      <svg {...common}>
        <rect x="4" y="6" width="16" height="12" rx="2" />
        <path d="m4 8 8 6 8-6" />
      </svg>
    );
  }
  if (name === "faq") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8" />
        <path d="M9.6 9.6a2.4 2.4 0 1 1 3.1 2.25c-.7.32-1.1.86-1.1 1.55" />
        <path d="M12 16.7v.3" />
      </svg>
    );
  }
  if (name === "calendar") {
    return (
      <svg {...common}>
        <rect x="4" y="6" width="16" height="14" rx="2" />
        <path d="M8 4v4M16 4v4M4 10h16" />
      </svg>
    );
  }
  if (name === "rating") {
    return (
      <svg {...common}>
        <path d="M4 11h4v8H4zM10 5h4v14h-4zM16 8h4v11h-4z" />
      </svg>
    );
  }
  if (name === "users") {
    return (
      <svg {...common}>
        <circle cx="9" cy="9" r="3" />
        <path d="M4 19c.9-3.2 2.8-4.8 5-4.8" />
        <circle cx="16.5" cy="9.5" r="2.5" />
        <path d="M20.5 19c-.7-2.6-2.2-4-4-4.2" />
      </svg>
    );
  }
  if (name === "logout") {
    return (
      <svg {...common}>
        <path d="M10 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3" />
        <path d="m13 16 4-4-4-4M17 12H9" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="8.5" r="3.2" />
      <path d="M6.2 19c1.1-3.2 3.2-4.8 5.8-4.8s4.7 1.6 5.8 4.8" />
    </svg>
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
  const name = user.displayName?.trim() || "Профиль";
  const initial = name.charAt(0).toLocaleUpperCase("ru");

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
    <div className={`${styles.menu} ${styles.desktopNav}`} ref={rootRef}>
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
            <span className={styles.itemIcon} aria-hidden="true">
              <TabIcon name={user.appRole === "admin" ? "users" : "profile"} />
            </span>
            <span className={styles.itemText}>{user.appRole === "admin" ? "Пользователи" : "Профиль"}</span>
          </NavLink>
          {user.appRole === "admin" ? null : (
            <NavLink className={({ isActive }) => (isActive ? styles.itemOn : styles.item)} to="/requests" onClick={onClose}>
              <span className={styles.itemIcon} aria-hidden="true">
                <TabIcon name="requests" />
              </span>
              <span className={styles.itemText}>Мои запросы</span>
              {incomingCount > 0 ? <span className={styles.count}>{incomingCount}</span> : null}
            </NavLink>
          )}
          <NavLink className={({ isActive }) => (isActive ? styles.itemOn : styles.item)} to="/faq" onClick={onClose}>
            <span className={styles.itemIcon} aria-hidden="true">
              <TabIcon name="faq" />
            </span>
            <span className={styles.itemText}>FAQ</span>
          </NavLink>
          {user.appRole === "admin" ? null : (
            <NavLink className={({ isActive }) => (isActive ? styles.itemOn : styles.item)} to="/rating" onClick={onClose}>
              <span className={styles.itemIcon} aria-hidden="true">
                <TabIcon name="rating" />
              </span>
              <span className={styles.itemText}>Рейтинг</span>
            </NavLink>
          )}
          <button className={styles.item} type="button" disabled={pending} onClick={onLogout}>
            <span className={styles.itemIcon} aria-hidden="true">
              <TabIcon name="logout" />
            </span>
            <span className={styles.itemText}>Выйти</span>
          </button>
        </nav>
      ) : null}
    </div>
  );
}
