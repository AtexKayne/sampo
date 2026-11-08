import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, logout } from "../api/client.js";
import { FloatField } from "../components/FloatField.jsx";
import { Shell } from "../components/Shell.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import {
  AdminAudienceLists,
  InvitePeopleTable,
  byName,
  menuPlace,
  samePlace,
} from "./ProfilePage.jsx";
import styles from "./user.module.scss";

export function AdminSettingsPage() {
  const session = useSession();
  const [pendingLogout, setPendingLogout] = useState(false);

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
  if (session.user.appRole !== "admin") return <Navigate to="/calendar" replace />;

  async function onLogout() {
    setPendingLogout(true);
    try {
      await logout();
      session.setUser(null);
    } catch {
      setPendingLogout(false);
    }
  }

  return (
    <Shell user={session.user} onLogout={onLogout} pending={pendingLogout}>
      <div className={`${styles.adminLayout} ${styles.adminLayoutNarrow}`}>
        <div className={styles.pageHead}>
          <h1 className={styles.title}>Настройки</h1>
          <button className={`${styles.button} ${styles.mobileLogout}`} type="button" disabled={pendingLogout} onClick={onLogout}>
            Выйти
          </button>
        </div>
        <div className={styles.adminPage}>
          <AdminStudioSettings />
          <AdminAudienceLists />
        </div>
      </div>
    </Shell>
  );
}

function AdminStudioSettings() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => api("/api/admin/settings"),
  });
  const saved = settingsQuery.data;
  const [linkedUsers, setLinkedUsers] = useState(null);
  const [recipients, setRecipients] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!saved) return;
    setLinkedUsers((current) => current ?? saved.linkedUsers);
    setRecipients((current) => current ?? saved.slotRequestRecipients);
  }, [saved]);

  const dirty =
    Boolean(saved) &&
    Boolean(linkedUsers) &&
    Boolean(recipients) &&
    (!samePeople(linkedUsers, saved.linkedUsers) || !samePeople(recipients, saved.slotRequestRecipients));

  const save = useMutation({
    mutationFn: () =>
      api("/api/admin/settings", {
        method: "PUT",
        body: {
          linkedUserIds: linkedUsers.map((person) => person.id),
          slotRequestRecipientIds: recipients.map((person) => person.id),
        },
      }),
    onSuccess: async (next) => {
      queryClient.setQueryData(["admin-settings"], next);
      setLinkedUsers(next.linkedUsers);
      setRecipients(next.slotRequestRecipients);
      setError("");
      setNotice("Сохранено");
    },
    onError: (reason) => {
      setNotice("");
      setError(reason.message);
    },
  });

  const busy = save.isPending;
  const saveActive = dirty || busy;

  useEffect(() => () => {
    delete document.documentElement.dataset.profileSave;
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    if (saveActive) {
      root.dataset.profileSave = "1";
      return undefined;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => {
      delete root.dataset.profileSave;
    }, reduce ? 0 : 320);
    return () => window.clearTimeout(timer);
  }, [saveActive]);

  if (!saved || !linkedUsers || !recipients) {
    return (
      <>
        {settingsQuery.isError ? <p className={styles.error}>{settingsQuery.error.message}</p> : <p className={styles.groupHint}>Загрузка</p>}
      </>
    );
  }

  return (
    <>
      <UserPickSection
        titleId="linked-users-title"
        title="Ассоциированные пользователи"
        hint="Эти люди могут переключаться в аккаунт администратора и обратно."
        people={linkedUsers ?? []}
        busy={busy || !linkedUsers}
        searchKey="linked"
        onChange={setLinkedUsers}
      />
      <UserPickSection
        titleId="slot-request-title"
        title="Куда слать запросы"
        hint="Им уйдёт сообщение ВК, если участник предложит новый слот сампо."
        people={recipients ?? []}
        busy={busy || !recipients}
        searchKey="slot-request"
        onChange={setRecipients}
      />
      {settingsQuery.isError ? <p className={styles.error}>{settingsQuery.error.message}</p> : null}
      {error ? <p className={styles.error} id="admin-settings-error">{error}</p> : null}
      {notice && !dirty ? <p className={styles.saved}>{notice}</p> : null}
      <div className={`${styles.saveSlot} ${saveActive ? styles.saveSlotOn : ""}`}>
        <div className={styles.savePlate}>
          <button
            className={`${styles.primary} ${styles.saveButton}`}
            type="button"
            disabled={!dirty || busy}
            onClick={() => save.mutate()}
          >
            {busy ? "Сохранение" : "Сохранить изменения"}
          </button>
        </div>
      </div>
    </>
  );
}

function UserPickSection({ titleId, title, hint, people, busy, searchKey, onChange }) {
  const searchRef = useRef(null);
  const dropRef = useRef(null);
  const [query, setQuery] = useState("");
  const [needle, setNeedle] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [place, setPlace] = useState(null);
  const listed = new Set(people.map((person) => person.id));
  const trimmed = query.trim();

  useEffect(() => {
    const timer = setTimeout(() => setNeedle(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);

  useLayoutEffect(() => {
    if (!searchOpen) {
      setPlace(null);
      return undefined;
    }
    const field = searchRef.current;
    if (!field) return undefined;
    const probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;visibility:hidden";
    document.body.appendChild(probe);
    let frame = 0;

    function updatePlace() {
      const current = searchRef.current;
      if (!current) return;
      const next = menuPlace(current, probe, 280);
      setPlace((prev) => (prev && samePlace(prev, next) ? prev : next));
    }

    function schedule() {
      updatePlace();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updatePlace);
    }

    updatePlace();
    const observer = new ResizeObserver(schedule);
    let node = field;
    while (node) {
      observer.observe(node);
      node = node.parentElement;
    }
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      probe.remove();
    };
  }, [searchOpen]);

  useEffect(() => {
    function onPointerDown(event) {
      const target = event.target;
      if (searchRef.current?.contains(target) || dropRef.current?.contains(target)) return;
      setSearchOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const dancers = useQuery({
    queryKey: ["dancers", "admin-settings", searchKey, needle],
    queryFn: () => api(`/api/dancers?includeSelf=1&q=${encodeURIComponent(needle)}`),
    enabled: searchOpen,
    placeholderData: (previous) => previous,
  });

  const found = (dancers.data?.users ?? []).filter((person) =>
    person.displayName.toLocaleLowerCase("ru").includes(trimmed.toLocaleLowerCase("ru")),
  );

  const drop = searchOpen && place
    ? createPortal(
        <div
          className={`${styles.inviteDrop} ${styles.inviteFloat}`}
          ref={dropRef}
          style={{
            left: place.left,
            top: place.top,
            width: place.width,
            maxHeight: place.maxHeight,
            transform: place.upward ? "translateY(-100%)" : undefined,
          }}
        >
          {dancers.isLoading && !dancers.data ? (
            <p className={styles.groupHint}>Загрузка</p>
          ) : dancers.isError ? (
            <p className={styles.error}>{dancers.error.message}</p>
          ) : found.length === 0 ? (
            <p className={styles.groupHint}>Никого нет</p>
          ) : (
            <InvitePeopleTable
              people={found}
              label="Результаты поиска"
              listed={listed}
              busy={busy}
              compact
              onAction={(person) => {
                onChange((current) => [...current, { id: person.id, displayName: person.displayName }].sort(byName));
                setQuery("");
                setSearchOpen(false);
              }}
              actionLabel="Добавить"
              doneLabel="В списке"
            />
          )}
        </div>,
        document.body,
      )
    : null;

  return (
    <section className={`${styles.group} ${styles.adminUsers}`} aria-labelledby={titleId}>
      <div className={styles.caption}>
        <h3 className={styles.groupTitle} id={titleId}>
          {title}
        </h3>
        <p className={styles.groupHint}>{hint}</p>
      </div>
      <div className={styles.inviteSearch} ref={searchRef}>
        <FloatField label="Имя">
          <input
            className={styles.input}
            value={query}
            aria-label={`Поиск: ${title}`}
            autoComplete="off"
            disabled={busy}
            onChange={(event) => {
              setQuery(event.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
              if (event.key === "Escape") setSearchOpen(false);
            }}
          />
        </FloatField>
        {drop}
      </div>
      {people.length === 0 ? <p className={styles.groupHint}>Пока никого нет</p> : null}
      {people.length > 0 ? (
        <div className={styles.inviteScroll}>
          <InvitePeopleTable
            people={people}
            label={title}
            busy={busy}
            head
            onAction={(person) => onChange((current) => current.filter((item) => item.id !== person.id))}
            actionLabel="Убрать"
          />
        </div>
      ) : null}
    </section>
  );
}

function samePeople(left, right) {
  if (left.length !== right.length) return false;
  const a = [...left.map((person) => person.id)].sort();
  const b = [...right.map((person) => person.id)].sort();
  return a.every((id, index) => id === b[index]);
}
