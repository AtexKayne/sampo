import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { login, register } from "../api/client.js";
import { useSession } from "../session/SessionProvider.jsx";
import styles from "./AuthPage.module.scss";

const VK_MESSAGES = {
  denied: "Вход через ВКонтакте отменён",
  state: "Вход через ВКонтакте не подтверждён. Попробуйте ещё раз.",
  failed: "Не удалось войти через ВКонтакте",
  unavailable: "Вход через ВКонтакте не настроен",
};

export function AuthPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [mode, setMode] = useState("login");
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState(VK_MESSAGES[params.get("vk")] || "");
  const [pending, setPending] = useState(false);

  if (session.status === "loading") {
    return (
      <main className={styles.shell}>
        <p className={styles.status}>Загрузка</p>
      </main>
    );
  }
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

  return (
    <main className={styles.shell}>
      <section className={styles.intro}>
        <p className={styles.eyebrow}>vparaplane</p>
        <h1 className={styles.title}>Сампо</h1>
        <p className={styles.lead}>Самоподготовка по парным танцам. Календарь зала, запись и приглашения в пару.</p>
      </section>
      <section className={styles.panel}>
        <div className={styles.card}>
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
          <a className={styles.secondary} href="/api/auth/vk">
            Войти через ВКонтакте
          </a>
        </div>
      </section>
    </main>
  );
}
