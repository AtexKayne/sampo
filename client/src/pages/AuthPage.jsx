import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { login } from "../api/client.js";
import { FloatField } from "../components/FloatField.jsx";
import { SiteFooter } from "../components/SiteFooter.jsx";
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
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
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
      const user = await login({ login: loginName, password });
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
          <form className={styles.form} onSubmit={onSubmit}>
            <FloatField className={styles.field} label="Логин">
              <input
                className={styles.input}
                value={loginName}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck="false"
                onChange={(event) => setLoginName(event.target.value)}
              />
            </FloatField>
            <FloatField className={styles.field} label="Пароль">
              <input
                className={styles.input}
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
              />
            </FloatField>
            {error ? <p className={styles.error}>{error}</p> : null}
            <button className={styles.button} type="submit" disabled={pending}>
              Войти
            </button>
          </form>
          <a className={styles.secondary} href="/api/auth/vk">
            Войти через ВКонтакте
          </a>
          <p className={styles.hint}>Новый профиль создаётся только через ВКонтакте. Логин и пароль можно задать после входа, в профиле.</p>
          <p className={styles.hint}>
            Как пользоваться — в разделе <Link className={styles.faq} to="/faq">FAQ</Link>.
          </p>
        </div>
        <SiteFooter className={styles.legal} />
      </section>
    </main>
  );
}
