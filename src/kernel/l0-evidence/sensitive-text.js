// Durable memory must not become a second credential store. This is a narrow
// storage safety net, not a language-understanding or policy classifier.

const KNOWN_SECRET_PREFIX = /\b(?:sk-(?:proj-|ant-)?|gh[opusr]_|xox[baprs]-|AKIA|ASIA|ya29\.|Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/i;
const PRIVATE_KEY = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/i;
const ENGLISH_SECRET_LABEL = String.raw`(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|password|passwd)`;
const KOREAN_SECRET_LABEL = String.raw`(?:비밀번호|토큰|인증키|비밀키)`;
const ASSIGNED_SECRET = new RegExp(
  String.raw`(?:\b${ENGLISH_SECRET_LABEL}\b|(?<![A-Za-z0-9_가-힣])${KOREAN_SECRET_LABEL})\s*(?:=|:)\s*["']?([^\s"'\`,;]+)`,
  'i',
);
const QUOTED_SECRET = new RegExp(
  String.raw`(?:\b${ENGLISH_SECRET_LABEL}\b|(?<![A-Za-z0-9_가-힣])${KOREAN_SECRET_LABEL})\s*(?:=|:|은|는)\s*["']([^"']+)["']`,
  'i',
);
const KOREAN_PARTICLE_CREDENTIAL = /(?<![A-Za-z0-9_가-힣])(?:비밀번호|토큰|인증키|비밀키)\s*(?:은|는)\s*(?=[^\s"'`,;]*[A-Za-z])(?=[^\s"'`,;]*\d)[^\s"'`,;]+/;
const KOREAN_NUMERIC_CREDENTIAL = /(?<![A-Za-z0-9_가-힣])(?:비밀번호|토큰|인증키|비밀키)\s*(?:은|는)\s*\d{4,}\s*(?:$|[.,;])/;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/;
const URL_CREDENTIAL = /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i;
const KOREAN_RESIDENT_ID = /\b\d{6}-?[1-4]\d{6}\b/;
const LONG_MACHINE_TOKEN = /[A-Za-z0-9_-]{28,}/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalized(value) {
  return String(value ?? '').normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '');
}

/**
 * Detects values that should never be copied into durable memory statements.
 * It intentionally ignores ordinary mentions such as "비밀번호는 길게 정한다"
 * unless a value-shaped token is present.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function containsSensitiveValue(value) {
  const text = normalized(value);
  if (!text) return false;
  if (KNOWN_SECRET_PREFIX.test(text) || PRIVATE_KEY.test(text)
    || ASSIGNED_SECRET.test(text) || QUOTED_SECRET.test(text)
    || KOREAN_PARTICLE_CREDENTIAL.test(text) || KOREAN_NUMERIC_CREDENTIAL.test(text)
    || JWT.test(text)
    || URL_CREDENTIAL.test(text) || KOREAN_RESIDENT_ID.test(text)) return true;

  return [...text.matchAll(LONG_MACHINE_TOKEN)].some(([token]) =>
    !UUID.test(token)
    && /[A-Z]/.test(token) && /[a-z]/.test(token) && /\d/.test(token));
}
