const hits = new Map<string, number[]>();

const configs = [
  { pattern: /^\/api\/agents\//, windowMs: 15_000, max: 10 },
  { pattern: /^\/api\/protocol\//, windowMs: 60_000, max: 30 },
  { pattern: /^\/api\/notifications\//, windowMs: 30_000, max: 20 },
  { pattern: /.*/, windowMs: 60_000, max: 60 },
];

function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "127.0.0.1"
  );
}

function getConfig(pathname: string) {
  return configs.find((c) => c.pattern.test(pathname))!;
}

export function checkRateLimit(
  key: string,
  config: { maxRequests: number; windowMs: number }
) {
  const now = Date.now();
  const windowStart = now - config.windowMs;

  let timestamps = hits.get(key);
  if (!timestamps) {
    timestamps = [];
    hits.set(key, timestamps);
  }

  const valid = timestamps.filter((t) => t > windowStart);
  hits.set(key, valid);

  if (valid.length >= config.maxRequests) {
    const retryAfterSeconds = Math.ceil(
      (valid[0] + config.windowMs - now) / 1000
    );
    return { allowed: false, retryAfterSeconds };
  }

  valid.push(now);
  return { allowed: true, retryAfterSeconds: 0 };
}

export function rateLimitExceeded(request: Request) {
  const ip = getClientIp(request);
  const pathname = new URL(request.url).pathname;
  const config = getConfig(pathname);
  const key = `${ip}:${configs.indexOf(config)}`;

  const { allowed, retryAfterSeconds } = checkRateLimit(key, {
    maxRequests: config.max,
    windowMs: config.windowMs,
  });

  return { exceeded: !allowed, retryAfterSeconds };
}

export function _reset() {
  hits.clear();
}

// Periodic cleanup to prevent memory leaks
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const cutoff = Date.now() - 60_000;
    for (const [key, timestamps] of hits) {
      const valid = timestamps.filter((t) => t > cutoff);
      if (valid.length === 0) hits.delete(key);
      else hits.set(key, valid);
    }
  }, 60_000).unref?.();
}
