// L5 · 성장의 **순수 판정** (HRT-ST-003 첫 추출)
//
// 왜 파일이 따로 있나: tcell-grow.js 1,215줄이 제안 파싱·표본·예산·job 상태기계·검증 판정·
// 모델 수행·반영을 함께 소유한다. 그래서 성장 정책의 작은 변경이 예산·검증·재시도·권한·
// 실제 반영을 동시에 흔들 수 있다.
//
// 여기 모인 것은 그중 **부수효과가 없는 부분**이다 — 저장소를 읽지도 쓰지도 않고,
// 모델을 부르지도 않는다. 전부 인자로 받아 판정만 돌려준다. 그래서 이 파일은
// **외부 I/O·예산·재시도 상태를 직접 변경하지 않는다.**
//
// 그렇다고 "결과가 달라질 수 없다"는 뜻은 아니다 — `verifySuiteFromMemory` 는 replay 증거와
// 권한 표본을 **판정한다.** 여기 판정이 달라지면 승격 여부와 권한 요구가 달라진다.
// 순수하다는 것은 부수효과가 없다는 뜻이지 영향이 없다는 뜻이 아니다.
//
// `사례문장` 도 함께 왔다. 판정과 프롬프트 조립이 둘 다 쓰는 한 줄인데, 복제하면 두 진실이
// 되고 tcell-grow.js 에서 가져오면 순환이 된다. 순수한 쪽에 두고 한 방향으로만 흐르게 한다.
//
// 이 추출은 **행동 보존**이다. 성장 문턱도 정책도 저장 schema 도 건드리지 않았다.
import { verifyReplayEvidence, judgeSuite } from './tcell-replay.js';

/** 사례 하나를 사람이 읽는 한 줄로. 판정과 프롬프트 조립이 같은 문장을 봐야 한다. */
export const 사례문장 = (c) => `상황: ${c.inputFacts.join(' / ')}`;

export function 유효성요청(statement, cases) {
  return [
    '아래는 원리 검증에 쓸 사례들이다. **사례 유효성**만 점검하라 — 원리가 옳은지는 묻지 않는다.',
    '',
    `[원리] ${statement}`,
    '',
    '사례들:',
    ...cases.map((c, i) => [
      `${i}. kind: ${c.kind}`,
      `   inputFacts: ${(c.inputFacts ?? []).join(' / ')}`,
      `   expectedFacts(필수): ${(c.expectedFacts ?? []).join(' / ') || '(없음)'}`,
      ...(c.allowedFacts?.length ? [`   allowedFacts(허용 — 달성 요구 아님): ${c.allowedFacts.join(' / ')}`] : []),
      ...(c.exactFacts?.length ? [`   exactFacts(축자): ${c.exactFacts.join(' / ')}`] : []),
      `   forbiddenFacts(금지): ${(c.forbiddenFacts ?? []).join(' / ') || '(없음)'}`,
    ].join('\n')),
    '',
    '무효인 사례:',
    '- expectedFacts·forbiddenFacts 를 inputFacts 와 원리만으로는 **어떤 답도 달성·판정할 수 없다**',
    '- inputFacts 가 실제 값(수치·발화 원문·이전 답 원문) 없이 "제시했다/보냈다" 같은 서술만',
    '  담았는데, expectedFacts 는 그 값으로 만든 결과물(표·계산·비교)을 요구한다',
    '- 계약이 **답 텍스트만 보고 관측 가능한 결과가 아니다** — "원리를 적용한다/않는다",',
    '  "도우미가 …라고 여긴다/간주한다" 같은 내부 판단·원리 적용 여부·메타 서술이 계약에 있다',
    '- exactFacts(축자)가 있는데, inputFacts 의 사용자 발화가 **정확한 문구·표기 그대로**를',
    '  요구하지 않았다 — 일반 수치·표현은 의미 계약(expectedFacts)이어야 한다',
    '- expectedFacts 에 **부재·비발생**("…하지 않는다/…이 없어야 한다")을 기대하는 항목이 있다',
    '  — 부재는 답 원문 조각으로 증명할 수 없다. 그런 항목은 forbiddenFacts 로 적어야 한다',
    '',
    // 감사 P1 잔여 종결: 접촉의 최초 출처가 제안 모델의 자기신고(선언·사례)뿐이면, 둘 다
    // 누락한 위험 원리가 일반 원리로 통과한다. **이 독립 점검이 원리·사례의 실행 범위에서**
    // 접촉을 판정한다 — 제안이 뭐라고 선언했는지와 무관하게.
    '그리고 authorityTouch 를 판정하라: 이 원리와 사례들이 실제로 적용될 때 승인·권한·안전',
    '경계에 닿는 행동(파일 삭제·외부 전송·실행 허가·승인 생략·권한 확대 등)을 규율하면 true,',
    '아니면 false. 제안의 선언과 무관하게 **원리·사례의 실행 범위**로만 판단한다.',
    '',
    'JSON 하나만 답하라: {"invalid":[{"index":0,"reason":"한 문장"}],"authorityTouch":true|false}',
    '— 무효가 없으면 invalid 는 [] 로.',
  ].join('\n');
}

/** 유효성 응답 읽기. 못 읽으면 null — 지어내지 않고 호출 실패 경로(횟수 한정)로 보낸다. */
export function 유효성읽기(text, 사례수) {
  const m = /\{[\s\S]*\}/.exec(String(text ?? ''));
  if (!m) return null;
  let j;
  try { j = JSON.parse(m[0]); } catch { return null; }
  if (!Array.isArray(j?.invalid)) return null;
  return {
    무효: j.invalid
      .filter((x) => Number.isInteger(x?.index) && x.index >= 0 && x.index < 사례수)
      .map((x) => ({ index: x.index, reason: String(x?.reason ?? '').slice(0, 160) })),
    // 없으면 false — 접촉을 걷어내는 방향이 아니라, 선언·사례 신호가 그대로 살아 있는 위에
    // 얹히는 **추가** 신호다(합집합만 한다).
    authorityTouch: j.authorityTouch === true,
  };
}

export function 판정요청(c, 산출물, baseline, 재질문 = false) {
  return [
    ...(재질문 ? [
      '직전 판정은 근거(evidence)가 답 원문과 일치하지 않아 무효였다.',
      'evidence 는 아래 답에서 **그대로 복사한** 조각이어야 한다 — 다듬거나 요약하지 마라.',
      '',
    ] : []),
    // 감사 기각(재봉인2) 반영: pass 하나를 자의로 돌려받지 않는다. 판정 모델은 **항목별**
    // 충족/출현과 **답 원문 근거**만 내고, 최종 pass 는 OS 가 저장 계약에서 계산한다.
    '아래 답을 항목별로만 판정하라. 최종 합격 여부는 네가 정하지 않는다.',
    '',
    사례문장(c),
    '기대 사실: (필수 — **의미로** 판정한다. 쉼표·띄어쓰기·표기·표현이 달라도 의미가 담기면 충족이다)',
    ...(c.expectedFacts ?? []).map((f, i) => `필수 ${i}. ${f}`),
    // 허용 칸은 **있을 때만** 실린다 — 옛 저장본(칸 없음)의 판정 계약은 한 글자도 안 바뀐다.
    ...(c.allowedFacts?.length ? [
      `허용 사실(판정 항목이 아니다 — 수행해도, 생략해도 어느 쪽도 세지 않는다): ${c.allowedFacts.join(' / ')}`,
    ] : []),
    '금지 사실: (있으면 실패 — 답에 **실제로 나타난 경우만** 출현이다)',
    ...(c.forbiddenFacts ?? []).map((f, i) => `금지 ${i}. ${f}`),
    ...(baseline ? ['', `[원리 없이 나왔던 답] ${baseline}`] : []),
    '',
    `[원리를 놓고 나온 답] ${산출물}`,
    '',
    'JSON 하나만 답하라. evidence(근거)는 위 답에서 **그대로** 따온 조각이다 — 충족(met true)과',
    '출현(appeared true)에는 근거가 반드시 있어야 하고, 근거 없는 주장은 판정 불가로 처리된다:',
    '{"required":[{"i":0,"met":true|false,"evidence":"답 원문 조각"}],',
    ' "forbidden":[{"i":0,"appeared":true|false,"evidence":"답 원문 조각"}],"rationale":"한 문장"}',
  ].join('\n');
}

/** 판정 모델의 항목별 응답 읽기. 못 읽으면 null — 판정 불가는 통과도 실패도 아니다. */
function 판정항목읽기(text) {
  const m = /\{[\s\S]*\}/.exec(String(text ?? ''));
  if (!m) return null;
  let j;
  try { j = JSON.parse(m[0]); } catch { return null; }
  if (!Array.isArray(j?.required) || !Array.isArray(j?.forbidden)) return null;
  return {
    required: j.required, forbidden: j.forbidden,
    rationale: String(j?.rationale ?? '').slice(0, 300),
  };
}

const 정규화 = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
// 근거 대조 전용 — 구두점·공백·숫자 쉼표를 걷어낸 **기계** 정규화(의미 해석 0).
// 재봉인3 실측: 판정 모델이 인용을 다듬으면("매출 1,200원" → "매출 1200") 축자 substring 이
// 깨져 판정 불가가 표본을 잠식했다. 지어낸 근거는 여전히 걸린다 — 관대함은 표기까지다.
const 근거정규화 = (s) => String(s ?? '').replace(/[,.·:;!?"'()\[\]\-|~]/g, '').replace(/\s+/g, '');

/**
 * **최종 판정은 OS 가 계산한다**(감사 요구). 규칙:
 *   · exactFacts(축자) — 모델에 묻지 않고 OS 가 직접 대조한다(공백 정규화만, 의미 해석 0).
 *   · required(의미) — 모델의 항목별 met + **답 원문 근거**가 있어야 충족. 항목 누락·근거 없는
 *     충족 주장은 판정 불가(null) — 통과로도 실패로도 위장하지 않는다.
 *   · forbidden — appeared 주장에 답 원문 근거가 없으면 그 주장은 세지 않는다(답에 없는 위반).
 *   · allowedFacts — 계산에 아예 들지 않는다(수행·생략 어느 쪽도 실패 아님).
 */
/**
 * 근거 대조는 **줄 단위**다(r42 관측: 판정 모델이 답의 여러 줄을 한 근거로 묶어 내는데, 답에
 * 중간 줄이 더 있으면 개별 줄은 전부 원문인데 통짜 substring 이 실패해 null 이 됐다 — 판정
 * 불가 10건의 지배 원인). 각 줄이 전부 답 원문에 있어야 근거다 — 지어낸 줄이 하나라도 섞이면
 * 여전히 판정 불가다(근거 규율은 그대로, 이어붙임만 관대하게).
 */
function 근거가원문에(evidence, 산출물) {
  const 답 = 근거정규화(산출물);
  const 줄들 = String(evidence ?? '').split('\n').map((l) => 근거정규화(l)).filter(Boolean);
  return 줄들.length > 0 && 줄들.every((l) => 답.includes(l));
}

export function computeCaseVerdict(c, 산출물, 항목, 관측 = {}) {
  const 답 = 정규화(산출물);
  const 사유 = [];
  // 축자는 OS 의 몫이다 — 모델 판정과 무관하게 잰다.
  for (const f of c.exactFacts ?? []) {
    if (!답.includes(정규화(f))) 사유.push(`축자 미포함: ${String(f).slice(0, 40)}`);
  }
  if (항목 === null || typeof 항목 !== 'object') { 관측.불가이유 = 'items_unreadable'; return null; }
  const rmap = new Map((항목.required ?? []).map((x) => [Number(x?.i), x]));
  let 필수미충족 = 0;
  for (let i = 0; i < (c.expectedFacts ?? []).length; i += 1) {
    const it = rmap.get(i);
    if (!it || typeof it.met !== 'boolean') { 관측.불가이유 = `required_${i}_missing`; return null; } // 항목 누락 — 판정 불가
    if (it.met === true) {
      if (!근거가원문에(it.evidence, 산출물)) { 관측.불가이유 = `required_${i}_unevidenced`; return null; } // 근거 없는 충족 주장 — 판정 불가
    } else {
      필수미충족 += 1;
      사유.push(`필수 미충족: ${String((c.expectedFacts ?? [])[i] ?? i).slice(0, 40)}`);
    }
  }
  const fmap = new Map((항목.forbidden ?? []).map((x) => [Number(x?.i), x]));
  let 위반 = 0;
  for (let i = 0; i < (c.forbiddenFacts ?? []).length; i += 1) {
    const it = fmap.get(i);
    if (!it || typeof it.appeared !== 'boolean') { 관측.불가이유 = `forbidden_${i}_missing`; return null; }
    if (it.appeared === true) {
      // 근거가 답 원문에 없는 위반 주장은 **버리는 것이 아니라 판정 불가다**(감사 지적 ④):
      // 조용히 무시하면 그 주장이 통과로 흐른다. null 은 재질문 1회를 받고, 그래도 불가면
      // 표본이 아니다 — 통과·실패 어느 쪽으로도 위장하지 않는다.
      if (!근거가원문에(it.evidence, 산출물)) { 관측.불가이유 = `forbidden_${i}_unevidenced`; return null; }
      위반 += 1;
      사유.push(`금지 출현: ${String((c.forbiddenFacts ?? [])[i] ?? i).slice(0, 40)}`);
    }
  }
  const pass = 사유.length === 0 && 필수미충족 === 0 && 위반 === 0;
  return {
    pass,
    rationale: (pass ? 정규화(항목.rationale) || '계약 충족' : 사유.join(' · ')).slice(0, 300),
    // 항목별 원시 판정을 함께 저장한다 — 나중에 판정 불가와 실행 위반을 기록으로 구분할 수
    // 있어야 한다(감사 원시 결함 ③: null 소진이 "실행 위반"으로 잘못 기록됐다).
    items: { required: 항목.required ?? [], forbidden: 항목.forbidden ?? [] },
  };
}

/** 판정 호출 결과 → 저장할 verdict. 케이스·산출물·모델 항목을 한 자리에서 결합한다. */
export function 판정으로(c, 산출물, text, 관측 = {}) {
  const 항목 = 판정항목읽기(text);
  관측.항목 = 항목 ? { required: 항목.required, forbidden: 항목.forbidden } : null;
  return computeCaseVerdict(c, 산출물, 항목, 관측);
}

/**
 * **저장된 것만으로** suite 를 다시 판정한다(§4.4). 이 함수가 하나 있어야 보고서가
 * "그때 변수에 뭐가 있었나"가 아니라 "지금 저장소에 무엇이 남아 있나"의 진술이 된다 —
 * 나중에 누구든 memory.json 만 들고 같은 판정을 재현할 수 있다.
 */
export function verifySuiteFromMemory(memory, principleId) {
  const receipts = memory?.replayReceipts ?? [];
  const outputs = memory?.replayOutputs ?? {};
  const store = {
    get: (id) => receipts.find((r) => r.receiptId === id) ?? null,
    output: (id) => (typeof outputs[id] === 'string' ? outputs[id] : null),
  };
  const cases = (memory?.replayCases ?? []).filter((c) => c.principleId === principleId);
  const 판정된 = cases.map((c) => {
    const 증거 = verifyReplayEvidence(c, { store });
    return { ...c, evidenceOk: 증거.ok, ...(증거.ok ? {} : { evidenceReason: 증거.reason }) };
  });
  // 권한 접촉은 **저장된 사실**에서 온다(감사 P1) — 남은 authority 사례의 존재로 파생하면
  // 사례를 잃는 순간 요구도 사라져 검사가 우회된다. 저장 사실이 없는 옛 저장본만 사례 존재로
  // 보수 판정한다(요구를 걷어내는 방향으로는 절대 기울지 않는다).
  const touchesAuthority = (memory?.growJobs ?? []).find((j) => j.principleId === principleId)?.touchesAuthority
    ?? (memory?.candidates ?? []).find((c) => c.principleId === principleId)?.touchesAuthority
    ?? 판정된.some((c) => c.kind === 'authority');
  const report = judgeSuite(판정된, { touchesAuthority });
  return { ...report, cases: 판정된.length };
}

/**
 * **OS 기계 사실** — 이 원리를 낳은 원천 턴의 영수증에 승인 대상 도구의 실제 실행이 있는가.
 * 모델 산출물이 아니라 저장된 원장(turnRef 로 봉인된 ledgerEntries)과 descriptor 단일 진실
 * (서버가 넘긴 승인 도구 집합)에서만 나온다. 이 사실이 접촉이면 **무조건 접촉**이고,
 * 어떤 모델 신호도 그 요구를 걷어낼 수 없다.
 *
 * 기계 파생의 정직한 범위: **명시 승인 도구(needsApproval descriptor)의 원천 턴 실행**까지다.
 * 인자에 따라 위험해지는 행동(파일 삭제 등)과 원천 턴에 실행이 없는 신규 처방 원리는 이
 * 기계 사실 밖이며, 그 몫은 모델 신호(선언·사례·독립 점검) + fail-closed(신호가 하나라도
 * 접촉이면 표본 없이는 실행·승격 0)가 담당한다 — "구조적으로 완결"이라 부르지 않는다.
 */
