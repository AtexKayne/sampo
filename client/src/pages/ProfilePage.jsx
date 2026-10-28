import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DANCE_LEVELS } from "../../../shared/dance-levels.js";
import { api, logout } from "../api/client.js";
import { disablePhonePush, enablePhonePush, iosNeedsHomeScreen, preparePush, readPhonePush } from "../notifications/push.js";
import { AchievementIcon } from "../components/AchievementIcon.jsx";
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
      <Shell user={session.user} onLogout={onLogout} pending={pendingLogout}>
        <div className={styles.adminLayout}>
          <div className={styles.pageHead}>
            <h1 className={styles.title}>Пользователи</h1>
            <div className={styles.headActions}>
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
      <div className={styles.profileHead}>
        <h1 className={styles.title}>Профиль</h1>
        <button className={`${styles.button} ${styles.mobileLogout}`} type="button" disabled={pendingLogout} onClick={onLogout}>
          Выйти
        </button>
      </div>
      <ProfileSettings />
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

function ProfileSettings({ userId }) {
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
  const [pickingAchievements, setPickingAchievements] = useState(false);
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
  }, [saved, editing]);
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
  const hasLogin = editing ? Boolean(saved?.hasLogin) : Boolean(session.user?.hasLogin);
  const credentialsRef = useRef(null);
  const [credentials, setCredentials] = useState(null);
  const [credentialError, setCredentialError] = useState("");
  const [credentialNotice, setCredentialNotice] = useState("");
  const [credentialEpoch, setCredentialEpoch] = useState(0);
  const credentialSave = useMutation({
    mutationFn: (body) => api(editing ? `${settingsPath}/password` : "/api/me/password", { method: "POST", body }),
    onSuccess: (user) => {
      setCredentialError("");
      setCredentialNotice(hasLogin ? "Логин и пароль сохранены" : "Теперь можно входить по логину и паролю");
      setCredentialEpoch((current) => current + 1);
      if (editing) {
        queryClient.setQueryData(settingsKey, (current) => (
          current ? { ...current, login: user.login, hasLogin: user.hasLogin } : current
        ));
        return;
      }
      session.setUser({ ...session.user, ...user, accountSwitch: session.user?.accountSwitch });
    },
    onError: (reason) => {
      setCredentialNotice("");
      setCredentialError(reason.message);
      document.getElementById("credentials-title")?.scrollIntoView({ block: "center" });
    },
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
  const busy = save.isPending || credentialSave.isPending;
  const changed = Boolean(dirty || credentials?.dirty);
  const saveActive = changed || busy;
  useEffect(() => {
    if (!error) return;
    document.getElementById("profile-save-error")?.scrollIntoView({ block: "center" });
  }, [error]);
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

  function onCredentialDraft(next) {
    credentialsRef.current = next;
    setCredentials((current) => (
      current
      && current.login === next.login
      && current.password === next.password
      && current.confirm === next.confirm
      && current.dirty === next.dirty
        ? current
        : next
    ));
  }

  function onCredentialEdit() {
    setCredentialError("");
    setCredentialNotice("");
  }

  async function submitAll() {
    const creds = credentialsRef.current;
    const profileDirty = isDirty(draft, saved);
    const credsDirty = Boolean(creds?.dirty);
    if ((!profileDirty && !credsDirty) || busy || credentialSave.isPending || remove.isPending) return;
    setError("");
    setCredentialError("");
    if (credsDirty && creds.password !== creds.confirm) {
      setCredentialError("Пароли не совпадают");
      document.getElementById("credentials-title")?.scrollIntoView({ block: "center" });
      return;
    }
    try {
      if (profileDirty) await save.mutateAsync(draft);
      if (credsDirty) await credentialSave.mutateAsync({ login: creds.login, password: creds.password });
    } catch {
      // Mutations surface the message.
    }
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
          submitAll();
        }}
      >
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Имя</span>
        <input
          className={styles.input}
          value={draft?.displayName ?? ""}
          disabled={!draft || busy}
          onChange={(event) => setDraft((current) => (current ? { ...current, displayName: event.target.value } : current))}
        />
      </label>
      {editing && saved ? (
        <div className={styles.stack}>
          <SampoCountEditor
            saved={saved}
            disabled={busy || remove.isPending}
            onSaved={(next) => {
              setDraft((current) => (current ? { ...current, visits: next.visits } : current));
              queryClient.setQueryData(settingsKey, next);
            }}
          />
          <button className={`${styles.button} ${styles.achievementButton}`} type="button" disabled={!saved.achievements} onClick={() => setPickingAchievements(true)}>
            Редактировать достижения ({saved.achievements.filter((item) => item.earned).length})
          </button>
        </div>
      ) : null}
      </form>
      <div className={styles.settings}>
      <h2 className={styles.settingsTitle}>Дополнительные настройки</h2>
      {editing && !saved ? null : (
        <LoginCredentials
          account={editing ? { login: saved.login, hasLogin: saved.hasLogin } : null}
          disabled={busy}
          error={credentialError}
          notice={credentialNotice}
          resetKey={credentialEpoch}
          onDraft={onCredentialDraft}
          onEdit={onCredentialEdit}
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
                disabled={busy}
                onChange={() => chooseLevel(null)}
              />
              {DANCE_LEVELS.map((code) => (
                <LevelOption
                  key={code}
                  name="dance-level"
                  label={code}
                  checked={draft.danceLevel === code}
                  disabled={busy}
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
                  disabled={busy}
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
                disabled={busy}
                onChange={() => setListMode("black")}
              />
              <LevelOption
                name="invite-list"
                label="Белый список"
                checked={draft.listMode === "white"}
                disabled={busy}
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
              disabled={busy}
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
                        disabled={busy || listed.has(person.id)}
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
                    <button className={styles.button} type="button" disabled={busy} onClick={() => removePerson(person.id)}>
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
                disabled={busy}
                onChange={() => toggleFlag("notifyInvites")}
              />
              <Check
                label="Присылать уведомления за час до сампо"
                checked={draft.notifyHourBefore}
                disabled={busy}
                onChange={() => toggleFlag("notifyHourBefore")}
              />
              <Check
                label="Присылать уведомления о новых слотах"
                checked={draft.notifyNewSlots}
                disabled={busy}
                onChange={() => toggleFlag("notifyNewSlots")}
              />
              {draft.notifyNewSlots ? (
                <div className={styles.nested} role="radiogroup" aria-label="Какие новые слоты присылать">
                  <Radio
                    name="notify-new-slots"
                    label="Только слоты, которые попадают в свободное время"
                    checked={draft.notifyNewSlotsScope !== "all"}
                    disabled={busy}
                    onChange={() => setSlotScope("free")}
                  />
                  <Radio
                    name="notify-new-slots"
                    label="Все новые слоты"
                    checked={draft.notifyNewSlotsScope === "all"}
                    disabled={busy}
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
              disabled={busy}
              onChange={() => toggleFlag("shareAvailability")}
            />
          </section>
        </div>
      ) : null}
      </div>
      <div className={styles.profileEnd}>
        <button className={`${styles.button} ${styles.danger}`} type="button" disabled={remove.isPending} onClick={() => setConfirming(true)}>
          Удалить профиль
        </button>
        {error ? <p className={styles.error} id="profile-save-error">{error}</p> : null}
        <div className={`${styles.saveSlot} ${saveActive ? styles.saveSlotOn : ""}`}>
          <div className={styles.savePlate}>
            <button
              className={`${styles.primary} ${styles.saveButton}`}
              type="submit"
              form="profile-settings"
              disabled={!changed || busy || remove.isPending}
            >
              Сохранить изменения
            </button>
          </div>
        </div>
      </div>
      {pickingAchievements && saved?.achievements ? (
        <AchievementPicker
          userId={userId}
          items={saved.achievements}
          onClose={() => setPickingAchievements(false)}
          onSaved={(next) => {
            queryClient.setQueryData(settingsKey, next);
            setPickingAchievements(false);
          }}
        />
      ) : null}
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

function LoginCredentials({ account, disabled, error, notice, resetKey, onDraft, onEdit }) {
  const session = useSession();
  const savedLogin = account ? account.login || "" : session.user?.login || "";
  const hasLogin = account ? Boolean(account.hasLogin) : Boolean(session.user?.hasLogin);
  const [loginName, setLoginName] = useState(savedLogin);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const onDraftRef = useRef(onDraft);
  onDraftRef.current = onDraft;
  useEffect(() => {
    setLoginName(savedLogin);
  }, [savedLogin]);
  useEffect(() => {
    setPassword("");
    setConfirm("");
  }, [resetKey]);
  const loginChanged = loginName.trim().toLowerCase() !== savedLogin;
  const dirty = password.length > 0 || confirm.length > 0 || loginChanged;
  useEffect(() => {
    onDraftRef.current({ login: loginName, password, confirm, dirty });
  }, [loginName, password, confirm, dirty]);

  return (
    <section className={styles.group} aria-labelledby="credentials-title">
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
          form="profile-settings"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck="false"
          disabled={disabled}
          onChange={(event) => {
            onEdit();
            setLoginName(event.target.value);
          }}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>{hasLogin ? "Новый пароль" : "Пароль"}</span>
        <input
          className={styles.input}
          type="password"
          value={password}
          form="profile-settings"
          autoComplete="new-password"
          disabled={disabled}
          onChange={(event) => {
            onEdit();
            setPassword(event.target.value);
          }}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>{hasLogin ? "Новый пароль ещё раз" : "Пароль ещё раз"}</span>
        <input
          className={styles.input}
          type="password"
          value={confirm}
          form="profile-settings"
          autoComplete="new-password"
          disabled={disabled}
          onChange={(event) => {
            onEdit();
            setConfirm(event.target.value);
          }}
        />
      </label>
      {error ? <p className={styles.error}>{error}</p> : null}
      {notice ? <p className={styles.saved}>{notice}</p> : null}
    </section>
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

function SampoCountEditor({ saved, disabled, onSaved }) {
  const shown = String(saved.visits?.total ?? 0);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(shown);
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: (sampoTotal) => api(`/api/admin/users/${saved.id}`, {
      method: "PUT",
      body: profileBody(saved, sampoTotal),
    }),
    onSuccess: (next) => {
      setError("");
      setOpen(false);
      setValue(String(next.visits?.total ?? 0));
      onSaved(next);
    },
    onError: (reason) => setError(reason.message),
  });
  const dirty = value !== shown;
  const pending = save.isPending;

  function onAction() {
    if (!open) {
      setError("");
      setValue(shown);
      setOpen(true);
      return;
    }
    if (!dirty) {
      setError("");
      setValue(shown);
      setOpen(false);
      return;
    }
    const sampoTotal = parseSampoTotal(value);
    const month = saved.visits?.month ?? 0;
    const total = saved.visits?.total ?? 0;
    if (sampoTotal == null) {
      setError("Укажите целое число от 0 до 100000");
      return;
    }
    if (total - sampoTotal > month) {
      setError("Нельзя уменьшить больше, чем посещений в этом месяце");
      return;
    }
    setError("");
    save.mutate(sampoTotal);
  }

  const action = !open ? "Изменить" : dirty ? "Сохранить" : "Отменить";

  return (
    <div className={styles.sampoEdit}>
      <div className={styles.sampoRow}>
        <span className={styles.fieldLabel}>Количество сампо</span>
        <span className={styles.sampoSlot}>
          {open ? (
            <input
              className={`${styles.input} ${styles.sampoInput}`}
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              value={value}
              disabled={disabled || pending}
              aria-label="Количество сампо"
              onChange={(event) => {
                const next = event.target.value.replace(/\D/g, "").slice(0, 6);
                setValue(next);
                setError("");
              }}
            />
          ) : (
            <span className={styles.sampoValue}>{shown}</span>
          )}
        </span>
        <button
          className={styles.button}
          type="button"
          disabled={disabled || pending}
          onClick={onAction}
        >
          {action}
        </button>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  );
}

function profileBody(profile, sampoTotal) {
  return {
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
    sampoTotal,
  };
}

function AchievementPicker({ userId, items, onClose, onSaved }) {
  const [selected, setSelected] = useState(() => new Set(items.filter((item) => item.earned).map((item) => item.id)));
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: (achievementIds) => api(`/api/admin/users/${userId}/achievements`, { method: "PUT", body: { achievementIds } }),
    onSuccess: (next) => onSaved(next),
    onError: (reason) => setError(reason.message),
  });
  const dirty = !sameSelection(items, selected);

  function toggle(id) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Sheet
      size="l"
      labelledBy="achievements-edit-title"
      onClose={() => {
        if (!save.isPending) onClose();
      }}
      footer={(
        <>
          {error ? <p className={styles.error}>{error}</p> : null}
          <button className={`${styles.primary} ${styles.wide}`} type="button" disabled={!dirty || save.isPending} onClick={() => save.mutate([...selected])}>
            Сохранить
          </button>
        </>
      )}
    >
      <div className={styles.dialogHead}>
        <h2 className={styles.dialogTitle} id="achievements-edit-title">Ачивки</h2>
        <button className={styles.close} type="button" aria-label="Закрыть" disabled={save.isPending} onClick={onClose}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <p className={styles.dialogText}>Отметьте достижения пользователя. Можно выбрать несколько.</p>
      <ul className={styles.achievementList}>
        {items.map((item) => (
          <li key={item.id}>
            <label className={`${styles.check} ${styles.achievementPick}`}>
              <input
                type="checkbox"
                checked={selected.has(item.id)}
                disabled={save.isPending}
                onChange={() => toggle(item.id)}
              />
              <span className={styles.achievementIcon}>
                <AchievementIcon name={item.id} size={64} />
              </span>
              <span className={styles.achievementOption}>
                <span>{item.title}</span>
                <span className={styles.groupHint}>{item.detail}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

function sameSelection(items, selected) {
  const earned = items.filter((item) => item.earned).map((item) => item.id).sort();
  const chosen = [...selected].sort();
  if (earned.length !== chosen.length) return false;
  return earned.every((id, index) => id === chosen[index]);
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

function parseSampoTotal(value) {
  if (typeof value !== "string" || !/^\d{1,6}$/.test(value.trim())) return null;
  const total = Number(value.trim());
  if (!Number.isInteger(total) || total > 100_000) return null;
  return total;
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
