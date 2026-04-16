const rawBase = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
export const apiBase = rawBase.replace(/\/$/, '');

async function parseBody(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/**
 * @param {string} path
 * @param {RequestInit & { body?: object }} [options]
 */
export async function api(path, options = {}) {
  const url = `${apiBase}${path.startsWith('/') ? path : `/${path}`}`;
  const { body, headers: userHeaders, ...rest } = options;
  const headers = { ...userHeaders };
  let outBody = body;

  if (body != null && typeof body === 'object' && !(body instanceof FormData)) {
    outBody = JSON.stringify(body);
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }
  }

  const res = await fetch(url, { ...rest, headers, body: outBody });
  const data = await parseBody(res);
  if (!res.ok) {
    const msg =
      (data && typeof data === 'object' && 'error' in data && data.error) ||
      res.statusText ||
      `Request failed (${res.status})`;
    throw new Error(String(msg));
  }
  return data;
}
