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
// 카드번호는 **십진 수사**다 — 숫자와 구분자(공백·하이픈)로만 이루어진 한 덩어리다.
// 경계를 "앞뒤가 숫자만 아니면 된다"로 두면 **글자와 숫자가 섞인 기계 지문 한가운데의
// 숫자 토막**이 카드번호로 잡힌다. 그래서 경계를 **영숫자 아님**으로 세운다.
//   예: sha256 `2759a99b360e101eec[0938111019692]bdaaacc1b3…` — 대괄호 안 13자리가
//   Luhn 을 통과한다(정말 통과한다). 앞이 `c`, 뒤가 `b` 라 옛 경계는 이걸 카드로 읽었고,
//   그 지문을 담은 자동화 job 이 화면에서 통째로 사라졌다(자세한 사고 기록은 hasPaymentCard).
// 이 경계는 **판정을 느슨하게 하지 않는다** — 진짜 카드번호는 라벨·공백·구두점·한글 뒤에
// 오지 영문자에 붙어 오지 않는다. 아래 UUID 제거는 그대로 남긴다(하이픈을 품은 UUID 는
// 이 경계로도 13자리 이상 숫자열을 만들 수 있다).
const PAYMENT_CARD_CANDIDATE = /(?:^|[^0-9A-Za-z])((?:\d[ -]?){12,18}\d)(?=$|[^0-9A-Za-z])/g;
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

/**
 * **기계 지문을 카드번호로 읽던 자리**(2026-08-12 · 본선 간헐 빨강의 원인).
 *
 * 증상: `npm test` 전수를 돌리면 3~6회 중 1회꼴로 서로 다른 파일이 빨개졌다. 단독으로도,
 * 좁은 묶음으로도, 부하를 걸어도 재현되지 않았다 — 부하가 아니라 **난수**가 방아쇠였기 때문이다.
 *
 * 원인: sha256 지문(`settlementRef`·`settlementDigest`·`sourceSetRef`·`revisionRef` …)은
 * 매번 다른 16진 문자열이다. 그 안에 **13~19자리 연속 숫자열**이 생기고 그것이 Luhn 을
 * 통과할 확률이 지문 하나당 대략 1/500 이다. 검사 한 판이 지문 수천 개를 만드니
 * 전수 회차의 20~25% 에서 최소 하나가 걸렸다. 걸리면 `containsSensitiveValue` 가 참이 되고,
 * `canonicalDurableEvidence` 가 그 지문을 가림표로 바꾼다. 그러면
 *   · `automationEntryVisible` 이 거짓 → **승인된 자동화가 화면 목록에서 통째로 사라진다**
 *   · 완료 결산이 `sourceSetRef` 대조에서 미끄러진다 → **끝난 일이 안 끝난 것으로 남는다**
 * 검사가 아니라 **제품이 무작위로 깨지고 있었다.** 검사는 그걸 정직하게 비추고 있었다.
 *
 * 같은 계열의 앞선 사고가 UUID 였고(아래 `UUID_IN_TEXT` 제거), 그때는 UUID 만 빼서 막았다.
 * 한 종류씩 빼는 방식이라 지문이 새 모양으로 오면 또 뚫린다 — 이번엔 **경계 자체**를 고쳐
 * "영숫자에 파묻힌 숫자 토막은 수사가 아니다"를 한 줄로 세운다(PAYMENT_CARD_CANDIDATE).
 */
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
/** durable 구조 안에서 민감 문자열 전체를 대체하는 한 표식. */
export const SENSITIVE_VALUE_PLACEHOLDER = '[민감정보 — 원문은 저장하지 않음]';

function opaqueDurablePath(path) {
  const joined = path.join('.');
  if (['workRef', 'completionContractRef', 'receiptRef', 'sourceWorkRef', 'sourceSetRef'].includes(joined)) return true;
  if (['actualCall.providerCallId', 'actualCall.callRef', 'result.digest',
    'result.sourceRevisionRef', 'result.sourceSetRef', 'result.memberRef'].includes(joined)) return true;
  if (['sourceBinding.workRef', 'sourceBinding.sourceSetRef',
    'completionContract.sourceBinding.workRef', 'completionContract.sourceBinding.sourceSetRef',
    'verification.sourceWorkRef', 'verification.sourceSetRef'].includes(joined)) return true;
  if (/^(?:turnRef|sourceTurnRef|completionContract\.sourceTurnRef)\./.test(joined)) return true;
  if (/^(?:deliverableRefs\.\d+|deliverables\.\d+\.id|completionContract\.deliverables\.\d+\.id)$/.test(joined)) return true;
  return false;
}

/** 서명·저장할 JSON 현실을 비변이 복제하며, 정확한 기계 신분 경로 외 민감 문자열을 가린다. */
export function canonicalDurableEvidence(value, path = [], stack = new WeakSet()) {
  if (typeof value === 'string') {
    return !opaqueDurablePath(path) && containsSensitiveValue(value) ? SENSITIVE_VALUE_PLACEHOLDER : value;
  }
  if (!value || typeof value !== 'object') return value;
  if (stack.has(value)) throw new TypeError('durable evidence는 순환 구조일 수 없다');
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item, index) => canonicalDurableEvidence(item, [...path, String(index)], stack));
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      canonicalDurableEvidence(item, [...path, key], stack),
    ]));
  } finally {
    stack.delete(value);
  }
}

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
