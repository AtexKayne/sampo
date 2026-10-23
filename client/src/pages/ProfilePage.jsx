import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DANCE_LEVELS } from "../../../shared/dance-levels.js";
import { api, logout } from "../api/client.js";
import { disablePhonePush, enablePhonePush, iosNeedsHomeScreen, preparePush, readPhonePush } from "../notifications/push.js";
import { Sheet } from "../components/Sheet.jsx";
import { Shell } from "../components/Shell.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import styles from "./user.module.scss";

export function ProfilePage() {
  const session = useSession();
  const location = useLocation();
  const [pendingLogout, setPendingLogout] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);

  useEffect(() => {
    if (location.hash !== "#admin-users") return;
    document.getElementById("admin-users")?.scrollIntoView({ block: "start" });
  }, [location.hash, session.user]);

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

  async function onLogout() {
    setPendingLogout(true);
    try {
      await logout();
      session.setUser(null);
    } catch {
      setPendingLogout(false);
    }
  }

  if (session.user.appRole === "admin") {
    return (
      <Shell user={session.user} onLogout={onLogout} pending={pendingLogout} fill>
        <div className={styles.adminLayout}>
          <div className={styles.pageHead}>
            <h1 className={styles.title}>Пользователи</h1>
            <div className={styles.headActions}>
              <button className={`${styles.button} ${styles.mobileLogout}`} type="button" disabled={pendingLogout} onClick={onLogout}>
                Выйти
              </button>
              <button className={styles.primary} type="button" onClick={() => setCreatingUser(true)}>
                Новый пользователь
              </button>
            </div>
          </div>
          <div className={styles.adminPage}>
            <AdminUserSearch creating={creatingUser} onCreatingChange={setCreatingUser} />
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell user={session.user} onLogout={onLogout} pending={pendingLogout}>
      <h1 className={styles.title}>Профиль</h1>
      <ProfileSettings onLogout={onLogout} pendingLogout={pendingLogout} />
    </Shell>
  );
}

export function AdminUserPage() {
  const { id } = useParams();
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
  if (session.user.appRole !== "admin" || id === session.user.id) return <Navigate to="/calendar" replace />;

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
      <Link className={styles.back} to="/me#admin-users">К пользователям</Link>
      <h1 className={styles.title}>Профиль</h1>
      <ProfileSettings key={id} userId={id} />
    </Shell>
  );
}

function ProfileSettings({ userId, onLogout, pendingLogout }) {
  const session = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const editing = Boolean(userId);
  const settingsKey = ["profile-settings", userId || "me"];
  const settingsPath = editing ? `/api/admin/users/${userId}` : "/api/me/settings";
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [query, setQuery] = useState("");
  const [needle, setNeedle] = useState("");
  const settingsQuery = useQuery({
    queryKey: settingsKey,
    queryFn: () => api(settingsPath),
  });
  const saved = settingsQuery.data;
  useEffect(() => {
    if (!saved) return;
    setDraft((current) => current ?? saved);
  }, [saved]);
  useEffect(() => {
    const timer = setTimeout(() => setNeedle(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);
  const dancers = useQuery({
    queryKey: ["dancers", needle],
    queryFn: () => api(`/api/dancers?q=${encodeURIComponent(needle)}`),
    enabled: needle.length > 0,
  });
  const save = useMutation({
    mutationFn: (profile) =>
      api(settingsPath, {
        method: "PUT",
        body: {
          displayName: profile.displayName,
          danceLevel: profile.danceLevel,
          blockedLevels: profile.blockedLevels,
          listMode: profile.listMode,
          blacklist: profile.blacklist.map((person) => person.id),
          whitelist: profile.whitelist.map((person) => person.id),
          notifyInvites: profile.notifyInvites,
          notifyHourBefore: profile.notifyHourBefore,
          notifyNewSlots: profile.notifyNewSlots,
          notifyNewSlotsScope: profile.notifyNewSlotsScope === "all" ? "all" : "free",
          shareAvailability: profile.shareAvailability,
        },
      }),
    onSuccess: (next) => {
      setError("");
      setDraft(next);
      queryClient.setQueryData(settingsKey, next);
      if (!editing) session.setUser({ ...session.user, displayName: next.displayName });
    },
    onError: (reason) => setError(reason.message),
  });
  const remove = useMutation({
    mutationFn: async () => {
      if (editing) {
        await api(settingsPath, { method: "DELETE" });
        return;
      }
      await api("/api/me", { method: "DELETE" });
      try {
        await logout();
      } catch {
        // The account is already gone.
      }
    },
    onSuccess: () => {
      if (editing) {
        queryClient.removeQueries({ queryKey: settingsKey });
        navigate("/me#admin-users");
        return;
      }
      queryClient.clear();
      session.setUser(null);
    },
    onError: (reason) => setDeleteError(reason.message),
  });
  useEffect(() => {
    if (!confirming) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape" && !remove.isPending) closeDelete();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirming, remove.isPending]);

  const dirty = isDirty(draft, saved);
  const trimmed = query.trim();
  const activeList = draft?.listMode === "white" ? draft.whitelist : draft?.blacklist ?? [];
  const listed = new Set(activeList.map((person) => person.id));

  function chooseLevel(next) {
    setDraft((current) => (current && current.danceLevel !== next ? { ...current, danceLevel: next } : current));
  }

  function toggleBlocked(code) {
    setDraft((current) => {
      if (!current) return current;
      const blockedLevels = current.blockedLevels.includes(code)
        ? current.blockedLevels.filter((item) => item !== code)
        : [...current.blockedLevels, code];
      return { ...current, blockedLevels };
    });
  }

  function setListMode(listMode) {
    setQuery("");
    setDraft((current) => (current && current.listMode !== listMode ? { ...current, listMode } : current));
  }

  function addPerson(person) {
    setDraft((current) => {
      if (!current) return current;
      const key = current.listMode === "white" ? "whitelist" : "blacklist";
      if (current[key].some((item) => item.id === person.id)) return current;
      return { ...current, [key]: [...current[key], person].sort(byName) };
    });
    setQuery("");
  }

  function toggleFlag(key) {
    setDraft((current) => (current ? { ...current, [key]: !current[key] } : current));
  }

  function setSlotScope(notifyNewSlotsScope) {
    setDraft((current) => (current && current.notifyNewSlotsScope !== notifyNewSlotsScope ? { ...current, notifyNewSlotsScope } : current));
  }

  function closeDelete() {
    setConfirming(false);
    setDeleteError("");
  }

  function removePerson(id) {
    setDraft((current) => {
      if (!current) return current;
      const key = current.listMode === "white" ? "whitelist" : "blacklist";
      return { ...current, [key]: current[key].filter((person) => person.id !== id) };
    });
  }

  return (
    <div className={styles.profile}>
      <form
        id="profile-settings"
        className={styles.profileForm}
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft || !dirty || save.isPending) return;
          setError("");
          save.mutate(draft);
        }}
      >
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Имя</span>
        <input
          className={styles.input}
          value={draft?.displayName ?? ""}
          disabled={!draft || save.isPending}
          onChange={(event) => setDraft((current) => (current ? { ...current, displayName: event.target.value } : current))}
        />
      </label>
      </form>
      <div className={styles.settings}>
      <h2 className={styles.settingsTitle}>Дополнительные настройки</h2>
      {editing && !saved ? null : (
        <LoginCredentials
          account={editing ? { login: saved.login, hasLogin: saved.hasLogin } : null}
          path={editing ? `${settingsPath}/password` : "/api/me/password"}
          onSaved={editing
            ? (user) => {
                queryClient.setQueryData(settingsKey, (current) => (
                  current ? { ...current, login: user.login, hasLogin: user.hasLogin } : current
                ));
              }
            : undefined}
        />
      )}
      {session.user?.appRole === "admin" && !editing ? <AdminUserSearch /> : null}
      {settingsQuery.isLoading ? <p className={styles.groupHint}>Загрузка</p> : null}
      {settingsQuery.isError ? <p className={styles.error}>{settingsQuery.error.message}</p> : null}
      {draft ? (
        <div className={styles.groups}>
          <section className={styles.group} aria-labelledby="dance-level-title">
            <div className={styles.caption}>
              <h3 className={styles.groupTitle} id="dance-level-title">Уровень</h3>
              <p className={styles.groupHint}>Ваш уровень танцевания</p>
            </div>
            <div className={styles.choices} role="radiogroup" aria-labelledby="dance-level-title">
              <LevelOption
                name="dance-level"
                label="Не указан"
                checked={draft.danceLevel == null}
                disabled={save.isPending}
                onChange={() => chooseLevel(null)}
              />
              {DANCE_LEVELS.map((code) => (
                <LevelOption
                  key={code}
                  name="dance-level"
                  label={code}
                  checked={draft.danceLevel === code}
                  disabled={save.isPending}
                  onChange={() => chooseLevel(code)}
                />
              ))}
            </div>
          </section>
          <section className={styles.group} aria-labelledby="blocked-levels-title">
            <div className={styles.caption}>
              <h3 className={styles.groupTitle} id="blocked-levels-title">Блок по уровню</h3>
              <p className={styles.groupHint}>Танцоры, указавшие выбранный уровень, не смогут отправлять вам приглашения</p>
            </div>
            <div className={styles.choices} role="group" aria-labelledby="blocked-levels-title">
              {DANCE_LEVELS.map((code) => (
                <LevelOption
                  key={code}
                  label={code}
                  checked={draft.blockedLevels.includes(code)}
                  disabled={save.isPending}
                  multiple
                  onChange={() => toggleBlocked(code)}
                />
              ))}
            </div>
          </section>
          <section className={styles.group} aria-labelledby="invite-list-title">
            <div className={styles.groupHead}>
              <h3 className={styles.groupTitle} id="invite-list-title">Списки</h3>
              <div className={styles.caption}>
            <div className={styles.choices} role="radiogroup" aria-labelledby="invite-list-title">
              <LevelOption
                name="invite-list"
                label="Чёрный список"
                checked={draft.listMode !== "white"}
                disabled={save.isPending}
                onChange={() => setListMode("black")}
              />
              <LevelOption
                name="invite-list"
                label="Белый список"
                checked={draft.listMode === "white"}
                disabled={save.isPending}
                onChange={() => setListMode("white")}
              />
              </div>
              <p className={styles.groupHint}>
                {draft.listMode === "white"
                  ? "Приглашения смогут отправлять только эти танцоры"
                  : "Эти танцоры не смогут отправлять вам приглашения"}
              </p>
            </div>
            </div>
            <div className={styles.stack}>
            <input
              className={styles.input}
              value={query}
              placeholder="Имя танцора"
              aria-label="Поиск танцора по имени"
              autoComplete="off"
              disabled={save.isPending}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
            />
            {trimmed ? (
              needle !== trimmed || dancers.isLoading ? (
                <p className={styles.groupHint}>Загрузка</p>
              ) : dancers.isError ? (
                <p className={styles.error}>{dancers.error.message}</p>
              ) : dancers.data.users.length === 0 ? (
                <p className={styles.groupHint}>Никого нет</p>
              ) : (
                <ul className={`${styles.list} ${styles.results}`}>
                  {dancers.data.users.map((person) => (
                    <li className={styles.person} key={person.id}>
                      <Link className={styles.personLink} to={`/dancers/${person.id}`}>{personLabel(person)}</Link>
                      <button
                        className={styles.button}
                        type="button"
                        disabled={save.isPending || listed.has(person.id)}
                        onClick={() => addPerson(person)}
                      >
                        {listed.has(person.id) ? "В списке" : "Добавить"}
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
            {activeList.length === 0 && !trimmed ? (
              <p className={styles.groupHint}>
                {draft.listMode === "white" ? "Пока список пуст, приглашения не сможет отправить никто" : "Пока никого нет"}
              </p>
            ) : null}
            {activeList.length > 0 ? (
              <ul className={styles.list} aria-label={draft.listMode === "white" ? "Белый список" : "Чёрный список"}>
                {activeList.map((person) => (
                  <li className={styles.person} key={person.id}>
                    <span>{personLabel(person)}</span>
                    <button className={styles.button} type="button" disabled={save.isPending} onClick={() => removePerson(person.id)}>
                      Убрать
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            </div>
          </section>
          <section className={styles.group} aria-labelledby="notify-title">
            <h3 className={styles.groupTitle} id="notify-title">Уведомления</h3>
            <div className={styles.checks}>
              <Check
                label="Присылать уведомления о приглашениях"
                checked={draft.notifyInvites}
                disabled={save.isPending}
                onChange={() => toggleFlag("notifyInvites")}
              />
              <Check
                label="Присылать уведомления за час до сампо"
                checked={draft.notifyHourBefore}
                disabled={save.isPending}
                onChange={() => toggleFlag("notifyHourBefore")}
              />
              <Check
                label="Присылать уведомления о новых слотах"
                checked={draft.notifyNewSlots}
                disabled={save.isPending}
                onChange={() => toggleFlag("notifyNewSlots")}
              />
              {draft.notifyNewSlots ? (
                <div className={styles.nested} role="radiogroup" aria-label="Какие новые слоты присылать">
                  <Radio
                    name="notify-new-slots"
                    label="Только слоты, которые попадают в свободное время"
                    checked={draft.notifyNewSlotsScope !== "all"}
                    disabled={save.isPending}
                    onChange={() => setSlotScope("free")}
                  />
                  <Radio
                    name="notify-new-slots"
                    label="Все новые слоты"
                    checked={draft.notifyNewSlotsScope === "all"}
                    disabled={save.isPending}
                    onChange={() => setSlotScope("all")}
                  />
                </div>
              ) : null}
            </div>
            {editing ? null : <PhonePush />}
          </section>
          <section className={styles.group} aria-labelledby="share-title">
            <h3 className={styles.groupTitle} id="share-title">Свободное время</h3>
            <Check
              label="Делиться информацией о ближайших свободных слотах"
              checked={draft.shareAvailability}
              disabled={save.isPending}
              onChange={() => toggleFlag("shareAvailability")}
            />
          </section>
        </div>
      ) : null}
      </div>
      <div className={styles.save}>
        {error ? <p className={styles.error}>{error}</p> : null}
        <button className={styles.primary} type="submit" form="profile-settings" disabled={!dirty || save.isPending || remove.isPending}>
          Сохранить изменения
        </button>
      </div>
      <div className={styles.row}>
        {editing || !onLogout ? null : (
          <button className={`${styles.button} ${styles.mobileLogout}`} type="button" disabled={pendingLogout} onClick={onLogout}>
            Выйти
          </button>
        )}
        <button className={`${styles.button} ${styles.danger}`} type="button" disabled={remove.isPending} onClick={() => setConfirming(true)}>
          Удалить профиль
        </button>
      </div>
      {confirming ? (
        <Sheet
          onClose={() => {
            if (!remove.isPending) closeDelete();
          }}
          labelledBy="delete-profile-title"
          describedBy="delete-profile-text"
        >
          <div className={styles.dialogHead}>
            <h2 className={styles.dialogTitle} id="delete-profile-title">Удалить профиль</h2>
            <button className={styles.close} type="button" aria-label="Закрыть" disabled={remove.isPending} onClick={closeDelete}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <p className={styles.dialogText} id="delete-profile-text">
            {editing && saved?.displayName ? `Профиль «${saved.displayName}» и все связанные данные будут удалены: ` : "Профиль и все связанные данные будут удалены: "}
            имя, уровень, списки, посещения, свободное время, запросы и уведомления. Восстановить их нельзя.
          </p>
          {deleteError ? <p className={styles.error}>{deleteError}</p> : null}
          <div className={styles.row}>
            <button className={styles.primary} type="button" disabled={remove.isPending} onClick={() => remove.mutate()}>
              Удалить профиль
            </button>
            <button className={styles.button} type="button" disabled={remove.isPending} onClick={closeDelete}>
              Отмена
            </button>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}

function LoginCredentials({ account, path, onSaved }) {
  const session = useSession();
  const savedLogin = account ? account.login || "" : session.user?.login || "";
  const hasLogin = account ? Boolean(account.hasLogin) : Boolean(session.user?.hasLogin);
  const [loginName, setLoginName] = useState(savedLogin);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    setLoginName(savedLogin);
  }, [savedLogin]);
  const save = useMutation({
    mutationFn: (body) => api(path, { method: "POST", body }),
    onSuccess: (user) => {
      setError("");
      setNotice(hasLogin ? "Логин и пароль сохранены" : "Теперь можно входить по логину и паролю");
      setPassword("");
      setConfirm("");
      if (onSaved) onSaved(user);
      else session.setUser({ ...session.user, ...user, accountSwitch: session.user?.accountSwitch });
    },
    onError: (reason) => {
      setNotice("");
      setError(reason.message);
    },
  });
  const loginChanged = loginName.trim().toLowerCase() !== savedLogin;
  const canSave = !save.isPending && (password.length > 0 || (hasLogin && loginChanged));

  function submit() {
    setError("");
    setNotice("");
    if (password !== confirm) {
      setError("Пароли не совпадают");
      return;
    }
    save.mutate({ login: loginName, password });
  }

  return (
    <form
      className={styles.group}
      aria-labelledby="credentials-title"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) submit();
      }}
    >
      <div className={styles.caption}>
        <h3 className={styles.groupTitle} id="credentials-title">Вход по логину</h3>
        <p className={styles.groupHint}>
          {hasLogin
            ? "Эти логин и пароль подходят для входа. Чтобы сменить пароль, введите новый: пустые поля пароль не меняют."
            : "Задайте логин и пароль, чтобы входить без ВКонтакте."}
        </p>
      </div>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Логин</span>
        <input
          className={styles.input}
          value={loginName}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck="false"
          disabled={save.isPending}
          onChange={(event) => {
            setLoginName(event.target.value);
            setNotice("");
          }}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>{hasLogin ? "Новый пароль" : "Пароль"}</span>
        <input
          className={styles.input}
          type="password"
          value={password}
          autoComplete="new-password"
          disabled={save.isPending}
          onChange={(event) => {
            setPassword(event.target.value);
            setNotice("");
          }}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>{hasLogin ? "Новый пароль ещё раз" : "Пароль ещё раз"}</span>
        <input
          className={styles.input}
          type="password"
          value={confirm}
          autoComplete="new-password"
          disabled={save.isPending}
          onChange={(event) => {
            setConfirm(event.target.value);
            setNotice("");
          }}
        />
      </label>
      {error ? <p className={styles.error}>{error}</p> : null}
      {notice ? <p className={styles.saved}>{notice}</p> : null}
      <div className={styles.row}>
        <button className={styles.primary} type="submit" disabled={!canSave}>
          {hasLogin ? "Сохранить логин и пароль" : "Задать логин и пароль"}
        </button>
      </div>
    </form>
  );
}

function AdminUserSearch({ creating = false, onCreatingChange }) {
  const [query, setQuery] = useState("");
  const [needle, setNeedle] = useState("");
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setNeedle(query.trim());
      setPage(1);
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);
  const accounts = useQuery({
    queryKey: ["admin-users", needle, page],
    queryFn: () => api(`/api/admin/users?q=${encodeURIComponent(needle)}&page=${page}`),
    placeholderData: keepPreviousData,
  });
  const data = accounts.data;
  const users = data?.users ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize || 10;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const shownPage = Math.min(page, pageCount);
  const from = total === 0 ? 0 : (shownPage - 1) * pageSize + 1;
  const to = Math.min(shownPage * pageSize, total);

  useEffect(() => {
    if (!data) return;
    const pages = Math.max(1, Math.ceil(data.total / (data.pageSize || 10)));
    if (page > pages) setPage(pages);
  }, [data, page]);

  useEffect(() => {
    if (creating) setNotice("");
  }, [creating]);

  return (
    <section className={`${styles.group} ${styles.adminUsers}`} id="admin-users" aria-labelledby="admin-users-title">
      <div className={styles.caption}>
        <h3 className={styles.groupTitle} id="admin-users-title">Пользователи</h3>
        <p className={styles.groupHint}>Откройте профиль, чтобы изменить или удалить его.</p>
      </div>
      {notice ? <p className={styles.saved}>{notice}</p> : null}
      <input
        className={styles.input}
        value={query}
        placeholder="Имя или логин"
        aria-label="Поиск пользователя"
        autoComplete="off"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }}
      />
      {accounts.isError ? <p className={styles.error}>{accounts.error.message}</p> : null}
      <div className={styles.userTableCard}>
        <div className={styles.userTableWrap}>
          <table className={styles.userTable}>
            <thead>
              <tr>
                <th scope="col">Имя</th>
                <th scope="col">Логин</th>
                <th scope="col">Уровень</th>
              </tr>
            </thead>
            <tbody>
              {!data && accounts.isPending ? (
                <tr className={styles.userTableNote}>
                  <td colSpan={3}>Загрузка</td>
                </tr>
              ) : null}
              {data && users.length === 0 ? (
                <tr className={styles.userTableNote}>
                  <td colSpan={3}>Никого нет</td>
                </tr>
              ) : null}
              {users.map((person) => (
                <tr key={person.id}>
                  <td>
                    <Link className={styles.userLink} to={`/admin/users/${person.id}`}>
                      {person.displayName}
                    </Link>
                  </td>
                  <td className={styles.userLogin}>{person.login || "—"}</td>
                  <td className={styles.userLevel}>{person.danceLevel || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.userPager}>
          <button
            className={styles.userNav}
            type="button"
            aria-label="Предыдущая страница"
            disabled={shownPage <= 1}
            onClick={() => setPage(shownPage - 1)}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M14.5 6.5 9 12l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <p className={styles.userRange}>{total === 0 ? "0 из 0" : `${from}–${to} из ${total}`}</p>
          <button
            className={styles.userNav}
            type="button"
            aria-label="Следующая страница"
            disabled={shownPage >= pageCount}
            onClick={() => setPage(shownPage + 1)}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M9.5 6.5 15 12l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
      {creating ? (
        <CreateUserDialog
          onClose={() => onCreatingChange(false)}
          onCreated={(user) => {
            onCreatingChange(false);
            setNotice(`Пользователь ${user.displayName} создан. Вход по логину ${user.login}.`);
          }}
        />
      ) : null}
    </section>
  );
}

function CreateUserDialog({ onClose, onCreated }) {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState("");
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: (body) => api("/api/admin/users", { method: "POST", body }),
    onSuccess: (user) => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      onCreated(user);
    },
    onError: (reason) => setError(reason.message),
  });
  const canSave = !save.isPending && displayName.trim() && loginName.trim() && password;

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape" && !save.isPending) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, save.isPending]);

  function submit() {
    setError("");
    if (password !== confirm) {
      setError("Пароли не совпадают");
      return;
    }
    save.mutate({ displayName, login: loginName, password });
  }

  return (
    <Sheet
      as="form"
      size="l"
      labelledBy="admin-user-title"
      onClose={() => {
        if (!save.isPending) onClose();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) submit();
      }}
    >
        <div className={styles.dialogHead}>
          <h2 className={styles.dialogTitle} id="admin-user-title">Новый пользователь</h2>
          <button className={styles.close} type="button" aria-label="Закрыть" disabled={save.isPending} onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <p className={styles.dialogText}>Регистрация по логину и паролю. Войти можно сразу после создания.</p>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Имя</span>
          <input
            className={styles.input}
            value={displayName}
            autoComplete="off"
            autoFocus
            disabled={save.isPending}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Логин</span>
          <input
            className={styles.input}
            value={loginName}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck="false"
            disabled={save.isPending}
            onChange={(event) => setLoginName(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Пароль</span>
          <input
            className={styles.input}
            type="password"
            value={password}
            autoComplete="new-password"
            disabled={save.isPending}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Пароль ещё раз</span>
          <input
            className={styles.input}
            type="password"
            value={confirm}
            autoComplete="new-password"
            disabled={save.isPending}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </label>
        {error ? <p className={styles.error}>{error}</p> : null}
        <div className={styles.row}>
          <button className={styles.primary} type="submit" disabled={!canSave}>
            Зарегистрировать
          </button>
        </div>
    </Sheet>
  );
}

function LevelOption({ name, label, checked, disabled, multiple, onChange }) {
  return (
    <label className={checked ? styles.choiceOn : styles.choice}>
      <input
        className={styles.radio}
        type={multiple ? "checkbox" : "radio"}
        name={name}
        value={label}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      {label}
    </label>
  );
}

function PhonePush() {
  const [state, setState] = useState("loading");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const iosBrowser = iosNeedsHomeScreen();

  useEffect(() => {
    let active = true;
    preparePush().then((ok) => {
      if (active) setReady(ok);
    });
    readPhonePush()
      .then((next) => {
        if (active) setState(next);
      })
      .catch(() => {
        if (active) setState("unsupported");
      });
    return () => {
      active = false;
    };
  }, []);

  async function turnOn() {
    setPending(true);
    setError("");
    try {
      const next = await enablePhonePush();
      setState(next);
      if (next === "denied") setError("Браузер запретил уведомления. Разрешите их в настройках сайта.");
    } catch (reason) {
      if (reason.state) setState(reason.state);
      setError(reason.message || "Не удалось включить уведомления");
    } finally {
      setPending(false);
    }
  }

  async function turnOff() {
    setPending(true);
    setError("");
    try {
      setState(await disablePhonePush());
    } catch (reason) {
      setError(reason.message || "Не удалось выключить уведомления");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.stack}>
      <p className={styles.groupHint}>
        {state === "subscribed"
          ? "Уведомления на этот телефон включены."
          : "Приглашения и ответы можно получать уведомлением на телефон."}
      </p>
      {iosBrowser ? (
        <p className={styles.groupHint}>
          На iPhone откройте иконку «Сампо» на экране «Домой» и включите уведомления уже там. В Safari они не доходят.
        </p>
      ) : null}
      {state === "denied" ? (
        <p className={styles.groupHint}>Браузер запретил уведомления. Разрешите их в настройках сайта и нажмите ещё раз.</p>
      ) : null}
      {state === "unsupported" ? <p className={styles.groupHint}>Этот браузер не принимает уведомления на телефон.</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      {state === "loading" || state === "unsupported" || iosBrowser ? null : state === "subscribed" ? (
        <div className={styles.row}>
          <button className={styles.button} type="button" disabled={pending} onClick={turnOff}>
            Выключить на этом устройстве
          </button>
        </div>
      ) : (
        <div className={styles.row}>
          <button className={styles.button} type="button" disabled={pending || !ready} onClick={turnOn}>
            Включить уведомления на устройстве
          </button>
        </div>
      )}
    </div>
  );
}

function Check({ label, checked, disabled, onChange }) {
  return (
    <label className={styles.check}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
      {label}
    </label>
  );
}

function Radio({ name, label, checked, disabled, onChange }) {
  return (
    <label className={styles.check}>
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} />
      {label}
    </label>
  );
}

function personLabel(person) {
  return person.danceLevel ? `${person.displayName} · ${person.danceLevel}` : person.displayName;
}

function byName(left, right) {
  return left.displayName.localeCompare(right.displayName, "ru") || left.id.localeCompare(right.id);
}

function sameIds(left, right) {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((id, index) => id === b[index]);
}

function isDirty(draft, saved) {
  if (!draft || !saved) return false;
  if (draft.displayName.trim() !== saved.displayName) return true;
  if (draft.danceLevel !== saved.danceLevel) return true;
  if (draft.listMode !== saved.listMode) return true;
  if (draft.notifyInvites !== saved.notifyInvites) return true;
  if (draft.notifyHourBefore !== saved.notifyHourBefore) return true;
  if (draft.notifyNewSlots !== saved.notifyNewSlots) return true;
  if ((draft.notifyNewSlotsScope === "all" ? "all" : "free") !== (saved.notifyNewSlotsScope === "all" ? "all" : "free")) return true;
  if (draft.shareAvailability !== saved.shareAvailability) return true;
  if (!sameIds(draft.blockedLevels, saved.blockedLevels)) return true;
  if (!sameIds(draft.blacklist.map((person) => person.id), saved.blacklist.map((person) => person.id))) return true;
  return !sameIds(draft.whitelist.map((person) => person.id), saved.whitelist.map((person) => person.id));
}
