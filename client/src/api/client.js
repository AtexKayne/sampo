let accessToken = null;
let refreshPromise = null;

export function setAccessToken(token) {
  accessToken = token;
}

async function raw(path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  return fetch(path, {
    method: options.method || "GET",
    headers,
    credentials: "include",
    cache: "no-store",
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

function readError(data, fallback) {
  const error = new Error(data?.error?.message || fallback);
  error.code = data?.error?.code || "UNKNOWN";
  return error;
}

export function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = raw("/api/auth/refresh", { method: "POST" })
      .then(async (response) => {
        if (!response.ok) {
          accessToken = null;
          return null;
        }
        const data = await response.json();
        accessToken = data.accessToken;
        return data.user;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export async function api(path, options = {}) {
  let response;
  try {
    response = await raw(path, options);
  } catch {
    const error = new Error("Нет сети");
    error.code = "NETWORK";
    throw error;
  }

  if (response.status === 401 && !options.retried && !options.skipRefresh) {
    const user = await refreshSession();
    if (user) return api(path, { ...options, retried: true });
  }

  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw readError(data, "Не удалось выполнить запрос");
  return data;
}

export async function login(body) {
  const data = await api("/api/auth/login", { method: "POST", body, skipRefresh: true });
  setAccessToken(data.accessToken);
  return data.user;
}

export async function switchAccount() {
  const data = await api("/api/auth/switch", { method: "POST" });
  setAccessToken(data.accessToken);
  return data.user;
}

export async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST", skipRefresh: true });
  } finally {
    accessToken = null;
  }
}
