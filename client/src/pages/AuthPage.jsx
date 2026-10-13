import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { login, register, vkLoginMessage } from "../api/client.js";
import { useSession } from "../session/SessionProvider.jsx";
import styles from "./AuthPage.module.scss";

export function AuthPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  if (session.status === "loading") return <p className={styles.status}>Загрузка</p>;
  if (session.user) return <Navigate to="/calendar" replace />;

  async function onSubmit(event) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const body = { login: loginName, password };
      const user =
        mode === "login" ? await login(body) : await register({ ...body, displayName });
      session.setUser(user);
      navigate("/calendar", { replace: true });
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setPending(false);
    }
  }

  async function onVk() {
    setError("");
    try {
      await vkLoginMessage();
    } catch (vkError) {
      setError(vkError.message);
    }
  }

  return (
    <main className={styles.shell}>
      <h1 className={styles.title}>Сампо</h1>
      <p className={styles.lead}>Самоподготовка по парным танцам</p>
      <div className={styles.tabs} role="tablist">
        <button
          className={styles.tab}
          type="button"
          role="tab"
          aria-selected={mode === "login"}
          onClick={() => {
            setMode("login");
            setError("");
          }}
        >
          Вход
        </button>
        <button
          className={styles.tab}
          type="button"
          role="tab"
          aria-selected={mode === "register"}
          onClick={() => {
            setMode("register");
            setError("");
          }}
        >
          Регистрация
        </button>
      </div>
      <form className={styles.form} onSubmit={onSubmit}>
        {mode === "register" ? (
          <label className={styles.field}>
            <span className={styles.label}>Имя</span>
            <input
              className={styles.input}
              value={displayName}
              autoComplete="name"
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
        ) : null}
        <label className={styles.field}>
          <span className={styles.label}>Логин</span>
          <input
            className={styles.input}
            value={loginName}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck="false"
            onChange={(event) => setLoginName(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Пароль</span>
          <input
            className={styles.input}
            type="password"
            value={password}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error ? <p className={styles.error}>{error}</p> : null}
        <button className={styles.button} type="submit" disabled={pending}>
          {mode === "login" ? "Войти" : "Зарегистрироваться"}
        </button>
      </form>
      <button className={styles.secondary} type="button" onClick={onVk}>
        Войти через ВКонтакте
      </button>
    </main>
  );
}
