// L2 · Tool Descriptor + Availability (P6-2, Tool&Connector Seal §1.1·§3 흡수).
// 핵심 원리(복제 아닌 재구성):
//   - 소유(owner)≠실행(executor) 분리.
//   - availability = "왜 실행 가능/불가한지"를 담는 신호(auth|config|env|connected)의 allOf.
//   - auth ≠ approval: availability(로그인·설정·연결)와 needsApproval(행동 승인)은 다른 축이다.
//     "실행할 수 있음"과 "실행해도 됨"을 섞지 않는다(헌법 §3-3 / UX §1.1).
import { FAILURE } from '../contracts.js';

/**
 * ToolDescriptor 생성(계약 형태 고정).
 * @param {Object} d
 * @param {string} d.id
 * @param {string} d.label
 * @param {'core'|'plugin'|'channel'|'mcp'} [d.owner]
 * @param {string} [d.executor]
 * @param {Array<{kind:'auth'|'config'|'env'|'connected'}>} [d.availability]
 * @param {string} [d.toolKind]
 * @param {boolean} [d.needsApproval]
 * @param {boolean} [d.reversible]   실행을 되돌릴 수 있는가 — **도구가 아는 사실**이다. 종류로 추측하면
 *   거짓말이 된다(로컬 삭제는 휴지통으로 가서 되돌릴 수 있는데 카드가 "되돌릴 수 없음"이라 했다).
 * @param {string} [d.reversibleNote]  되돌리는 방법 한 줄(사용자 말)
 * @param {{description:string, parameters:object}} [d.schema]  모델이 **직접 고를 수 있게** 보여줄
 *   스키마. 없으면 모델에게 노출하지 않는다 — 고를 수 없는 도구를 보여주면 되는 줄 알고 약속한다.
 *   (오너 실사용: `session.search` 가 이 자리에 없어서 "그 기능은 없습니다"라고 답했다.)
 * @param {string} [d.capability]  이 도구가 **실제로 하는 일** 한 줄(사용자 말). 라벨만 주면 모델이
 *   그럴듯한 하위 기능을 지어낸다(오너 실사용: 미구현 기능 세 개를 약속했다). 구현과 함께 갱신한다.
 * @param {string} [d.operatorFact]  T5가 사용자 대신 맡을 수 있는 운영 사실. 능력 설명과 달리
 *   짧고, 현재 손을 고르는 판단 재료로만 쓴다. 경로나 순서를 처방하지 않는다.
 * @param {string} [d.readReach]  **이 손이 어디까지 볼 수 있는가**(사용자 말 한 줄).
 *   P0-b(오너 결정 2026-08-02 · 능력 유지 + 고지): 파일 손은 작업 폴더 안만 다루지만
 *   터미널 손은 이 컴퓨터에서 읽을 수 있는 자리를 본다 — 그게 있어야 "폴더를 복사해 오세요"
 *   같은 떠넘김이 안 생긴다(recovery-ladder out_of_scope 계약). 능력을 줄이지 않는 대신
 *   **그 사실을 사용자에게 숨기지 않는다.** 작업 폴더보다 넓게 읽는 손은 이 칸을 채운다.
 *   문구를 주입하는 자리가 아니라 손이 자기 사실을 선언하는 자리다(§24: 무슨 말을 할지는 모델이 정한다).
 * @returns {import('../contracts.js').ToolDescriptor}
 */
export function defineTool(d) {
  return {
    id: d.id,
    label: d.label ?? d.id,
    owner: d.owner ?? 'core',
    executor: d.executor ?? d.id,
    availability: d.availability ?? [{ kind: 'connected' }],
    toolKind: d.toolKind ?? 'read',
    needsApproval: d.needsApproval ?? false,
    reversible: d.reversible,           // 미선언은 undefined — 모르면 안전하게 "어려울 수 있다"로 말한다
    reversibleNote: d.reversibleNote,
    capability: d.capability,           // 없으면 라벨만 말한다 — 없는 설명을 지어내지 않는다
    operatorFact: d.operatorFact,
    // **무엇을 보는 손인가**(노드 ③ · 2026-08-06). `operatorFact` 는 **모델이 읽는 글**이고
    // 이 축은 **커널이 읽는 값**이다. 한 손이 막혔을 때 *"같은 것을 보는 다른 손"* 을 가리키려면
    // 비교할 수 있어야 한다 — 글로는 못 비교한다.
    // 라이브(2026-08-06): `local.file` 이 작업 폴더 밖이라 막히자 T5 가 사용자에게 awk 명령을
    // 줬다. 바로 앞 걸음에서 `local.terminal` 로 그 폴더를 실제로 봤는데도.
    보는것: d.보는것,
    readReach: d.readReach,             // 작업 폴더보다 넓게 읽는 손의 **고지 사실**(P0-b)
    // 출처가 **계약인** 손인가. 이 사실이 답 검사까지 가야 "출처 0인데 확인했다" 를 막는다.
    sourceLedgerRequired: d.sourceLedgerRequired === true,
    // P5-B-0: **어느 서비스의 손인가.** 커넥터가 도구 목록을 손으로 들면(availableTools) 손발이
    // 늘거나 줄 때 또 어긋난다 — `선언 ⊆ 손` 이 이미 목록으로 새어 본 자리다. 방향을 뒤집는다:
    // 도구가 자기 서비스를 말하고, 커넥터의 도구 목록은 **거기서 파생**된다.
    connector: d.connector,
    // 능력 설명이 "못 한다"고 말하면 **그 한계를 여기 선언한다.** 그래야 게이트가
    // "이미 다른 손이 하고 있는 일을 못 한다고 말하는가"를 검사할 수 있다(§3-④ 반대 방향).
    limits: d.limits,
    schema: d.schema,                   // 없으면 모델에게 안 보인다(고를 수 없는 것을 보여주지 않는다)
  };
}

/**
 * availability 신호를 환경 사실에 대입해 상태를 판정한다(SelfState.connectedTools.status와 정합).
 * allOf: 하나라도 불만족이면 그 신호의 상태를 돌려준다. 전부 만족이면 usable.
 * @param {import('../contracts.js').ToolDescriptor} descriptor
 * @param {{auth?:boolean, config?:boolean, env?:boolean, connected?:boolean}} facts
 * @returns {'usable'|'needs_auth'|'needs_config'|'needs_connection'|'blocked'}
 */
export function evaluateStatus(descriptor, facts = {}) {
  const has = (kind) => (descriptor.availability ?? []).some((s) => s.kind === kind);
  // 배열 순서에 의존하지 않도록 고정 우선순위(connected 먼저)로 판정한다(감사 보정).
  if (has('connected') && !facts.connected) return 'needs_connection';
  if (has('auth') && !facts.auth) return 'needs_auth';
  if (has('config') && !facts.config) return 'needs_config';
  if (has('env') && !facts.env) return 'blocked'; // env 미충족은 지금 실행 불가
  return 'usable';
}

/**
 * descriptor + 사실 → SelfState가 소비하는 connection 형태. status를 직접 실어 self-state가 그대로 쓴다.
 * @param {import('../contracts.js').ToolDescriptor} descriptor
 * @param {Object} facts
 */
export function toConnection(descriptor, facts = {}) {
  const status = evaluateStatus(descriptor, facts);
  return {
    id: descriptor.id,
    label: descriptor.label,
    connected: status !== 'needs_connection',
    executable: status === 'usable',
    status,
    // auth ≠ approval: 실행 가능해도 승인이 필요할 수 있다(별도 축).
    needsApproval: descriptor.needsApproval,
    // 권한 종류를 SelfState까지 실어 보낸다(ActionPlan·send 분리가 descriptor toolKind를 먼저 믿게).
    toolKind: descriptor.toolKind,
    // 되돌리기 가능 여부도 함께. 여기서 떨어뜨리면 승인 카드가 다시 종류로 **추측**하게 된다.
    reversible: descriptor.reversible,
    reversibleNote: descriptor.reversibleNote,
    // P5-B-0.5: **소속을 끝까지 들고 간다.** 여기서 떨어뜨리면 커넥터가 자기 도구를 못 찾아
    // 연결돼 있는데도 "연결 안 됨"으로 말한다 — 검사가 실제로 그걸 잡았다.
    connector: descriptor.connector,
    capability: descriptor.capability,  // 능력 문장도 descriptor 가 진실이다(수동 맵 금지)
    operatorFact: descriptor.operatorFact,
    // **무엇을 보는 손인가**(노드 ③) — 여기서 흘리면 커널이 옆 손을 못 고른다.
    보는것: descriptor.보는것,
    readReach: descriptor.readReach,    // 고지 사실도 손 이름과 함께 끝까지 간다(P0-b)
    sourceLedgerRequired: descriptor.sourceLedgerRequired === true,
    limits: descriptor.limits,          // 선언된 한계 — 손 이름과 함께 다녀야 하는 사실
    schema: descriptor.schema,          // 모델 노출도 같은 선언에서 나온다
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 부정 정의역 봉인 — 칸 1(성질 1 · 모델이 자기 손을 모른다)
//
// **무엇을 무나**: "부정문이 사라졌나"가 **아니다.** 그건 지우면 초록이 뜬다.
// 이 봉인이 무는 것은 **부정이 자기 손 안에 갇혀 있나**이다 —
//
//   S1 경계없는부정  평문(capability·operatorFact)은 프롬프트에서 **한 줄로 뭉쳐 실린다**
//                   (`네가 지금 바로 쓰는 손: A — …, B — …`). 거기서 동사를 부정하면
//                   그 부정이 어느 손 것인지 구조로 남지 않는다 → `limits` 레코드로 옮겨라
//   S2 표식         모든 `limits` 레코드는 **자기가 거는 동사**를 밝힌다. 동사를 안 밝힌
//                   레코드가 어떤 손의 동사를 말하면 빨강(표식없음).
//                   밝힌 동사가 그 손(또는 `coveredBy` 가 가리키는 손)의 enum 에 없으면
//                   빨강(거짓한계 — **없는 한계를 지어낸 것**)
//   S3 국소성       그 손이 **안 가진 동사**를 부정하면 빨강. 다른 손 것을 말해야 하면
//                   `coveredBy` 로 **그 동사를 가진 손을 가리켜야** 한다(부정이 아니라 이관)
//   S4 능력대칭     enum 에 있는 동사는 전부 **그 손 이름과 함께 모델에게 실려야** 한다.
//                   ← **지우고 초록 띄우기를 막는 조항이다.** 부정을 지워 S1~S3 를 통과해도
//                     긍정 진술이 없으면 S4 가 빨갛다. 손을 빼면 말도 빠지고(칸 실행 규격 8),
//                     동사를 더하면 말이 따라 는다
//
// **하드코딩 0**: 기대값(어떤 손이 어떤 동사를 갖는가·그 동사를 뭐라 부르는가)은 전부
// **등록부에서 파생**한다. 여기 적힌 목록은 기대값이 아니라 **탐지기**다(부정 어휘 하나).
//
// **모델 답을 판정하지 않는다.** 재는 것은 **우리가 조립해 보낸 프롬프트**다 — 우리가 쓴 글이라
// 결정적이고, 본문 정규식으로 모델을 오판한 그 방식(감사 교정치)과 방향이 반대다.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 부정 **탐지기**. 기대값이 아니다 — 무엇이 한계 진술인지 찾기만 한다.
 * 여기에 걸린 절이 곧 위반은 아니다(위반은 아래 네 조항이 정한다).
 */
export const 부정어휘 = Object.freeze([
  '하지 않', '지 않는다', '지 않고', '지 않으', '지 못한다', '지 못하',
  '못 한다', '못한다', '못 하', '못 읽', '못 넣', '못 누르', '못 본다',
  '안 한다', '안 하', '않는다', '없고', '없다', '아니다', '금지', '제외',
]);

/** 손이 가진 동사 목록 — **등록부가 진실**이다(`action` enum 이 정의역). */
export function 동사정의역(descriptor) {
  const e = descriptor?.schema?.parameters?.properties?.action?.enum;
  return Array.isArray(e) && e.length ? e : null;
}

/** 문장을 절로 가른다. 한 절 안에 동사와 부정이 함께 있을 때만 "그 동사를 부정했다"고 본다. */
const 절나누기 = (s) => String(s ?? '').split(/[.。\n·—]|(?<=다)\s+/).map((x) => x.trim()).filter(Boolean);

const 부정있나 = (절) => 부정어휘.some((n) => 절.includes(n));

/**
 * 동사 → 그 동사를 가리키는 **사용자 말** 색인. 말은 손이 `행위` 로 선언한다 —
 * 커널이 지어내면 그게 또 하나의 진실이 된다(1축).
 * @returns {{토큰소유:Map<string, Array<{id:string,동사:string}>>, 손:Array}}
 */
export function 행위색인(descriptors = []) {
  const 토큰소유 = new Map();
  const 손 = [];
  for (const d of descriptors) {
    const enumv = 동사정의역(d);
    if (!enumv) continue;
    const 표 = d.행위 ?? null;
    손.push({ id: d.id, label: d.label ?? d.id, 동사: enumv, 행위: 표 });
    for (const v of enumv) {
      const 말 = 표?.[v];
      if (!말) continue;
      const 토큰 = [말.말, ...(말.별칭 ?? [])].filter((t) => typeof t === 'string' && t.trim());
      for (const t of 토큰) {
        if (!토큰소유.has(t)) 토큰소유.set(t, []);
        토큰소유.get(t).push({ id: d.id, 동사: v });
      }
    }
  }
  return { 토큰소유, 손 };
}

/** 그 절이 건드린 (토큰 → 소유 손) 목록. */
function 절이건드린동사(절, 토큰소유) {
  const out = [];
  for (const [tok, owners] of 토큰소유) if (절.includes(tok)) out.push({ 토큰: tok, 소유: owners });
  return out;
}

/**
 * **봉인 본체.** 등록부와 **실제로 조립돼 나간 것**을 함께 받아 위반을 낸다.
 * 등록부에만 있고 모델에게 안 간 글은 세지 않는다 — 부품 검사가 아니라 관통 검사다(C4).
 *
 * @param {Object} p
 * @param {Array} p.descriptors  손 선언(등록부)
 * @param {string} p.systemPrompt  `buildModelMessages(tc).system` — 실제로 간 시스템 프롬프트
 * @param {Array} [p.tools]  모델에게 실제로 노출한 도구 스키마 배열
 * @returns {Array<{조항:string, 손:string, 자리:string, 절?:string, 동사?:string, 말?:string, 사유:string}>}
 */
export function 부정정의역위반({ descriptors = [], systemPrompt = '', tools = [] }) {
  const { 토큰소유, 손 } = 행위색인(descriptors);
  const 도구글 = JSON.stringify(tools ?? []);
  const 실렸나 = (t) => typeof t === 'string' && t.trim()
    && (systemPrompt.includes(t.trim()) || 도구글.includes(t.trim()));
  const byId = new Map(descriptors.map((d) => [d.id, d]));
  const 위반 = [];

  // ── S0 · **못 잰 것을 0 으로 적지 않는다** ────────────────────────────────
  // 동사의 사용자 말(`행위`)이 없으면 토큰 색인이 비고, 그러면 S1·S2·S3 가 **아무것도 못 찾는다.**
  // 그 침묵을 초록으로 읽으면 그 순간 이 봉인이 거짓말을 시작한다 —
  // 「계측 불가 · 사유」로 적는다. 이 줄이 남아 있는 한 아래 조항들은 **판정이 아니다.**
  for (const h of 손) {
    const 갔나 = systemPrompt.includes(h.label) || 도구글.includes(`"${h.id}"`);
    if (!갔나) continue;
    const 빠진동사 = h.행위 ? h.동사.filter((v) => !h.행위[v]?.말) : h.동사;
    if (!빠진동사.length) continue;
    위반.push({ 조항: 'S0 계측불가', 손: h.id, 자리: '행위', 동사: 빠진동사.join(','),
      사유: h.행위
        ? 'enum 에 있는데 행위 표에 사용자 말이 없다 — 그 동사에 걸린 부정을 찾을 수가 없다'
        : `enum 동사 ${h.동사.length}개의 사용자 말이 선언되지 않았다 — 이 손에 대해 S1·S2·S3 는 판정이 아니라 침묵이다` });
  }

  for (const d of descriptors) {
    // 평문 — 프롬프트에서 **다른 손과 한 줄로 뭉친다.** 그래서 여기의 부정은 경계가 없다.
    const 평문 = { capability: d.capability, operatorFact: d.operatorFact };
    // 스키마 — 함수 이름 안에 실려 나가므로 **구조로 이미 그 손 것이다.** 자기 동사 부정은 봐준다.
    const 스키마 = {};
    if (d.schema?.description) 스키마['schema.description'] = d.schema.description;
    for (const [k, v] of Object.entries(d.schema?.parameters?.properties ?? {})) {
      if (typeof v?.description === 'string') 스키마[`schema.${k}`] = v.description;
    }

    for (const [자리, 글] of Object.entries({ ...평문, ...스키마 })) {
      if (!실렸나(글)) continue;                       // 모델에게 안 간 글은 이 봉인의 대상이 아니다
      const 평문인가 = Object.hasOwn(평문, 자리);
      for (const 절 of 절나누기(글)) {
        if (!부정있나(절)) continue;
        const 건드린것 = 절이건드린동사(절, 토큰소유);
        if (!건드린것.length) continue;                // 동사를 안 건드린 부정은 정의역 문제가 아니다
        const 남의것 = 건드린것.filter((h) => !h.소유.some((o) => o.id === d.id));
        if (남의것.length) {
          위반.push({ 조항: 'S3 국소성', 손: d.id, 자리, 절,
            동사: 남의것.map((h) => h.소유.map((o) => `${o.id}:${o.동사}`).join('/')).join(' '),
            사유: '이 손이 안 가진 동사를 부정한다 — 부정 말고 `limits.coveredBy` 로 **그 동사를 가진 손을 가리켜라**' });
        } else if (평문인가) {
          위반.push({ 조항: 'S1 경계없는부정', 손: d.id, 자리, 절,
            동사: 건드린것.map((h) => h.소유.map((o) => `${o.id}:${o.동사}`).join('/')).join(' '),
            사유: '평문은 프롬프트에서 다른 손과 한 줄로 뭉친다 — 이 부정을 `limits` 레코드(동사 표식)로 옮겨라' });
        }
      }
    }

    // S2 · 구조 레코드의 표식
    for (const lim of d.limits ?? []) {
      const 대상 = lim.coveredBy ? byId.get(lim.coveredBy) : d;
      if (lim.coveredBy && !대상) {
        위반.push({ 조항: 'S2 표식', 손: d.id, 자리: 'limits', 절: lim.says,
          사유: `coveredBy "${lim.coveredBy}" 라는 손이 등록부에 없다` });
        continue;
      }
      const 대상enum = 동사정의역(대상);
      if (lim.동사) {
        if (!대상enum || !대상enum.includes(lim.동사)) {
          위반.push({ 조항: 'S2 거짓한계', 손: d.id, 자리: 'limits', 절: lim.says, 동사: lim.동사,
            사유: `"${lim.동사}" 는 ${대상?.id ?? '?'} 의 enum 에 없다 — 없는 동사에 한계를 걸었다` });
        }
        continue;
      }
      const 건드린것 = 절이건드린동사(String(lim.says ?? ''), 토큰소유);
      if (건드린것.length) {
        위반.push({ 조항: 'S2 표식없음', 손: d.id, 자리: 'limits', 절: lim.says,
          동사: 건드린것.map((h) => h.소유.map((o) => `${o.id}:${o.동사}`).join('/')).join(' '),
          사유: '동사를 말하면서 어느 동사인지 표식이 없다 — `동사` 를 적어라' });
      }
    }
  }

  // S4 · 능력 대칭 — **지우고 초록 띄우기 차단**. 등록된 동사는 손 이름과 함께 실려야 한다.
  const 줄 = systemPrompt.split('\n');
  for (const h of 손) {
    const d = byId.get(h.id);
    // 이번 판에 그 손이 모델에게 갔는지부터 본다(관측 안 됨 ≠ 부재).
    const 갔나 = systemPrompt.includes(h.label) || 도구글.includes(`"${h.id}"`);
    if (!갔나 || !h.행위) continue;                    // 미선언은 위에서 S0 로 이미 적었다
    const 그손줄 = 줄.filter((l) => l.includes(h.label));
    for (const v of h.동사) {
      const 말 = h.행위[v]?.말;
      if (!말) continue;
      if (!그손줄.some((l) => l.includes(말))) {
        위반.push({ 조항: 'S4 말이안실림', 손: h.id, 자리: '시스템 프롬프트', 동사: v, 말,
          사유: `"${말}" 이 "${h.label}" 이름과 같은 줄로 모델에게 가지 않았다 — 모델은 이 동사를 모른다`,
          ...(d ? {} : {}) });
      }
    }
  }
  return 위반;
}

/**
 * "등록된 동사를 **그 손 밖의** 어떤 진술도 부정하지 않는다" 한 문장만 따로 묻는다.
 * 칸 1 이 반드시 함께 물기로 한 조항이다(예: `desktop.act:type`).
 */
export function 손밖에서부정된동사(위반, 손id, 동사) {
  return 위반.filter((v) => v.조항 === 'S3 국소성' && v.손 !== 손id && String(v.동사 ?? '').includes(`${손id}:${동사}`));
}

/**
 * 실패 종류를 재시도 성격으로 분류한다(Hermes MCP permanent/transient 흡수).
 * 복구 계층이 "다시 시도할지 / 접어둘지"를 판단하는 힌트. 사용자면 아님.
 * @param {import('../contracts.js').FailureState} failureState
 * @returns {'none'|'permanent'|'transient'}
 */
export function classifyRetry(failureState) {
  switch (failureState) {
    case FAILURE.NONE:
      return 'none';
    case FAILURE.BLOCKED:
    case FAILURE.CANCELLED:
      return 'permanent'; // 차단·취소는 재시도로 풀리지 않는다
    case FAILURE.FAILED:
    case FAILURE.TIMEOUT:
      return 'transient'; // 실패·타임아웃은 backoff 재시도 여지
    default:
      return 'none';
  }
}
