import { api } from "../api/client.js";

const ASKED_KEY = "sampo-push-asked";
let asked = false;
let saving = null;

export function phonePushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function askPushOnce() {
  if (asked || !phonePushSupported()) return;
  asked = true;
  if (Notification.permission === "granted") {
    saveBrowserSubscription().catch(() => {});
    return;
  }
  if (Notification.permission !== "default" || sessionStorage.getItem(ASKED_KEY) === "1") return;
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
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "default") sessionStorage.setItem(ASKED_KEY, "1");
  if (permission !== "granted") return permission;
  await saveBrowserSubscription();
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

function saveBrowserSubscription() {
  if (!saving) {
    saving = saveOnce().finally(() => {
      saving = null;
    });
  }
  return saving;
}

async function saveOnce() {
  const registration = await registrationReady();
  const { publicKey } = await api("/api/push/public-key");
  const applicationServerKey = decodeKey(publicKey);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameKey(subscription.options?.applicationServerKey, applicationServerKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  }
  await api("/api/me/push-subscriptions", { method: "POST", body: subscription.toJSON() });
}

function registrationReady() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Уведомления на этом устройстве недоступны")), 5000);
    navigator.serviceWorker.ready.then(
      (registration) => {
        clearTimeout(timer);
        resolve(registration);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
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
