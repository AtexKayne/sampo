import "dotenv/config";

function readSecureCookies() {
  if (process.env.COOKIE_SECURE === "0") return false;
  if (process.env.COOKIE_SECURE === "1") return true;
  return process.env.NODE_ENV === "production";
}

const port = Number(process.env.API_PORT || 3000);
const jwtAccessSecret = process.env.JWT_ACCESS_SECRET || "";

export const config = {
  port: Number.isInteger(port) && port > 0 ? port : 3000,
  appOrigin: process.env.APP_ORIGIN || "http://127.0.0.1:8080",
  databaseUrl: process.env.DATABASE_URL || "",
  jwtAccessSecret: jwtAccessSecret.length >= 32 ? jwtAccessSecret : "",
  seedAdminLogin: process.env.SEED_ADMIN_LOGIN || "",
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD || "",
  secureCookies: readSecureCookies(),
  vkClientId: process.env.VK_CLIENT_ID || "",
  vkRedirectUri: process.env.VK_REDIRECT_URI || "",
  vkServiceKey: process.env.VK_SERVICE_KEY || "",
  vapidPublicKey: (process.env.VAPID_PUBLIC_KEY || "").trim(),
  vapidPrivateKey: (process.env.VAPID_PRIVATE_KEY || "").trim(),
  vapidSubject: (process.env.VAPID_SUBJECT || "mailto:admin@example.com").trim(),
};
