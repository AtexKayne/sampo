export function createLoginLimiter({ limit = 10, windowMs = 15 * 60 * 1000, now = () => Date.now() } = {}) {
  const buckets = new Map();

  function count(key) {
    const entry = buckets.get(key);
    if (!entry || entry.resetAt <= now()) return 0;
    return entry.count;
  }

  function bump(key) {
    const current = buckets.get(key);
    const timestamp = now();
    if (!current || current.resetAt <= timestamp) {
      buckets.set(key, { count: 1, resetAt: timestamp + windowMs });
      return;
    }
    current.count += 1;
  }

  return {
    tooMany(login, ip) {
      return count(`login:${login}`) >= limit || count(`ip:${ip}`) >= limit;
    },
    recordFailure(login, ip) {
      bump(`login:${login}`);
      bump(`ip:${ip}`);
    },
  };
}
