import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client.js";
import { useSession } from "../session/SessionProvider.jsx";
import styles from "../components/Shell.module.scss";

const STORAGE_KEY = "sampo-announced-notices";
const REQUEST_NOTICE = new Set([
  "request_received",
  "request_accepted",
  "request_declined",
  "request_withdrawn",
  "request_expired",
  "request_superseded",
]);

const NotificationsContext = createContext(null);
const announced = readAnnounced();
const toastTimers = new Map();
let liveToasts = [];
let publishToasts = () => {};

export function NotificationsProvider({ children }) {
  const session = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [toasts, setToasts] = useState(liveToasts);
  const [connected, setConnected] = useState(false);
  const notesQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api("/api/notifications"),
    enabled: session.status === "ready" && Boolean(session.user),
    refetchInterval: connected ? 60000 : 15000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (session.status !== "ready" || !session.user) return undefined;
    let stopped = false;
    let socket;
    let attempt = 0;
    let timer;

    function connect() {
      if (stopped) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/api/notifications/stream`);
      socket.onopen = () => {
        attempt = 0;
        setConnected(true);
      };
      socket.onmessage = (event) => receiveNotification(queryClient, event.data);
      socket.onclose = (closeEvent) => {
        setConnected(false);
        if (stopped || closeEvent.code === 4401 || closeEvent.code === 4403) return;
        const delay = Math.min(30000, 1000 * 2 ** attempt) + Math.random() * 400;
        attempt += 1;
        timer = setTimeout(connect, delay);
      };
    }

    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      setConnected(false);
      socket?.close();
    };
  }, [session.status, session.user, queryClient]);

  useEffect(() => {
    publishToasts = setToasts;
    setToasts(liveToasts);
    return () => {
      publishToasts = () => {};
    };
  }, []);

  useEffect(() => {
    const list = notesQuery.data?.notifications;
    if (!list) return;
    const fresh = list.filter((note) => !note.readAt && !announced.has(note.id));
    rememberAnnounced(list.map((note) => note.id));
    if (fresh.length) showToasts(fresh);
  }, [notesQuery.data]);

  const notes = notesQuery.data?.notifications ?? [];
  const value = useMemo(
    () => ({
      notes,
      openNotice(note) {
        dismissToast(note.id);
        navigate(noticeHref(note));
        api(`/api/notifications/${note.id}/read`, { method: "POST" })
          .then(() => queryClient.invalidateQueries({ queryKey: ["notifications"] }))
          .catch(() => {});
      },
      clearNotices() {
        return api("/api/notifications", { method: "DELETE" }).then(() => {
          queryClient.setQueryData(["notifications"], { notifications: [] });
          dismissToasts();
        });
      },
    }),
    [notes, navigate, queryClient],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      {toasts.length
        ? createPortal(
            <div className={styles.toasts} aria-live="polite">
              {toasts.map((note) => (
                <button className={styles.toast} type="button" key={note.id} onClick={() => value.openNotice(note)}>
                  {note.text}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const value = useContext(NotificationsContext);
  if (!value) throw new Error("Уведомления доступны только внутри приложения");
  return value;
}

function receiveNotification(queryClient, raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }
  const note = message?.type === "notification" ? message.notification : null;
  if (!note?.id || announced.has(note.id)) return;
  rememberAnnounced([note.id]);
  showToasts([note]);
  let stored = false;
  queryClient.setQueryData(["notifications"], (current) => {
    const list = current?.notifications;
    if (!list) return current;
    stored = true;
    if (list.some((item) => item.id === note.id)) return current;
    return { ...current, notifications: [note, ...list].slice(0, 50) };
  });
  if (!stored) queryClient.invalidateQueries({ queryKey: ["notifications"] });
}

function noticeHref(note) {
  if (note.type === "slot_reminder" && note.slotId) return `/slots/${note.slotId}`;
  if (REQUEST_NOTICE.has(note.type)) return "/requests";
  if (note.slotId) return `/slots/${note.slotId}`;
  return "/requests";
}

function showToasts(fresh) {
  const known = new Set(liveToasts.map((note) => note.id));
  const added = fresh.filter((note) => !known.has(note.id));
  if (!added.length) return;
  playDelivered();
  liveToasts = [...added, ...liveToasts].slice(0, 3);
  for (const note of liveToasts) {
    if (toastTimers.has(note.id)) continue;
    toastTimers.set(
      note.id,
      setTimeout(() => dismissToast(note.id), 6000),
    );
  }
  for (const [id, timer] of toastTimers) {
    if (liveToasts.some((note) => note.id === id)) continue;
    clearTimeout(timer);
    toastTimers.delete(id);
  }
  publishToasts(liveToasts);
}

function dismissToasts() {
  for (const timer of toastTimers.values()) clearTimeout(timer);
  toastTimers.clear();
  liveToasts = [];
  publishToasts(liveToasts);
}

function dismissToast(id) {
  const timer = toastTimers.get(id);
  if (timer) clearTimeout(timer);
  toastTimers.delete(id);
  if (!liveToasts.some((note) => note.id === id)) return;
  liveToasts = liveToasts.filter((note) => note.id !== id);
  publishToasts(liveToasts);
}

function playDelivered() {
  const sound = playDelivered.audio ?? new Audio("/sounds/delivered-message-sound.mp3");
  playDelivered.audio = sound;
  sound.currentTime = 0;
  sound.play().catch(() => {});
}

function readAnnounced() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function rememberAnnounced(ids) {
  let changed = false;
  for (const id of ids) {
    if (announced.has(id)) continue;
    announced.add(id);
    changed = true;
  }
  if (!changed) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...announced].slice(-200)));
  } catch {
    // The open tab still remembers these notices.
  }
}
