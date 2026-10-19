import { useState } from "react";
import { logout } from "../api/client.js";
import { Shell } from "../components/Shell.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import { COOKIE_NOTICE_KEY, VK_COMMUNITY_URL } from "../site.js";
import styles from "./CookiesPage.module.scss";

export function CookiesPage() {
  const session = useSession();
  const [pending, setPending] = useState(false);
  const user = session.status === "ready" ? session.user : null;

  async function onLogout() {
    setPending(true);
    try {
      await logout();
      session.setUser(null);
    } catch {
      setPending(false);
    }
  }

  if (session.status === "loading") return <p className={styles.status}>Загрузка</p>;

  return (
    <Shell user={user} onLogout={onLogout} pending={pending}>
      <article className={styles.article}>
        <h1 className={styles.title}>Файлы cookie</h1>
        <p className={styles.lead}>
          Сампо на vparaplane.ru хранит в браузере только то, что нужно для входа и работы приложения. Рекламных cookie,
          маркетинговых пикселей и счётчиков посещений нет.
        </p>
        <section className={styles.section}>
          <h2>Зачем плашка</h2>
          <p>
            Плашка внизу экрана сообщает об этих cookie. Кнопка «Понятно» скрывает её на этом устройстве и записывает
            отметку <code className={styles.code}>{COOKIE_NOTICE_KEY}</code> в локальное хранилище браузера. Отдельного
            согласия сайт не спрашивает: других cookie он не ставит. Cookie входа появляются в момент входа.
          </p>
        </section>
        <section className={styles.section}>
          <h2>Cookie сайта</h2>
          <p>
            Их ставит vparaplane.ru. У обеих стоят флаги HttpOnly и SameSite=Lax: скрипт страницы прочитать их не может.
            По адресу https добавляется флаг Secure.
          </p>
          <div className={styles.list}>
            <section className={styles.item}>
              <h3>
                <code className={styles.code}>sampo_refresh</code>
              </h3>
              <p>
                Случайный идентификатор сессии. По нему сервер узнаёт вошедший аккаунт и выдаёт новый токен доступа,
                когда Сампо открывают снова. Пароль и имя в cookie не записываются. На сервере хранится хеш
                идентификатора.
              </p>
              <p>
                Срок — 30 дней с последнего входа или обновления сессии. Выход удаляет cookie. Токен доступа живёт около
                15 минут и остаётся в памяти вкладки.
              </p>
            </section>
            <section className={styles.item}>
              <h3>
                <code className={styles.code}>sampo_vk</code>
              </h3>
              <p>
                Появляется на время входа через ВКонтакте. Внутри служебные значения PKCE: <code className={styles.code}>state</code>,{" "}
                <code className={styles.code}>code_verifier</code> и цель входа. Они связывают ответ VK ID с нажатием
                «Войти через ВКонтакте».
              </p>
              <p>Срок — 10 минут. После возврата на сайт cookie удаляется.</p>
            </section>
          </div>
        </section>
        <section className={styles.section}>
          <h2>Локальное хранилище</h2>
          <p>Рядом с cookie приложение пишет несколько служебных значений в память браузера. На сервер они сами не уходят.</p>
          <ul className={styles.points}>
            <li>
              <code className={styles.code}>sampo.calendar-view</code> — сетка или список в календаре.
            </li>
            <li>
              <code className={styles.code}>sampo-announced-notices</code> — какие уведомления колокольчика уже показаны.
            </li>
            <li>
              <code className={styles.code}>{COOKIE_NOTICE_KEY}</code> — плашка о cookie закрыта.
            </li>
            <li>
              <code className={styles.code}>sampo-push-asked</code> — во временной памяти вкладки: предложение включить
              уведомления на телефон уже было.
            </li>
          </ul>
          <p>Уведомления на телефон включаются отдельно, разрешением браузера в профиле.</p>
        </section>
        <section className={styles.section}>
          <h2>Другие сайты</h2>
          <p>
            Шрифты запрашиваются у Google (<code className={styles.code}>fonts.googleapis.com</code> и{" "}
            <code className={styles.code}>fonts.gstatic.com</code>). На домен vparaplane.ru эти запросы cookie не ставят.
            Google видит технический адрес запроса.
          </p>
          <p>
            Вход через ВКонтакте открывает VK ID (<code className={styles.code}>id.vk.ru</code>). Там действуют правила
            ВКонтакте, и cookie остаются на стороне ВКонтакте.
          </p>
        </section>
        <section className={styles.section}>
          <h2>Если отключить cookie</h2>
          <p>
            Cookie можно удалить или запретить в настройках браузера для vparaplane.ru. Без{" "}
            <code className={styles.code}>sampo_refresh</code> Сампо не восстановит вход после закрытия вкладки. Очистка
            данных сайта сбрасывает вид календаря, и плашка о cookie появляется снова.
          </p>
        </section>
        <section className={styles.section}>
          <h2>Вопросы</h2>
          <p>
            Напишите в{" "}
            <a href={VK_COMMUNITY_URL} target="_blank" rel="noopener noreferrer">
              сообщество ВКонтакте
            </a>
            .
          </p>
          <p className={styles.dated}>Текст от 19 октября 2026 года.</p>
        </section>
      </article>
    </Shell>
  );
}
