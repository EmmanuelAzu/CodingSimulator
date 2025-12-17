// app/lib/limiter.js
const buckets = new Map();

/**
 * Very simple in-memory rate limiter.
 * NOTE: In serverless / multi-instance, this won't be globally consistent.
 * It's still great for dev + basic protection.
 */
export function rateLimit({ key, limit, windowMs }) {
  const now = Date.now();
  const bucket = buckets.get(key) || { count: 0, resetAt: now + windowMs };

  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }

  bucket.count += 1;
  buckets.set(key, bucket);

  const remaining = Math.max(0, limit - bucket.count);
  const allowed = bucket.count <= limit;

  return {
    allowed,
    remaining,
    resetAt: bucket.resetAt,
  };
}

export function getClientIp(req) {
  // Best-effort: works in many setups; behind proxies may vary.
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  const xr = req.headers.get("x-real-ip");
  if (xr) return xr.trim();
  return "unknown";
}

export function validateDocsUrl(docsUrl) {
  if (typeof docsUrl !== "string") return { ok: false, error: "docsUrl must be a string" };
  const trimmed = docsUrl.trim();
  if (!trimmed) return { ok: false, error: "docsUrl is required" };
  if (trimmed.length > 600) return { ok: false, error: "docsUrl is too long" };

  let u;
  try {
    u = new URL(trimmed);
  } catch {
    return { ok: false, error: "docsUrl must be a valid URL" };
  }

  if (!["http:", "https:"].includes(u.protocol)) {
    return { ok: false, error: "docsUrl must start with http:// or https://" };
  }

  return { ok: true, value: trimmed };
}
