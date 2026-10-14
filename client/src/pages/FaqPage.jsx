import { useState } from "react";
import { useLocation } from "react-router-dom";
import { logout } from "../api/client.js";
import { Shell } from "../components/Shell.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import styles from "./FaqPage.module.scss";

const QUESTIONS = [
  {
    id: "mark",
    title: "Как отметить свободное время?",
    paragraphs: [
      "В календаре протяни интервал или нажми начало и конец. Время тюменское, с 9:00 до 00:00, шаг 30 минут. Прошедшее отметить нельзя. Недели листаются стрелками над таблицей.",
      "На пустом месте интервал свободный: в это время тебя можно пригласить. Если провести новый интервал внутри уже свободного, это время станет недоступным, а остаток дня сохранится.",
      "Один раз можно отметить до 15 часов. Повтор — до 12 часов и не позже 23:30.",
    ],
  },
  {
    id: "repeat",
    title: "Как задать повтор?",
    paragraphs: [
      "После выделения выбери, как повторять интервал: один раз, каждый день, по будням, по выходным или каждые n дней. Например, в будний день отметь время с 18:00 и выбери «По будням».",
      "«По будням» есть, если выбран будний день, «По выходным» — если выходной. «Каждые n дней» считаются от выбранной даты, n — от 2 до 30.",
    ],
  },
  {
    id: "edit",
    title: "Как изменить или удалить интервал?",
    paragraphs: [
      "Правый клик по интервалу или удержание тапа на телефоне открывает правку: можно сменить время и повтор.",
      "Удаление спрашивает, убрать свободное время только в этот день или всю серию повторов.",
    ],
  },
  {
    id: "active",
    title: "Когда меня можно пригласить?",
    paragraphs: [
      "Если слот сампо хотя бы частично попадает в отмеченный интервал, он становится активным. Другой пользователь увидит тебя в списке «Можно пригласить» на этом слоте. Касание ровно по границе не считается: слот должен зайти внутрь интервала.",
      "Без отметки пригласить нельзя. Запись «Приду один» или «Приду с партнёром» место занимает, но сама по себе в этот список не добавляет.",
    ],
  },
  {
    id: "one-slot",
    title: "Как включить один слот?",
    paragraphs: [
      "Открой слот, который ещё не начался, и нажми «Жду приглашения на этот слот». Так он становится активным без интервала в календаре.",
      "«Не приглашать в этот слот» выключает его, даже если время накрыто свободным интервалом.",
    ],
  },
  {
    id: "invite",
    title: "Как пригласить человека?",
    paragraphs: [
      "Открой слот и в списке «Можно пригласить» найди имя. В строке есть кнопка «Пригласить». В списке только те, кто свободен на этот слот.",
      "Там же видны запросы на слот: входящий можно подтвердить или отказать, свой ещё не отвеченный — отозвать.",
    ],
  },
  {
    id: "pair",
    title: "Что будет после подтверждения?",
    paragraphs: [
      "Подтверждённый запрос собирает пару на этот слот. Оба перестают быть свободными для новых приглашений на него. Чтобы снова звали, отметку или интервал нужно включить заново.",
      "Пару можно отменить до начала слота. Запись при этом остаётся. После начала слота пару отменить нельзя.",
    ],
  },
  {
    id: "lists",
    title: "Кто может меня приглашать?",
    paragraphs: [
      "Это настраивается в профиле, в блоке «Списки». Чёрный список: эти танцоры не смогут отправлять тебе приглашения. Белый список: приглашения смогут отправлять только они. Пока белый список пуст, не сможет никто.",
      "«Блок по уровню» закрывает приглашения от танцоров, которые указали выбранный уровень. Свой уровень задаётся рядом, в блоке «Уровень».",
    ],
  },
  {
    id: "login",
    title: "Как входить по логину?",
    paragraphs: [
      "Новый профиль создаётся через ВКонтакте. После входа в профиле, в блоке «Вход по логину», задай логин и пароль — ими можно входить без ВК.",
      "Если логин уже есть, его можно сменить. Пустые поля пароля текущий пароль не меняют.",
    ],
  },
  {
    id: "notifications",
    title: "Как включить уведомления?",
    paragraphs: [
      "В профиле, в блоке «Уведомления», можно включить сообщения о приглашениях и напоминание за час до сампо. Непрочитанные собираются в колокольчике в шапке.",
      "Пуш на телефон включается там же, кнопкой «Включить уведомления на телефон». Сначала установи Сампо на экран «Домой» и открой его оттуда. На iPhone из Safari пуш не приходит.",
    ],
  },
  {
    id: "share",
    title: "Что видят другие на моей странице?",
    paragraphs: [
      "Имя, уровень и число посещений. Если в профиле включено «Делиться информацией о ближайших свободных слотах», на странице появятся ближайшие слоты, где тебя можно пригласить.",
    ],
  },
];

function openFromHash(hash) {
  const id = hash.slice(1);
  return QUESTIONS.some((item) => item.id === id) ? id : null;
}

export function FaqPage() {
  const session = useSession();
  const location = useLocation();
  const [pending, setPending] = useState(false);
  const [openId, setOpenId] = useState(() => openFromHash(location.hash));
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
      <h1 className={styles.title}>FAQ</h1>
      <p className={styles.lead}>Как отмечать свободное время, когда тебя можно пригласить и что настраивается в профиле.</p>
      <div className={styles.list}>
        {QUESTIONS.map((item) => (
          <FaqItem
            key={item.id}
            item={item}
            open={openId === item.id}
            onToggle={() => setOpenId((current) => (current === item.id ? null : item.id))}
          />
        ))}
      </div>
    </Shell>
  );
}

function FaqItem({ item, open, onToggle }) {
  const panelId = `faq-${item.id}`;

  return (
    <section className={styles.item}>
      <h2 className={styles.question} id={item.id}>
        <button className={styles.toggle} type="button" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
          <span>{item.title}</span>
          <svg className={open ? styles.caretOpen : styles.caret} viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </h2>
      {open ? (
        <div className={styles.answers} id={panelId}>
          {item.paragraphs.map((paragraph) => (
            <p className={styles.answer} key={paragraph}>
              {paragraph}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
