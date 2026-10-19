import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useNotifications } from "../notifications/NotificationsProvider.jsx";
import { SITE_ORIGIN, SITE_TITLE } from "../site.js";

const PRIVATE_TITLES = [
  [/^\/calendar$/, "Календарь"],
  [/^\/requests$/, "Запросы"],
  [/^\/requests\//, "Запрос"],
  [/^\/me\/availability$/, "Свободное время"],
  [/^\/admin\/users\//, "Профиль"],
  [/^\/me$/, "Профиль"],
  [/^\/dancers\//, "Участник"],
  [/^\/slots\//, "Слот"],
];

export function DocumentMeta() {
  const { pathname } = useLocation();
  const { notes } = useNotifications();
  const unread = notes.filter((note) => !note.readAt).length;

  useEffect(() => {
    const named = PRIVATE_TITLES.find(([pattern]) => pattern.test(pathname));
    const isLogin = pathname === "/login";
    const isFaq = pathname === "/faq";
    const isCookies = pathname === "/cookies";
    const isPublic = isLogin || isFaq || isCookies;
    const base = isCookies ? "Файлы cookie — Сампо" : isFaq ? "FAQ — Сампо" : isPublic ? SITE_TITLE : named ? `${named[1]} — Сампо` : "Сампо";
    document.title = unread > 0 ? `(${unread}) ${base}` : base;
    setMeta("robots", isPublic ? "index, follow, max-image-preview:large" : "noindex, nofollow");
    setLink("canonical", isLogin ? `${SITE_ORIGIN}/login` : `${SITE_ORIGIN}${pathname}`);
  }, [pathname, unread]);

  return null;
}

function setMeta(name, content) {
  let element = document.querySelector(`meta[name="${name}"]`);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute("name", name);
    document.head.appendChild(element);
  }
  element.setAttribute("content", content);
}

function setLink(rel, href) {
  let element = document.querySelector(`link[rel="${rel}"]`);
  if (!element) {
    element = document.createElement("link");
    element.setAttribute("rel", rel);
    document.head.appendChild(element);
  }
  element.setAttribute("href", href);
}
