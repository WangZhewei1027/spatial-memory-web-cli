export interface Cookie { name: string; value: string; path: string; secure: boolean; expires?: number }

export function mergeCookies(cookies: Cookie[], headers: Headers, now = Date.now()): Cookie[] {
  const jar = new Map(cookies.map((cookie) => [`${cookie.name}:${cookie.path}`, cookie]));
  for (const header of headers.getSetCookie()) {
    const [pair, ...parts] = header.split(";");
    const equal = pair.indexOf("=");
    if (equal < 1) continue;
    const cookie: Cookie = { name: pair.slice(0, equal).trim(), value: pair.slice(equal + 1), path: "/", secure: false };
    let maxAge: number | undefined;
    for (const part of parts) {
      const [rawKey, ...rest] = part.trim().split("=");
      const value = rest.join("=");
      switch (rawKey.toLowerCase()) {
        case "path": cookie.path = value.startsWith("/") ? value : "/"; break;
        case "secure": cookie.secure = true; break;
        case "max-age": if (/^-?\d+$/.test(value)) maxAge = Number(value); break;
        case "expires": if (Number.isFinite(Date.parse(value))) cookie.expires = Date.parse(value); break;
      }
    }
    if (maxAge !== undefined) cookie.expires = now + maxAge * 1000;
    const key = `${cookie.name}:${cookie.path}`;
    if (!cookie.value || (cookie.expires !== undefined && cookie.expires <= now)) jar.delete(key);
    else jar.set(key, cookie);
  }
  return [...jar.values()].filter((cookie) => cookie.expires === undefined || cookie.expires > now);
}

export function cookieHeader(cookies: Cookie[], url: URL): string {
  return cookies.filter((cookie) =>
    (!cookie.secure || url.protocol === "https:") &&
    (cookie.expires === undefined || cookie.expires > Date.now()) &&
    (url.pathname === cookie.path || url.pathname.startsWith(cookie.path.endsWith("/") ? cookie.path : cookie.path + "/")),
  ).sort((a, b) => b.path.length - a.path.length).map(({ name, value }) => `${name}=${value}`).join("; ");
}
