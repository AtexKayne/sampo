import { api } from "../api/client.js";

const ASKED_KEY = "sampo-push-asked";
let asked = false;
let saving = null;
let preparedKey = null;
let preparing = null;
let preparedRegistration = null;

export function phonePushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function iosNeedsHomeScreen() {
  if (!isIos()) return false;
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  return !standalone;
}

export function preparePush() {
  if (!phonePushSupported()) return Promise.resolve(false);
  if (preparedKey) return Promise.resolve(true);
  if (!preparing) {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready.then((registration) => {
        preparedRegistration = registration;
      }).catch(() => {});
    }
    preparing = api("/api/push/public-key")
      .then(({ publicKey }) => {
        preparedKey = decodeKey(publicKey);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        preparing = null;
      });
  }
  return preparing;
}

export function askPushOnce() {
  if (asked || !phonePushSupported() || iosNeedsHomeScreen()) return;
  asked = true;
  preparePush();
  if (Notification.permission === "granted") {
    saveBrowserSubscription().catch(() => {});
    return;
  }
  if (isIos() || Notification.permission !== "default" || sessionStorage.getItem(ASKED_KEY) === "1") return;
  sessionStorage.setItem(ASKED_KEY, "1");
  Notification.requestPermission()
    .then((permission) => {
      if (permission === "granted") return saveBrowserSubscription();
    })
    .catch(() => {});
}

export async function readPhonePush() {
  if (!phonePushSupported()) return "unsupported";
  if (Notification.permission !== "granted") return Notification.permission;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? "subscribed" : "granted";
}

export async function enablePhonePush() {
  if (!phonePushSupported()) return "unsupported";
  if (iosNeedsHomeScreen()) {
    const error = new Error("Откройте «Сампо» с экрана «Домой» и включите уведомления там. В Safari они не доходят.");
    error.state = "needs-install";
    throw error;
  }
  if (!preparedKey) {
    const ready = await preparePush();
    if (!ready) throw new Error("Не удалось подготовить уведомления. Нажмите ещё раз");
  }
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "default") sessionStorage.setItem(ASKED_KEY, "1");
  if (permission !== "granted") return permission;
  await saveBrowserSubscription({ confirm: true, key: preparedKey });
  return "subscribed";
}

export async function disablePhonePush() {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return Notification.permission === "granted" ? "granted" : "default";
  await api("/api/me/push-subscriptions", { method: "DELETE", body: { endpoint: subscription.endpoint } });
  await subscription.unsubscribe();
  return "granted";
}

function saveBrowserSubscription(options = {}) {
  if (options.confirm) return saveOnce(options);
  if (!saving) {
    saving = saveOnce(options).finally(() => {
      saving = null;
    });
  }
  return saving;
}

async function saveOnce({ confirm = false, key = preparedKey } = {}) {
  const registration = preparedRegistration || (await navigator.serviceWorker.ready);
  const applicationServerKey = key || decodeKey((await api("/api/push/public-key")).publicKey);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription?.options?.applicationServerKey && !sameKey(subscription.options.applicationServerKey, applicationServerKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  }
  const saved = await api("/api/me/push-subscriptions", {
    method: "POST",
    body: { ...subscription.toJSON(), confirm },
  });
  if (confirm && saved?.delivered === false) {
    const error = new Error(saved.error || "Телефон не принял уведомление");
    error.state = "subscribed";
    throw error;
  }
}

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function decodeKey(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function sameKey(current, next) {
  if (!current) return false;
  const bytes = new Uint8Array(current);
  if (bytes.length !== next.length) return false;
  return bytes.every((byte, index) => byte === next[index]);
}
