import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link, Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DANCE_LEVELS } from "../../../shared/dance-levels.js";
import { api, logout } from "../api/client.js";
import { Shell } from "../components/Shell.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import styles from "./user.module.scss";

export function ProfilePage() {
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
      <h1 className={styles.title}>Профиль</h1>
      <ProfileSettings />
    </Shell>
  );
}

function ProfileSettings() {
  const session = useSession();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [query, setQuery] = useState("");
  const [needle, setNeedle] = useState("");
  const settingsQuery = useQuery({
    queryKey: ["profile-settings"],
    queryFn: () => api("/api/me/settings"),
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
      api("/api/me/settings", {
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
          shareAvailability: profile.shareAvailability,
        },
      }),
    onSuccess: (next) => {
      setError("");
      setDraft(next);
      queryClient.setQueryData(["profile-settings"], next);
      session.setUser({ ...session.user, displayName: next.displayName });
    },
    onError: (reason) => setError(reason.message),
  });
  const remove = useMutation({
    mutationFn: async () => {
      await api("/api/me", { method: "DELETE" });
      try {
        await logout();
      } catch {
        // The account is already gone.
      }
    },
    onSuccess: () => {
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
      {saved ? (
        <section className={styles.visits} aria-labelledby="visits-title">
          <h2 className={styles.groupTitle} id="visits-title">Посещения</h2>
          <dl className={styles.stats}>
            <div className={styles.stat}>
              <dt className={styles.statLabel}>За месяц</dt>
              <dd className={styles.statValue}>{saved.visits.month}</dd>
            </div>
            <div className={styles.stat}>
              <dt className={styles.statLabel}>Всего</dt>
              <dd className={styles.statValue}>{saved.visits.total}</dd>
            </div>
          </dl>
        </section>
      ) : null}
      </form>
      <div className={styles.settings}>
      <h2 className={styles.settingsTitle}>Дополнительные настройки</h2>
      <LoginCredentials />
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
            </div>
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
        <button className={`${styles.button} ${styles.danger}`} type="button" disabled={remove.isPending} onClick={() => setConfirming(true)}>
          Удалить профиль
        </button>
      </div>
      {confirming
        ? createPortal(
            <div className={styles.backdrop} onClick={() => !remove.isPending && closeDelete()}>
              <div
                className={styles.dialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby="delete-profile-title"
                aria-describedby="delete-profile-text"
                onClick={(event) => event.stopPropagation()}
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
                  Профиль и все связанные данные будут удалены: имя, уровень, списки, посещения, свободное время, запросы и уведомления. Восстановить их нельзя.
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
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function LoginCredentials() {
  const session = useSession();
  const savedLogin = session.user?.login || "";
  const hasLogin = Boolean(session.user?.hasLogin);
  const [loginName, setLoginName] = useState(savedLogin);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    setLoginName(savedLogin);
  }, [savedLogin]);
  const save = useMutation({
    mutationFn: (body) => api("/api/me/password", { method: "POST", body }),
    onSuccess: (user) => {
      setError("");
      setNotice(hasLogin ? "Логин и пароль сохранены" : "Теперь можно входить по логину и паролю");
      setPassword("");
      setConfirm("");
      session.setUser(user);
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

function Check({ label, checked, disabled, onChange }) {
  return (
    <label className={styles.check}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
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
  if (draft.shareAvailability !== saved.shareAvailability) return true;
  if (!sameIds(draft.blockedLevels, saved.blockedLevels)) return true;
  if (!sameIds(draft.blacklist.map((person) => person.id), saved.blacklist.map((person) => person.id))) return true;
  return !sameIds(draft.whitelist.map((person) => person.id), saved.whitelist.map((person) => person.id));
}
