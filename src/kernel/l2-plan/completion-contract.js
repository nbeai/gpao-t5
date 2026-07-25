// L2 · CompletionContract (P6-13). 사용자가 "언제 끝난 걸로 볼지"를 자연어로 말하면 검증 기준으로 잡는다.
// 핵심 원칙(헌법·CLAUDE.md): **완료 = "생성했다"가 아니라 검증된 실제 동작.** 검증을 통과해야만 완료다.
//   실패하면 무엇이 안 맞는지 정직하게 남기고, 애매하면(중단 기준) 멈추고 묻는다(Hermes 흡수, 복제 아님).
//   검증 결과는 VerificationReceipt로 남긴다(TruthLedger와 같은 정직한 원장 계약).

/**
 * 자연어 완료 기준 → 구조화된 검증 계약. 특정 대화 하드코딩이 아니라 일반 체크 유형.
 * 지원 체크(첫 슬라이스): count(N건/개) · no_duplicate(중복 없음) · no_missing(누락 없음) ·
 *   sections_exist(섹션/카테고리 존재) · stop(애매 N건 넘으면 멈춤) · constraint(원본 수정 금지 등, 안내).
 * @param {string} text
 * @returns {{checks:object[], constraints:string[], stop:{type:string, n:number}|null}}
 */
export function parseCompletionCriteria(text) {
  const t = String(text ?? '');
  const checks = [];

  // 중단(stop)을 먼저 파싱하고 그 절을 제거한다 — "애매 N건 넘으면"의 숫자를 산출물 개수(count)로 오인하지 않게.
  const stopM = /(?:애매|모호|불확실|ambiguous)[^.]*?(\d+)\s*(?:건|개)?[^.]*?(?:넘으면|이상|초과)/.exec(t);
  const stop = stopM ? { type: 'ambiguous_over', n: Number(stopM[1]) } : null;
  const rest = stopM ? t.replace(stopM[0], ' ') : t; // 중단 절 제거 후 나머지에서 완료 기준을 뽑는다.

  // count는 산출물 개수 문맥(결과/항목/분류/파일/행 수가 N건/개)에서만. 중단 절은 이미 제거됨.
  const count = /(\d+)\s*(?:건|개|개의|건의|명|줄|행|row|rows|items?)/i.exec(rest);
  if (count) checks.push({ type: 'count', expected: Number(count[1]) });
  if (/중복\s*(?:이|은|는)?\s*없/.test(rest) || /no\s*duplicate/i.test(rest)) checks.push({ type: 'no_duplicate' });
  if (/누락\s*(?:이|은|는)?\s*없|빠진\s*(?:것|게)?\s*없|missing.*(?:없|no)/i.test(rest)) checks.push({ type: 'no_missing' });

  // 섹션/카테고리 존재: "배송 환불 계정 섹션" 같은 공백 나열을 잡되, 절 경계(연결어미·서술어)를 넘지 않는다.
  //   순수 명사만 — 연결어미(고/며/서…)로 끝나거나 서술어(없/있/누락/중복…) 포함 단어는 제외.
  const isSectionName = (w) => w
    && !/^(세|다|모두|각|각각|의|이|가|은|는|을|를|카테고리|섹션|three|all|category)$/i.test(w)
    && !/(고|며|서|도|만|랑|과|와|음|기|은|는|이|가|을|를)$/.test(w)
    && !/(없|있|누락|중복|결과|존재|모두)/.test(w);
  const secRun = /((?:[가-힣A-Za-z][가-힣A-Za-z0-9_]*\s+){0,4}[가-힣A-Za-z][가-힣A-Za-z0-9_]*)\s*(?:섹션|카테고리|항목|section)/g;
  const sections = [];
  for (const m of rest.matchAll(secRun)) {
    // 섹션 바로 앞에서부터 역방향으로, 명사가 아닌 단어를 만나면 멈춘다(절 경계).
    const words = m[1].split(/\s+/);
    for (let i = words.length - 1; i >= 0; i--) { if (isSectionName(words[i])) sections.unshift(words[i]); else break; }
  }
  const uniqueSections = [...new Set(sections)];
  if (uniqueSections.length) checks.push({ type: 'sections_exist', sections: uniqueSections });

  const constraints = [];
  const noMod = /(원본|원문|source|csv)[^.]*?(수정|변경|건드리)[^.]*?(말|금지|없|안|not)/i.exec(t);
  if (noMod) constraints.push('원본은 수정하지 않는다');

  return { checks, constraints, stop };
}

// 개별 체크를 산출물(artifact)에 대해 실행한다. artifact: {count?, items?, ids?, sections?, ambiguousCount?}.
function runCheck(check, artifact) {
  const items = Array.isArray(artifact?.items) ? artifact.items : null;
  switch (check.type) {
    case 'count': {
      const actual = artifact?.count ?? items?.length ?? null;
      return { name: `개수 ${check.expected}`, ok: actual === check.expected, detail: `기대 ${check.expected}, 실제 ${actual ?? '알 수 없음'}` };
    }
    case 'no_duplicate': {
      const keys = artifact?.ids ?? items ?? [];
      const dup = keys.length !== new Set(keys.map((k) => JSON.stringify(k))).size;
      return { name: '중복 없음', ok: !dup, detail: dup ? '중복이 있어요' : '중복 없음' };
    }
    case 'no_missing': {
      const arr = items ?? artifact?.ids ?? [];
      const missing = arr.some((x) => x == null || x === '');
      return { name: '누락 없음', ok: !missing, detail: missing ? '빈 항목이 있어요' : '누락 없음' };
    }
    case 'sections_exist': {
      const have = new Set(artifact?.sections ?? []);
      const miss = check.sections.filter((s) => !have.has(s));
      return { name: `섹션 존재(${check.sections.join('·')})`, ok: miss.length === 0, detail: miss.length ? `빠짐: ${miss.join('·')}` : '모두 존재' };
    }
    default:
      return { name: check.type, ok: false, detail: '알 수 없는 검증' };
  }
}

/**
 * 완료 검증 → VerificationReceipt. 통과해야 완료다. 중단 기준(stop)에 걸리면 멈추고 묻는다.
 * @param {{checks:object[], stop?:object}} contract
 * @param {object} artifact
 * @returns {{checks:object[], allPassed:boolean, stopTriggered:boolean, complete:boolean, userSafeSummary:string, nextSafeAction?:string}}
 */
export function verifyCompletion(contract, artifact) {
  const stopTriggered = Boolean(contract.stop?.type === 'ambiguous_over' && (artifact?.ambiguousCount ?? 0) > contract.stop.n);
  const results = (contract.checks ?? []).map((c) => runCheck(c, artifact));
  const allPassed = results.every((r) => r.ok);
  // 완료 = 검증 통과 AND 중단조건 미발동. "생성했다"만으론 완료가 아니다.
  const complete = allPassed && !stopTriggered && results.length > 0;
  const failed = results.filter((r) => !r.ok);
  let userSafeSummary; let nextSafeAction;
  if (stopTriggered) {
    userSafeSummary = `애매한 항목이 기준(${contract.stop.n})을 넘어 멈췄어요. 어떻게 처리할지 알려주세요.`;
    nextSafeAction = '애매한 항목 처리 방법을 확인할까요?';
  } else if (complete) {
    userSafeSummary = '완료 기준을 모두 확인했어요.';
  } else if (results.length === 0) {
    userSafeSummary = '확인할 완료 기준이 없어요.';
  } else {
    userSafeSummary = `아직 완료가 아니에요: ${failed.map((r) => r.name).join(', ')} 안 맞아요.`;
    nextSafeAction = '안 맞는 부분을 고치고 다시 확인할까요?';
  }
  return { checks: results, allPassed, stopTriggered, complete, userSafeSummary, nextSafeAction };
}
