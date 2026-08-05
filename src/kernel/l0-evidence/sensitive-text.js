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
const KOREAN_BARE_CREDENTIAL = /(?<![A-Za-z0-9_가-힣])(?:비밀번호|토큰|인증키|비밀키)\s+[^\s"'`,;]+\s*(?:$|[.,;])/;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/;
const URL_CREDENTIAL = /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i;
const KOREAN_RESIDENT_ID = /\b\d{6}-?[1-4]\d{6}\b/;
const PAYMENT_CARD_CANDIDATE = /(?:^|[^\d])((?:\d[ -]?){12,18}\d)(?=$|[^\d])/g;
const LONG_MACHINE_TOKEN = /[A-Za-z0-9_-]{28,}/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_IN_TEXT = /(?<![0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![0-9a-f])/gi;

function normalized(value) {
  return String(value ?? '').normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '');
}

function luhn(value) {
  const digits = String(value).replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (double) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

function hasPaymentCard(value) {
  PAYMENT_CARD_CANDIDATE.lastIndex = 0;
  const withoutMachineIds = String(value).replace(UUID_IN_TEXT, ' ');
  return [...withoutMachineIds.matchAll(PAYMENT_CARD_CANDIDATE)].some((m) => luhn(m[1]));
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
    || KOREAN_BARE_CREDENTIAL.test(text) || hasPaymentCard(text)
    || JWT.test(text)
    || URL_CREDENTIAL.test(text) || KOREAN_RESIDENT_ID.test(text)) return true;

  return [...text.matchAll(LONG_MACHINE_TOKEN)].some(([token]) =>
    !UUID.test(token)
    && /[A-Z]/.test(token) && /[a-z]/.test(token) && /\d/.test(token));
}

/** 가린 자리에 남기는 표. **무엇이 가려졌는지는 사실이므로 숨기지 않는다.** */
export const MASK = '[가림]';

/**
 * **비밀만 가리고 나머지는 남긴다.**
 *
 * 왜 필요한가(라이브 2026-08-05 · F-32): `지금 화면에 뭐 떠 있어?` 에 답이 **통째로**
 * 갈아치워졌다. 창 26개 중 2개가 걸렸는데 **둘 다 우리 문서 파일명**이었다
 * (`GPAO-T5-...-2026-07-27-ko.md` — 대·소문자·숫자가 다 있어 `LONG_MACHINE_TOKEN` 에 걸린다).
 * **사용자는 화면 정보를 하나도 못 받았다.** 정보 대신 안내가 나간 자리다(§0).
 *
 * 고치는 길이 둘이었다:
 *   ✗ 패턴을 좁힌다 — 문구 목록 늘리기의 사촌이고, 좁히면 진짜 비밀이 새는 쪽으로 기운다
 *   ✓ **범위를 좁힌다** — 걸린 토막만 가린다. **비밀은 여전히 안 나간다**
 *
 * 오늘 웹·화면에서 여러 번 세운 계약과 같다 — **하나가 막혔다고 전부를 버리지 않는다.**
 *
 * **판정 함수는 안 건드린다.** `containsSensitiveValue` 가 무는 것은 그대로 물고,
 * 여기는 **그 무는 자리를 지우기만** 한다. 그래서 이 함수가 틀려도 판정은 안 느슨해진다 —
 * 부르는 쪽이 가린 뒤 다시 판정해서, 여전히 걸리면 통째로 버린다(안전 쪽 실패).
 *
 * @param {unknown} value
 * @returns {string}
 */
export function maskSensitiveValues(value) {
  let text = normalized(value);
  if (!text) return '';

  // 값이 붙은 자리(라벨=값 · 라벨은 "값")는 **매치 전체**를 가린다 — 라벨만 남기면
  // 값이 어디까지인지 다시 재야 하고, 그 계산이 틀리면 반쯤 남는다.
  for (const 패턴 of [KNOWN_SECRET_PREFIX, PRIVATE_KEY, ASSIGNED_SECRET, QUOTED_SECRET,
    KOREAN_PARTICLE_CREDENTIAL, KOREAN_NUMERIC_CREDENTIAL, KOREAN_BARE_CREDENTIAL,
    JWT, URL_CREDENTIAL, KOREAN_RESIDENT_ID]) {
    text = text.replace(new RegExp(패턴.source, 패턴.flags.includes('g') ? 패턴.flags : `${패턴.flags}g`), MASK);
  }

  // 결제 카드: 루온을 통과한 후보만 가린다(전화번호·주문번호까지 지우지 않는다).
  text = text.replace(PAYMENT_CARD_CANDIDATE, (전체, 숫자) => (luhn(숫자) ? 전체.replace(숫자, MASK) : 전체));

  // 긴 기계 토막: **판정과 같은 조건일 때만** 가린다(UUID 제외 · 대·소문자·숫자 모두).
  text = text.replace(LONG_MACHINE_TOKEN, (토막) => (
    !UUID.test(토막) && /[A-Z]/.test(토막) && /[a-z]/.test(토막) && /\d/.test(토막) ? MASK : 토막));

  return text;
}

/**
 * 외부로 나가는 실행 인자에서 사람이 쓴 본문만 검사한다. 대상 ID·채널 이름까지 통째로
 * 문자열화하면 평범한 기계 식별자가 비밀로 오인되므로, 전송 내용에 해당하는 값만 좁게 본다.
 */
export function containsSensitivePayload(args) {
  if (!args || typeof args !== 'object') return false;
  const fields = ['text', 'message', 'body', 'content', 'caption', 'subject'];
  return fields.some((key) => {
    const value = args[key];
    if (typeof value === 'string') return containsSensitiveValue(value);
    if (Array.isArray(value)) return value.some((item) => containsSensitiveValue(item));
    return false;
  });
}
