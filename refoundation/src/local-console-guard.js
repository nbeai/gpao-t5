import { timingSafeEqual } from 'node:crypto';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const PUBLIC_PATHS = new Set(['/', '/index.html', '/health']);

export const CONSOLE_COOKIE_NAME = 't5_console';

function hostAndPort(value) {
  const input = String(value ?? '').trim();
  if (!input) return null;
  const bracketed = input.match(/^\[([^\]]+)\](?::(\d+))?$/u);
  if (bracketed) {
    return { host: bracketed[1].toLowerCase(), port: bracketed[2] ? Number(bracketed[2]) : null };
  }
  const parts = input.split(':');
  if (parts.length > 2) return null;
  const port = parts[1] ? Number(parts[1]) : null;
  if (parts[1] && (!Number.isInteger(port) || port < 1 || port > 65_535)) return null;
  return { host: parts[0].toLowerCase(), port };
}

function cookieValue(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

function sameSecret(left, right) {
  const a = Buffer.from(String(left ?? ''), 'utf8');
  const b = Buffer.from(String(right ?? ''), 'utf8');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export function consoleCookieHeader(token) {
  if (!String(token ?? '')) throw new TypeError('local console token is required');
  return `${CONSOLE_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`;
}

export function makeLocalConsoleGuard({ token, port } = {}) {
  if (!String(token ?? '')) throw new TypeError('local console token is required');
  if (typeof port !== 'function') throw new TypeError('local console port reader is required');

  return {
    cookieHeader: consoleCookieHeader(token),
    inspect(req, pathname) {
      const host = hostAndPort(req.headers?.host);
      if (!host || !LOOPBACK_HOSTS.has(host.host)) return { reason: 'host' };

      const currentPort = Number(port());
      if (!Number.isInteger(currentPort) || currentPort < 1 || currentPort > 65_535) {
        return { reason: 'not_listening' };
      }
      if (host.port != null && host.port !== currentPort) return { reason: 'host_port' };

      const origin = req.headers?.origin;
      if (origin && origin !== 'null') {
        let parsed;
        try { parsed = new URL(String(origin)); } catch { return { reason: 'origin' }; }
        const originPort = parsed.port ? Number(parsed.port) : parsed.protocol === 'http:' ? 80 : 443;
        if (parsed.protocol !== 'http:' || !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())
          || originPort !== currentPort) return { reason: 'origin' };
      }

      const bootstrapShell = req.method === 'GET'
        && (PUBLIC_PATHS.has(pathname) || pathname === '/settings' || /^\/settings\/[a-z0-9-]+$/u.test(pathname));
      if (bootstrapShell) return null;
      if (!sameSecret(cookieValue(req.headers?.cookie, CONSOLE_COOKIE_NAME), token)) {
        return { reason: 'token' };
      }
      return null;
    },
  };
}
