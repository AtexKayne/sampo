import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { SITE_ORIGIN, SITE_TITLE } from "../site.js";

const PRIVATE_TITLES = [
  [/^\/calendar$/, "Календарь"],
  [/^\/admin\/slots$/, "Слоты"],
  [/^\/requests$/, "Запросы"],
  [/^\/requests\//, "Запрос"],
  [/^\/me\/availability$/, "Свободное время"],
  [/^\/me$/, "Профиль"],
  [/^\/dancers\//, "Участник"],
  [/^\/slots\//, "Слот"],
];

export function DocumentMeta() {
  const { pathname } = useLocation();

  useEffect(() => {
    const named = PRIVATE_TITLES.find(([pattern]) => pattern.test(pathname));
    const isPublic = pathname === "/login";
    document.title = isPublic ? SITE_TITLE : named ? `${named[1]} — Сампо` : "Сампо";
    setMeta("robots", isPublic ? "index, follow, max-image-preview:large" : "noindex, nofollow");
    setLink("canonical", isPublic ? `${SITE_ORIGIN}/login` : `${SITE_ORIGIN}${pathname}`);
  }, [pathname]);

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
