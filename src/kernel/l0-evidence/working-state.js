// L0 · 운용 상태 (P2-7 2축) — 자기 파악의 **세 번째 축**.
//
// 자기 파악 = 나는 누구인가(정체성) + 무엇을 할 수 있는가(능력) + **지금 이 대화에서 어디까지 왔는가**.
// 앞의 둘은 §6.30 에서 만들었고 세 번째가 비어 있었다. 그래서 이런 일이 났다(오너 실사용):
//   턴1: 네이버 플레이스를 읽고 팔식당을 분석했다
//   턴2: "리뷰 내용들 읽어보고" → **책 리뷰 쓰는 방법**을 검색해 요약했다
//
// **receipt 가 진실이다.** 이 파일은 별도 저장소가 아니라 영수증에서 파생되는 **얇은 뷰**다.
// 모델의 추정·요약을 상태로 저장하면 그 추정이 다음 턴의 "사실"이 되어 오염이 누적된다.
// 우리가 남기는 것은 영수증이 말한 것뿐이다.
//
// **대상을 잇는 것만큼 푸는 것이 중요하다.** 잇기만 하면 모델이 엉뚱한 페이지를 한 번 읽었을 때
// 그게 현재 대상으로 고착되고, 이후 모든 턴이 그 오염을 물려받는다(절대원칙 §0: 틀린 사실을 주면
// 모델을 오염시킨다). 푸는 방법은 **규칙이 아니라 사실**이다 — "아니 그거 말고" 같은 말을 정규식으로
// 잡지 않는다(§24: 규칙으로 굳히면 모델이 멍청해진다). 대신 **몇 턴 전에 다뤘는지를 정확히 말한다.**
// 안 쓰이면 "방금"에서 내려오고, 더 안 쓰이면 뷰에서 사라진다. 런타임은 대상을 고집하지 않는다.

const MAX_SUBJECTS = 5;
const MAX_LINKS = 8;
// 이번 턴·직전 턴에 다룬 것만 "방금"이다. 그 뒤로는 배경 사실로 내려온다(고집 금지).
const CURRENT_WITHIN_TURNS = 1;
// 이만큼 안 쓰이면 뷰에서 내린다 — 옛 대상이 영원히 현재인 척하지 않는다.
const FORGET_AFTER_TURNS = 8;
// 실측(6턴 실사용): 이 블록은 492~558자였다. 그 두 배를 상한으로 둔다 — 이 뷰가 프롬프트를
// 삼키면 정작 대화 이력이 밀려난다. 넘치면 **오래된 것부터** 버린다.
export const MAX_FACTS_CHARS = 1200;

/** 그 페이지에서 이어갈 수 있는 **같은 사이트 안의 길**만. 광고·외부 링크는 길이 아니다. */
export function sameSiteLinks(pageUrl, links = []) {
  let host;
  try { host = new URL(pageUrl).hostname; } catch { return []; }
  const out = [];
  const seen = new Set();
  for (const l of links) {
    const url = typeof l === 'string' ? l : l?.url;
    if (!url || seen.has(url)) continue;
    let u;
    try { u = new URL(url); } catch { continue; }
    if (u.hostname !== host) continue;
    if (u.href === pageUrl || u.href === `${pageUrl}#`) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

/**
 * 영수증 하나 → 다음 턴에 이어야 할 대상.
 *
 * **커널은 도구 이름을 모른다.** 예전엔 여기가 `if (tool === 'web.collect') …
 * if (tool === 'local.file') … if (tool === 'local.terminal') …` 사다리였다.
 * 도구가 늘 때마다 커널을 고쳐야 했고, 안 고치면 그 도구만 조용히 안 이어졌다 —
 * `local.locate` 가 정확히 그렇게 샜다(찾아 놓고 다음 손이 어디인지 몰랐다).
 * 이미 세 번 새어 본 패턴이라 `previewOf(args)` 와 같은 계약으로 바꾼다:
 * **도구가 자기 결과에서 subject 를 낸다**(runtime/tool-runner.js 의 withSubject).
 *
 * 여기서는 그걸 그대로 얹는다. 새 도구(채널·외부 API·MCP·CLI)가 붙어도 커널은 안 바뀐다.
 */
function subjectFrom(receipt) {
  const s = receipt?.subject;
  if (!s || !s.key || !s.kind || !s.label) return null;
  return s;
}

/**
 * 이번 턴의 영수증을 이전 뷰 위에 얹는다. **성공한 실행만** 대상이 된다 —
 * 못 한 것은 대상이 아니라 "막힌 것"이다(실패 결과를 사실로 올리면 모델을 오염시킨다).
 * @param {object|null} prevState 이전 운용 상태(세션에 없으면 null 로 온다 — 실측에서 터졌다)
 * @param {{receipts?:Array, pendingApprovals?:string[], blocked?:string}} turn
 */
export function deriveWorkingState(prevState, turn = {}) {
  const prev = prevState ?? {};
  const turnNo = (prev.turnNo ?? 0) + 1;
  // P6-W3: **지금 볼 수 있는 자리.** 사용자는 경로를 모르고 알 필요도 없다 — 이름으로 고른다.
  // 이번 턴에 새로 알아냈으면 갱신하고, 아니면 지난 것을 그대로 이어간다(사라지면 "거기"가 끊긴다).
  const places = turn.places ?? prev.places;
  const receipts = turn.receipts ?? [];

  // 이번 턴에 실제로 다룬 대상들(성공분만).
  const fresh = [];
  for (const r of receipts) {
    if (!r || (r.failureState ?? 'none') !== 'none') continue;
    const s = subjectFrom(r);
    if (s) fresh.push({ ...s, lastTurn: turnNo });
  }

  // 새 것이 앞, 오래된 것은 뒤로. 같은 대상을 다시 다루면 **최신 정보로 갱신**되고 앞으로 나온다.
  const merged = [];
  const seen = new Set();
  for (const s of [...fresh, ...(prev.subjects ?? [])]) {
    if (seen.has(s.key)) continue;
    seen.add(s.key);
    // 오래 안 쓰인 대상은 내린다 — 옛것이 영원히 "현재"인 척하지 않는다.
    if (turnNo - s.lastTurn > FORGET_AFTER_TURNS) continue;
    merged.push(s);
    if (merged.length >= MAX_SUBJECTS) break;
  }

  // 막힌 것: 이번 턴에 막혔으면 갱신, 아니면 이전 것을 이어간다(다음 턴에도 다음 길을 기억한다).
  // 다만 이번 턴에 뭔가 성공했으면 막힘은 푼다 — 되는 길을 찾았는데 "막혔다"고 남기면 거짓이다.
  const blocked = turn.blocked ?? (fresh.length ? undefined : prev.blocked);

  // P5-B-1B · **하다 만 일은 다음 턴이 이어받는다.** 실측(오너 2026-07-28): 비밀 입력창을
  // 띄우고 사용자가 창을 닫으면 그 사실이 어디에도 안 남았다 — 다음 턴에 "아까 네이버 붙이다
  // 말았지?"를 T5 가 말할 자리가 없었다. 성공한 것만 기록하면 **중간에 멈춘 일이 통째로 사라진다.**
  //
  // 커널은 여기서도 도구 이름을 모른다: `surfaceRequest`(사용자에게 열어 줘야 하는 표면)와
  // `subjectOf`(그 일의 대상)라는 기존 계약만 읽는다.
  const 이번에멈춘것 = receipts.filter((r) => r?.surfaceRequest)
    .map((r) => ({
      key: subjectFrom(r)?.key ?? r.surfaceRequest.connector,
      label: r.surfaceRequest.label ?? subjectFrom(r)?.label,
      kind: r.surfaceRequest.kind,
      // 무엇을 기다리는가 — 사용자가 채워야 하는 칸 이름까지(값은 아니다).
      ...(r.surfaceRequest.fields?.length
        ? { needs: r.surfaceRequest.fields.map((f) => f.label ?? f.name) } : {}),
      lastTurn: turnNo,
    }));
  // 그 사이에 실제로 된 것이 있으면 푼다 — 됐는데 "하다 말았다"고 남기면 그게 거짓이다.
  // 키 모양이 둘이다: 표면 요청은 대상 이름 그대로, subjectOf 는 `종류:이름` 으로 온다.
  // 같은 것을 다르게 부르면 영원히 안 풀린다 — 앞의 종류를 떼고 맞춘다.
  const 벗기기 = (k) => String(k ?? '').replace(/^[a-z_]+:/, '');
  const 풀린것 = new Set(fresh.map((s) => 벗기기(s.key)));
  const awaiting = [...이번에멈춘것, ...(prev.awaiting ?? [])]
    .filter((a, i, all) => all.findIndex((x) => x.key === a.key) === i)
    .filter((a) => !풀린것.has(벗기기(a.key)))
    .filter((a) => turnNo - a.lastTurn <= FORGET_AFTER_TURNS);

  // **끝난 일은 끝났다고 남긴다.** 실측(오너 라이브 G 행렬 2026-07-29): 파일을 저장해 실제로
  // 끝낸 뒤 `아까 그거 이어줘` 하자 T5 가 같은 파일을 **다시 쓰는 승인 카드**를 띄웠다.
  // 저장된 파일을 읽어 존재를 확인하고도 그랬다 — 현재 상태에 "방금 다룬 파일"은 있어도
  // **"그 요청은 완료됨"이 없었기 때문**이다. 오히려 activeGoal 이 새 발화로 덮여
  // 런타임이 "진행 중"처럼 말했다.
  //
  // 장기 학습층(TaskTrace)이 아니라 **이 대화의 운용 상태**다. 그래서 여기 얇게 둔다.
  // 완료를 판정하지 않는다 — 부르는 쪽(커널)이 실행 결과로 정하고 여기서는 이어가고 감쇠시킨다.
  const 지난완료 = prev.recentOutcome;
  const recentOutcome = turn.outcome
    ?? (지난완료 && turnNo - (지난완료.completedTurn ?? 0) <= FORGET_AFTER_TURNS ? 지난완료 : undefined);

  return {
    turnNo,
    ...(places?.length ? { places } : {}),
    subjects: merged,
    pendingApprovals: turn.pendingApprovals?.length ? turn.pendingApprovals : prev.pendingApprovals,
    ...(awaiting.length ? { awaiting } : {}),
    ...(recentOutcome ? { recentOutcome } : {}),
    blocked,
  };
}

/**
 * 모델에게 줄 **사실 문장**. 지시가 아니라 "지금 이 대화가 어디까지 왔는지"의 기록이다.
 * 비어 있으면 아무 것도 만들지 않는다(없는 상태를 지어내지 않는다).
 *
 * 시제를 정확히 쓴다 — 방금 다룬 것만 "방금"이라고 한다. 이게 대상을 **푸는** 장치다:
 * 사용자가 화제를 바꾸면 옛 대상은 자연히 "몇 턴 전"으로 내려가고 현재를 주장하지 않는다.
 */
export function workingStateFacts(stateOrNull) {
  const state = stateOrNull ?? {};
  const turnNo = state.turnNo ?? 0;
  const subjects = state.subjects ?? [];
  // 현재 대상은 **가장 최근에 다룬 것들뿐**이다. 새 대상이 오면 이전 것은 그 즉시 물러난다 —
  // 둘 다 "방금"이라고 하면 모델이 어느 쪽이 지금 이야기인지 모른다.
  // 그리고 그 최근조차 오래됐으면(안 쓰인 턴이 쌓이면) 아무 것도 현재가 아니다(고집 금지).
  const newest = subjects.reduce((n, s) => Math.max(n, s.lastTurn), 0);
  const hasCurrent = newest > 0 && turnNo - newest <= CURRENT_WITHIN_TURNS;
  const current = hasCurrent ? subjects.filter((s) => s.lastTurn === newest) : [];
  const older = subjects.filter((s) => !current.includes(s));

  const lines = [];
  // P6-W1 · 지금 자리. **"이 프로젝트"의 "이"가 여기서 나온다.**
  // 사용자는 경로를 안 말하고 "이 프로젝트", "그 폴더"라고 부른다. 최근에 실제로 뭔가를 한
  // 자리가 있으면 그게 그 말의 뜻일 확률이 가장 높다 — 없으면 **말하지 않는다**(지어내지 않는다).
  // 코드 폴더만이 아니다: 정산 자료를 읽었으면 그 폴더가, 서버를 켰으면 그 자리가 여기 온다.
  const 자리 = [...current, ...older].find((s) => typeof s.detail === 'string' && s.detail.startsWith('/'))?.detail;
  if (자리) lines.push(`지금 자리: ${자리}`);
  // **볼 수 있는 자리는 이름만 준다.** 경로를 늘어놓으면 프롬프트를 먹고, 사용자도 경로로 말하지 않는다.
  // 사용자가 "외장하드요", "거기"라고 하면 모델이 이 이름들 중에서 고른다(우리가 파싱하지 않는다 — §24).
  if (state.places?.length) {
    lines.push(`볼 수 있는 자리: ${state.places.map((p) => p.label).slice(0, 10).join(' · ')}`);
  }
  // **끝난 일은 끝났다고 말한다.** 무엇을 할지는 모델이 정한다(§24) — "다시 하지 마"라고
  // 시키지 않는다. 사용자가 정말 다시 하라고 하면 막히면 안 되기 때문이다.
  const 끝난 = state.recentOutcome;
  if (끝난?.status === 'completed') {
    lines.push(`최근 완료한 일: ${끝난.request}${끝난.subjects?.length ? ` — ${끝난.subjects.join(' · ')}` : ''} (완료됨)`);
  }
  for (const s of current) {
    if (s.kind === 'web') {
      lines.push(`방금 읽은 자료: ${s.label} (${s.detail})`);
      // 이어서 볼 수 있는 곳. "리뷰 봐줘"에 검색으로 도망가지 않고 여기서 고르면 된다.
      if (s.links?.length) lines.push(`그 페이지에서 이어갈 수 있는 곳: ${s.links.join(' , ')}`);
    } else if (s.kind === 'file') {
      lines.push(`방금 다룬 파일: ${s.label}`);
    } else if (s.kind === 'place') {
      // 자리를 찾았다는 사실 + **거기서 이어서 하면 된다**는 것. 사용자에게 경로를 되묻지 않는다.
      lines.push(`방금 찾은 자리: ${s.label} — 여기서 이어서 보면 돼요`);
    } else if (s.kind === 'place_candidates') {
      // **여러 곳이면 아직 자리가 아니다.** 하나를 고른 척하면 사용자는 다른 달 자료로 답을 받고도
      // 그 사실을 모른다(오너 라이브 2026-07-29). 고르지 않았다는 것과 후보를 함께 준다 —
      // 무엇을 할지(짧게 묻든, 근거로 좁히든)는 모델이 정한다(§24).
      lines.push(`찾은 자리 후보 ${s.label}, 아직 고르지 않음: ${s.detail}`);
    } else if (s.kind === 'session') {
      lines.push(`방금 찾은 지난 대화: ${s.label}`);
    } else if (s.kind === 'discovery') {
      lines.push(`방금 연결 단서를 확인한 대상: ${s.label}${s.detail ? ` — ${s.detail}` : ''}`);
    } else if (s.kind === 'command') {
      // 실패를 성공처럼 이어받지 않는다. 그리고 **어디서** 돌렸는지가 다음 명령의 자리가 된다.
      lines.push(`방금 실행: ${s.label}${s.failed ? ` — 실패(코드 ${s.exitCode})` : ''}`);
    } else if (s.kind === 'process') {
      lines.push(`방금 켠 것: ${s.label}${s.alive ? '' : ' — 지금은 꺼져 있음'}`);
    }
  }
  if (older.length) {
    // 같은 이름이 두 번 나오면 모델은 **서로 다른 둘**로 읽는다(한 가게의 홈과 리뷰 페이지가
    // "팔식당 : 네이버(2턴 전), 팔식당 : 네이버(3턴 전)"으로 찍혔다 — 라이브 실측).
    // 배경 사실이므로 이름 기준으로 최근 것 하나만 남긴다.
    const byLabel = new Map();
    for (const s of older) if (!byLabel.has(s.label)) byLabel.set(s.label, s);
    // **현재라고 주장하지 않는다** — 몇 턴 전인지 함께 말한다. 사용자가 화제를 바꿨으면
    // 모델은 이걸 배경으로 두고 지금 발화를 따라간다.
    lines.push(`이 대화에서 앞서 다룬 것: ${[...byLabel.values()]
      .map((s) => `${s.label}(${turnNo - s.lastTurn}턴 전)`).join(', ')}`);
  }
  if (state.pendingApprovals?.length) lines.push(`승인을 기다리는 일: ${state.pendingApprovals.join(', ')}`);
  // **하다 만 연결.** 이게 없으면 다음 턴의 T5 는 처음부터 다시 시작한다 — 사용자는 이미
  // 절반을 했는데. 사실만 준다(무엇을 기다리는지까지). 뭘 하라고는 말하지 않는다.
  for (const a of state.awaiting ?? []) {
    lines.push(`붙이다 멈춘 것: ${a.label ?? a.key}`
      + (a.needs?.length ? ` — ${a.needs.join('·')} 입력을 기다리는 중` : ' — 사용자 쪽 차례')
      + (turnNo - a.lastTurn > 0 ? ` (${turnNo - a.lastTurn}턴 전)` : ''));
  }
  // 실패는 **결과 내용 없이** 사실로만 남긴다. 못 한 일의 내용물을 사실로 올리면 모델이 그걸
  // 답의 재료로 쓴다(실측: 엉뚱한 페이지 내용을 근거로 답했다).
  if (state.blocked) lines.push(`막혔던 것과 다음 길: ${state.blocked}`);

  if (!lines.length) return undefined;
  // 상한을 넘으면 **오래된 쪽부터** 버린다(앞줄이 현재 대상이다).
  let out = lines.join('\n');
  while (out.length > MAX_FACTS_CHARS && lines.length > 1) {
    lines.pop();
    out = lines.join('\n');
  }
  return out.length > MAX_FACTS_CHARS ? `${out.slice(0, MAX_FACTS_CHARS)}…` : out;
}
