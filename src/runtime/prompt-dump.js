// L4 · **S0 계측 — 모델이 실제로 받은 것을 그대로 남긴다.**
//
// 왜 있나(2026-08-05): 오너 라이브에서 "안녕" 한 마디에 능력 목록이 나왔고, 나는 원인을 **세 번**
// 잘못 짚었다. 소스를 읽을수록 확신만 늘었다. 조립된 프롬프트를 못 봤기 때문이다.
// 이 파일은 고치는 도구가 아니라 **보는 도구**다.
//
// 계약 넷:
//   ① 기본은 꺼짐. 환경(`GPAO_T5_PROMPT_DUMP`)이 있을 때만 쓴다.
//   ② 모델에 들어간 것을 그대로 남긴다 — system·user·history·도구 이름·크기.
//   ③ **관측이 대상을 바꾸지 않는다.** 여기서 messages 를 만지지 않는다(읽기만 한다).
//   ④ 비밀은 원문으로 디스크에 남지 않는다. 덤프는 파일로 남고 파일은 다시 읽힌다.
//
// 크기(`systemChars`·`toolSchemaChars`)를 함께 남기는 이유 — 불변식 B(좁은 허리)는
// "코어 도구 하나가 매 API 콜 비용"이라는 사실 위에 선다. 단계마다 **수치로** 대조하려면
// 재는 자리가 상설이어야 한다.
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const 지문 = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 12);

/**
 * **토큰 어림** — 자수와 단위가 다르다. 비교군의 임계가 토큰이라 자로 재면 대조가 안 된다.
 *
 * 헤르메스 `tools/tool_search.py` 는 `chars/4` 한 규칙으로 어림하고 주석에 그 이유를 적었다:
 * *"자릿수만 맞으면 된다 — 켤지 말지를 가르는 문턱이지 청구서가 아니다."* 맞는 판단이라 따른다.
 *
 * **다만 그 규칙은 영어 기준이다.** 우리 스키마는 설명이 한글이고, 한글은 토크나이저에서
 * 훨씬 조밀하다(대략 1~1.5자에 1토큰). 영어 규칙을 그대로 쓰면 **한글 몫을 3~4배 과소평가**한다.
 * 그래서 두 몫을 갈라 센다 — 한글은 보수적으로 1자 1토큰, 나머지는 4자 1토큰.
 *
 * **어림이다. 청구서가 아니다.** 토크나이저를 들이지 않는 이유는 런타임 의존성 0 이 게이트이고,
 * 이 숫자의 쓸모는 "임계를 넘었나"뿐이기 때문이다. 정확한 값이 필요해지면 그때 재는 자리를 바꾼다.
 */
export function 토큰어림(text) {
  const s = String(text ?? '');
  // 한글 음절·자모 + 한중일 문자. 이 범위 밖은 영어 규칙으로 센다.
  const 조밀 = (s.match(/[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF\u3040-\u30FF\u4E00-\u9FFF]/g) ?? []).length;
  return Math.ceil(조밀 + (s.length - 조밀) / 4);
}

/** 덤프 자리. 환경이 없으면 `null` — 없는 것이 기본이다. */
export function promptDumpDir(env = process.env) {
  const raw = typeof env?.GPAO_T5_PROMPT_DUMP === 'string' ? env.GPAO_T5_PROMPT_DUMP.trim() : '';
  return raw || null;
}

// **비밀은 목록으로 짐작하지 않는다**(절대원칙 8 · §4-6). 이름을 열거하면 새 이름이 반드시 샌다.
// 대신 **모양**으로 본다: 비밀은 사람 말과 달리 "긴 무작위 문자열"이다.
//   · 널리 쓰이는 접두(sk-·ghp_·xoxb- 등)는 접두를 몰라도 걸리도록 길이·엔트로피로 잡는다.
//   · 사람 말·경로·URL 을 안 지우려고 **공백 없는 20자 이상 + 숫자와 영문이 섞인 토막**만 본다.
const 비밀모양 = /(?<![\w/.-])(?=[\w-]{20,})(?=[^\s]*\d)(?=[^\s]*[A-Za-z])[\w-]{20,}(?![\w/.-])/g;

/** 한글·경로는 남기고 무작위 토막만 가린다. 지운 자국을 남긴다 — 뭘 지웠는지 모르면 못 믿는다. */
export function 비밀가림(text) {
  if (typeof text !== 'string') return text;
  return text.replace(비밀모양, (m) => `${m.slice(0, 4)}***가림:${m.length}자***`);
}

const 가려서 = (v) => {
  if (typeof v === 'string') return 비밀가림(v);
  if (Array.isArray(v)) return v.map(가려서);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, 가려서(x)]));
  return v;
};

let 일련 = 0;

/**
 * **모델이 낸 것**을 같은 자리에 남긴다. 입력만 보면 "왜 저 답이 나갔는지"를 못 잇는다.
 *
 * S2 실측(2026-08-05)에서 필요해졌다: 차단된 턴의 최종 답이 런타임 문장이었는데,
 * 모델이 침묵한 것인지 / 모델이 거짓 성공을 말해 P0 게이트가 바꾼 것인지 **구분할 수 없었다.**
 * 둘은 정반대 판정이다(전자는 결함, 후자는 게이트가 옳게 문 것).
 * @param {{text?: string, toolCalls?: {name?: string}[], meta?: Object}} 출력
 */
export async function dumpModelOutput(출력, env = process.env) {
  const dir = promptDumpDir(env);
  if (!dir) return null;
  일련 += 1;
  const 파일 = join(dir, `${String(일련).padStart(4, '0')}-out-${Date.now()}.json`);
  await mkdir(dir, { recursive: true });
  await writeFile(파일, `${JSON.stringify({
    at: new Date().toISOString(),
    kind: 'output',
    ...(출력?.meta ? { meta: 가려서(출력.meta) } : {}),
    text: 비밀가림(String(출력?.text ?? '')),
    textChars: String(출력?.text ?? '').length,
    toolCalls: (출력?.toolCalls ?? []).map((c) => c?.name).filter(Boolean),
  }, null, 2)}\n`, 'utf8');
  return 파일;
}

/**
 * **이 턴에 무엇을 줬고 무엇을 왜 걸렀는가** — 손 제시 계측(오너 지시 2026-08-05).
 *
 * S7 은 손 집합 자체를 상황에서 계산하는 칸이라, 틀려도 화면에 안 나타난다.
 * *"모델이 요즘 좀 이상한데"* 로만 보인다 — S6 은 216칸 표가 잡았지만 여기는 잡을 표가 없다.
 * **안 준 손은 흔적이 없다**는 것이 그 이유다. 그래서 거른 사실 자체를 기록으로 만든다.
 *
 * 원장에 안 넣는 이유: 원장은 **영수증 전용**이다(`확인된사실` 이 영수증 칸을 읽는다).
 * 실행이 아닌 것을 거기 넣으면 사용자가 보는 "확인한 것 / 못 한 것"이 오염된다.
 * S0 덤프가 이미 "모델이 실제로 받은 것"을 남기는 자리라 여기가 맞다.
 *
 * @param {{전부:number, 준수:number, 거른수:number, 준것:string[],
 *          거른것:Array<{id:string,이유:string}>, 이유별:Object}} 기록
 */
export async function dump손제시(기록, env = process.env) {
  const dir = promptDumpDir(env);
  if (!dir) return null;
  일련 += 1;
  const 파일 = join(dir, `${String(일련).padStart(4, '0')}-손제시-${Date.now()}.json`);
  await mkdir(dir, { recursive: true });
  // 손 이름과 이유만 남긴다 — 인자도 결과도 담지 않으므로 가릴 것이 없다.
  await writeFile(파일, `${JSON.stringify({ at: new Date().toISOString(), kind: 'tool_offer', ...기록 }, null, 2)}\n`, 'utf8');
  return 파일;
}

/**
 * 모델 입력 한 건을 남긴다. 꺼져 있으면 `null` 을 돌려주고 아무것도 하지 않는다.
 * @param {{messages: any, tools?: {name?: string}[], meta?: Object}} 입력
 * @param {Object} [env]
 * @returns {Promise<string|null>} 쓴 파일 경로
 */
export async function dumpModelInput(입력, env = process.env) {
  const dir = promptDumpDir(env);
  if (!dir) return null;
  const m = 입력?.messages ?? {};
  const tools = Array.isArray(입력?.tools) ? 입력.tools : [];
  // 도구 스키마 전체 크기 — 매 콜에 실려 나가는 몫이다(불변식 B 를 재는 자리).
  let toolSchemaChars = 0;
  let toolSchemaTokens = 0;
  try {
    const 직렬 = JSON.stringify(tools);
    toolSchemaChars = 직렬.length;
    // **토큰으로도 남긴다.** 비교군의 지연 공개 임계가 "컨텍스트의 10%"이고 단위가 토큰이다.
    // 자로만 재면 **언제 그 문턱을 넘는지 못 본다** — MCP·플러그인이 붙기 시작하는 순간을
    // 놓치지 않으려면 재는 자리를 미리 바꿔 둬야 한다(오너 지시 2026-08-05).
    toolSchemaTokens = 토큰어림(직렬);
  } catch { toolSchemaChars = -1; toolSchemaTokens = -1; }
  const system = typeof m.system === 'string' ? m.system : Array.isArray(m.system) ? m.system.join('\n') : '';
  // **캐시 접두가 살아 있는지 재는 자리.** 적중 여부는 공급자 거동이라 우리가 통제하지 못한다 —
  // 대신 우리가 통제하는 불변식을 잰다: 안정 접두와 **도구 목록의 앞부분이 안 바뀌는가**.
  // 대화 중 커넥터를 붙이면 손이 늘어난다(`admitHttpTools`). 뒤에만 붙으면(append-only)
  // 앞 직렬화가 그대로라 접두가 산다. 중간 삽입·재정렬하면 그 순간 접두가 죽는다.
  const stable = typeof m.systemStable === 'string' ? m.systemStable : null;
  const 이름들 = tools.map((t) => t?.name).filter(Boolean);
  const 기록 = {
    at: new Date().toISOString(),
    ...(입력?.meta ? { meta: 가려서(입력.meta) } : {}),
    system: 비밀가림(system),
    user: 가려서(m.user),
    ...(m.history?.length ? { history: 가려서(m.history) } : {}),
    ...(m.exchange?.length ? { exchange: 가려서(m.exchange) } : {}),
    toolNames: 이름들,
    // 수치는 가리기 **전** 원문 기준이다 — 가림이 크기를 왜곡하면 대조가 무너진다.
    systemChars: system.length,
    systemTokens: 토큰어림(system),
    toolCount: tools.length,
    toolSchemaChars,
    toolSchemaTokens,
    ...(stable === null ? {} : { systemStableChars: stable.length, systemStableSha: 지문(stable) }),
    // 도구 목록을 **누적 지문**으로 남긴다. 앞에서부터 n 개의 지문이 이전 턴과 같으면
    // 그 만큼은 접두가 살아 있다 — 어디서 깨졌는지 눈으로 짚을 수 있다.
    toolPrefixSha: 이름들.map((_, i) => 지문(JSON.stringify(tools.slice(0, i + 1)))),
  };
  일련 += 1;
  const 파일 = join(dir, `${String(일련).padStart(4, '0')}-${Date.now()}.json`);
  await mkdir(dir, { recursive: true });
  await writeFile(파일, `${JSON.stringify(기록, null, 2)}\n`, 'utf8');
  return 파일;
}
