// L1 · send류 문장 정밀 분리(P6-7). 보낼 내용(message)과 대상(target)을 지시 문장과 나눈다.
// 사용자 문장 전체를 그대로 보내지 않는다. 애매하면 실행하지 않고 확인하도록 clarifyReason을 준다.
// 특정 대화 하드코딩이 아니라 일반 패턴(슬랙/텔레그램/메일 공통). 모델이 뒷단에서 더 정교화할 자리.

const PLATFORM = /^(?:슬랙|slack|텔레그램|telegram|메일|이메일|email|문자|sms)$/i;
// 플랫폼 접두 + 조사(슬랙에/텔레그램으로/메일로 …).
const PLATFORM_LEAD = /^\s*(?:슬랙|slack|텔레그램|telegram|메일|이메일|email|문자|sms)\S*\s*(?:으로|로|에게|께|에)?\s*/i;
// 말미 전송 동사(올려줘/보내줘/게시해/전송 …).
const SEND_TAIL = /\s*(?:좀\s*)?(?:전송|발송|올려|게시|보내|전달|써)\S*\s*$/;
// 인용 어미(…이라고/…다고/…하고).
const QUOTATIVE_TAIL = /\s*(?:이?라고|다고|자고|냐고|하고)\s*$/;
const QUOTE = /["'“”「『]([^"'“”」』]+)["'“”」』]/;
const RESIDUAL_PARTICLE = /^\s*(?:으로|로|에게|한테|께|에)\s*/;
// 말미에 남은 플랫폼 단어(…회의록 공유 메일 → …회의록 공유).
const TRAILING_PLATFORM = /\s*(?:슬랙|slack|텔레그램|telegram|메일|이메일|email|문자|sms)\s*$/i;

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function extractTarget(raw) {
  const email = /([\w.+-]+@[\w-]+\.[\w.-]+)/.exec(raw);
  if (email) return email[1];
  const chan = /(#[^\s#,]+)/.exec(raw);
  if (chan) return chan[1].replace(/(?:에서|으로|로|에)$/, ''); // 채널명 뒤 조사 제거
  const named = /([가-힣A-Za-z][가-힣A-Za-z0-9_]*)\s*(?:에게|한테|께)/.exec(raw);
  if (named && !PLATFORM.test(named[1])) return named[1];
  return null;
}

function stripLead(s, target) {
  let out = String(s).replace(PLATFORM_LEAD, '');
  if (target) {
    out = out.replace(new RegExp('\\s*' + escapeRe(target) + '\\s*(?:에게|한테|께|으로|로|에)?\\s*'), ' ');
  }
  out = out.replace(RESIDUAL_PARTICLE, '');
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * @param {string} text   사용자 원문
 * @param {string} toolId 승인 대상 send 도구(slack.post/telegram.send/mail.send)
 * @returns {{toolId:string, target:string|null, message:string|null, ambiguous:boolean, clarifyReason:'no_message'|'no_target'|null}}
 */
export function parseSend(text, toolId) {
  const raw = String(text ?? '').trim();
  const target = extractTarget(raw);

  let message = null;
  const q = QUOTE.exec(raw);
  if (q) {
    message = q[1].trim();
  } else {
    let s = raw.replace(SEND_TAIL, '');   // 말미 전송 동사 제거
    s = stripLead(s, target);             // 플랫폼·대상 접두 제거
    s = s.replace(TRAILING_PLATFORM, ''); // 말미 잔여 플랫폼 단어 제거
    s = s.replace(QUOTATIVE_TAIL, '');     // 인용 어미 제거
    s = s.replace(/\s+/g, ' ').trim();
    message = s || null;
  }
  if (message) message = message.trim() || null;

  // 대상 없으면(연결/승인 전 확인), 내용 없으면(무엇을) 실행하지 않고 확인한다.
  const clarifyReason = !message ? 'no_message' : !target ? 'no_target' : null;
  return { toolId, target, message, ambiguous: Boolean(clarifyReason), clarifyReason };
}
