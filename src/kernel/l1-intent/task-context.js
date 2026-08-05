// L1 · LLM-ready Task Context Packet (모델 입력 계약, §11)
// 계약들이 모델에게 전달되는 최종 형태. "사실·경계"를 주고 "판단·문장"은 모델에 남긴다.
// 지시문 장문 주입이 아니다(T3 tool-path-briefing 실증 원리). 무관한 사실을 나열하지 않는다.
import { extname } from 'node:path';
import { selfStateSummary } from '../l0-evidence/self-state.js';
import { sameSiteLinks } from '../l0-evidence/working-state.js';
import { operatorReality } from './operator-reality.js';
import { 실패도교환, 사실공급 } from '../model-sovereign.js';

/**
 * 도구 결과에서 **사용자면 데이터**만 압축해 뽑는다. 통째로 넣으면 프롬프트가 폭주하고,
 * 안 넣으면 모델이 실행 결과를 못 보고 되묻는다. 진단·내부 구조는 애초에 receipt 에 없다.
 */
/** 긴 글은 앞뒤를 남기고 가운데를 접는다 — 앞부분만 자르면 결론이 통째로 사라진다. */
function fold(text, keep) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= keep) return t;
  const head = Math.ceil(keep * 0.7);
  return `${t.slice(0, head)} …(가운데 ${t.length - keep}자 생략)… ${t.slice(-(keep - head))}`;
}

/**
 * 실행 결과 → **모델이 판단할 수 있는 요약 사실**.
 *
 * 예전엔 `JSON.stringify(result).slice(0, 1200)` 이었다. 앞부분만 남기는 절단이라 뒤에 있던
 * 링크·관찰 사실이 통째로 잘렸다 — 그리고 무엇이 잘렸는지도 안 보였다(오너 지적).
 * 원문은 **영수증에 그대로 남는다.** 여기 오는 것은 판단에 필요한 것만이다.
 *
 * 도구마다 "중요한 것"이 다르므로 종류별로 요약한다. 사이트별 분기는 없다.
 */
/**
 * 묶음 이동 뒤 **원본 자리에 무엇이 남았는가**. 지시가 아니라 사실이다 —
 * 이걸 보고 계속할지, 되물을지, 그만둘지는 모델과 사용자가 정한다.
 */
function 남은자리말(remainingSource) {
  const r = remainingSource;
  if (!r || typeof r.files !== 'number') return '';
  if (r.files === 0) return `남은 파일: 0개 (${r.path} 에 파일이 더 없다)`;
  const 분포 = (r.topExtensions ?? []).slice(0, 8)
    .map((x) => `${x.ext === '[no-ext]' ? '확장자 없음' : x.ext} ${x.count}개`).join(' · ');
  return `남은 파일: ${r.files}개 (${r.path})${분포 ? `\n남은 것의 종류: ${분포}` : ''}`;
}

/**
 * 모델 입력에 실을 결과 요약. **상한 1,200자는 실측으로 유지한 값이다**(정본 §S3 "값은 실측으로 정한다").
 *
 * ── 왜 안 올렸나 (2026-08-04 실측, 437개 목록) ──────────────────────────────
 *   상한 1200 →   931자 · 이름  28개/437 ( 6%)
 *   상한 2000 →  1406자 · 이름  47개/437 (11%)
 *   상한 3000 →  2006자 · 이름  71개/437 (16%)
 *   상한 4000 →  2606자 · 이름  95개/437 (22%)
 *   상한 6000 →  3808자 · 이름 143개/437 (33%)
 *
 * 다섯 배를 써도 3분의 1이다. **이름은 애초에 답이 아니었다** — S1 재실행에서 모델은 이름이
 * 아니라 `bulk_move` 의 조건(날짜·확장자)으로 426/437 을 처리했고, 그때 상한은 1,200 이었다.
 *
 * 막고 있던 것은 절단의 크기가 아니라 **조용함**이었다: 뺀 양도, 뺀 것의 성질도, 나머지를
 * 가져올 문도 없었다. 그 셋이 서자(§S3) 같은 1,200자에서 일이 끝났다. 상한을 올리는 것은
 * 프롬프트 예산을 쓰면서 같은 문제를 조금 늦출 뿐이다(v3.1 §17 성능 기준선).
 *
 * Hermes 는 50,000자를 쓴다. 그 값을 흉내 내지 않는 이유가 이 실측이다 —
 * **흡수할 것은 문구가 아니라 원리다**(오너 2026-08-04). 원리는 "정직한 절단 + 문"이었다.
 */
export function compactResult(result, maxChars = 1200) {
  if (result == null || typeof result !== 'object') return undefined;

  // ① 브라우저 관찰 — 화면 핵심 글 · 본 범위 · 못 본 범위 · 더 열 것 · 조작
  const o = result.observation;
  if (o) {
    const lines = [];
    if (result.title) lines.push(`화면: ${result.title}`);
    if (o.seen) {
      lines.push(`글로 받은 범위: ${o.seen.chars}자 / 전체 ${o.seen.of}자 (${o.seen.percent}%)`
        + (o.thin ? ' — 글이 거의 없어요(열리기만 했을 수 있어요)' : ''));
    }
    if (o.unseen?.chars) lines.push(`못 받은 글: ${o.unseen.chars}자 (${o.unseen.percent}%)`);
    lines.push(`화면 아래 남음: ${o.moreBelow ? '있음(더 내리면 새로 불러올 수 있어요)' : '없음'}`);
    if (o.canOpen?.length) {
      lines.push(`더 열 수 있는 것: ${o.canOpen.map((c) => `${c.text}(${c.kind}, ref=${c.ref})`).join(' · ')}`);
    }
    if (o.acted) {
      lines.push(o.acted.kind === 'scroll'
        ? `조작: ${o.acted.times}번 내렸어요${o.acted.stopped ? ` (${o.acted.stopped})` : ''}`
        : `조작: ${o.acted.ref} 를 눌렀어요`);
    }
    const body = fold(result.markdown ?? result.excerpt ?? '', Math.max(maxChars - lines.join('\n').length - 40, 200));
    return `${lines.join('\n')}\n본문: ${body}`;
  }

  // ①-b **화면 관찰 — 글자가 알맹이다.**
  //
  // 오너 지적(2026-08-06): *"기본인 읽기조차 안 되는데 어떻게 컴퓨터 유즈가 되지?"*
  // 손은 카톡 대화 65개를 읽었는데 모델은 못 받았다. 여기 **화면 갈래가 없어서**
  // 맨 아래 `JSON.stringify` → 1,200자 접기로 떨어졌고, 앞쪽 창 목록에서 예산이 다 차
  // **요소가 통째로 잘렸다.**
  //
  // 읽을 때 필요한 것은 **글자**다. 좌표·지문·창·pid 는 누를 때나 쓴다.
  // 그것들을 빼면 같은 예산에 몇 배가 들어간다 — 그리고 누르려면 **토큰**만 있으면 된다.
  if (Array.isArray(result.elements) || result.요소창 || result.본창) {
    const lines = [];
    const 본창 = result.본창;
    if (본창) lines.push(`본 창: ${본창.app ?? ''}${본창.title ? ` · ${본창.title}` : ''}${본창.앞창인가 ? ' (앞 창)' : ''}`);
    else if (result.frontmost?.name) lines.push(`앞 앱: ${result.frontmost.name}`);
    const 창수 = (result.windows ?? []).length;
    if (창수) lines.push(`열린 창 ${창수}개`);
    if (result.창없음이유) lines.push(String(result.창없음이유));
    if (result.그앱없음) lines.push(String(result.그앱없음));

    const 창정보 = result.요소창;
    const 요소들 = result.elements ?? [];
    if (창정보) {
      lines.push(`요소 ${창정보.끝 ?? 요소들.length}개 (전체 ${창정보.총 ?? 요소들.length}개`
        + `${창정보.전체 && 창정보.전체 !== 창정보.총 ? ` / 화면 전체 ${창정보.전체}개` : ''})`
        + `${창정보.순서 ? ` · ${창정보.순서}` : ''}`);
      if (창정보.거르개가못물었다) lines.push(`그 종류로는 못 찾았어요. 있는 건: ${(창정보.있는종류 ?? []).join('·')}`);
    }
    // **글자를 줄 단위로.** 기계 값은 토큰 하나만 — 그게 다음 걸음(누르기)에 필요한 전부다.
    const 줄 = 요소들.map((e) => {
      const 글 = String(e?.value ?? '').trim() || String(e?.label ?? '').trim();
      const 역할 = String(e?.type ?? e?.role ?? '').replace(/^AX/i, '');
      const 표 = e?.토큰 ?? e?.id ?? '';
      return `- ${역할}${표 ? `[${표}]` : ''}: ${글.replace(/\s+/g, ' ').slice(0, 200)}`;
    });
    // 읽기는 알맹이라 예산을 넉넉히 준다 — 그래도 조용히 자르지는 않는다.
    const 본문 = fold(줄.join('\n'), Math.max(maxChars * 6, 6000));
    if (result.다음수단?.length) {
      lines.push(`다음 수: ${result.다음수단.map((n) => `${n.방법}${n.offset != null ? `(offset ${n.offset})` : ''} — ${n.왜}`).join(' · ')}`);
    }
    return `${lines.join('\n')}${줄.length ? `\n${본문}` : ''}`;
  }

  // ② 웹 수집 — 제목 · 본문 길이 · 핵심 발췌 · 열지 않은 같은 사이트 링크
  if (typeof result.markdown === 'string' || Array.isArray(result.links)) {
    const lines = [];
    if (result.title) lines.push(`제목: ${result.title}`);
    if (Array.isArray(result.comparisonCandidates)) {
      // 조용히 자르지 않는다(같은 계열) — 몇 개 중 몇 개인지 말한다.
      if (result.comparisonCandidates.length > 3) lines.push(`비교 후보 ${result.comparisonCandidates.length}개 중 위 3개만 싣는다.`);
      for (const c of result.comparisonCandidates.slice(0, 3)) {
        const date = c.publishedAt ?? c.modifiedAt ?? '날짜 미확인';
        lines.push(`후보 ${c.rank}: ${c.title || '(제목 없음)'} · ${date} · ${c.url}`);
      }
    }
    const md = String(result.markdown ?? '');
    if (md) lines.push(`본문 ${md.length}자`);
    // **읽었다고 끝이 아니다.** 라이브(2026-08-05, 직접 돌림): `오늘 한국 증시 상황은 어때?` 에
    // T5 가 로또 사이트의 아침 브리핑을 읽고 어제 종목 시세로 답했다. 오늘 지수는 못 말했다 —
    // 네이버 금융에 그대로 있는데 안 갔다.
    //
    // 수집기는 **다른 후보와 다음 수단을 이미 만들어 놓고 있었다.** 그런데 여기서 안 실었다.
    // 결과 객체에 필드를 더하는 것만으로는 모델에게 가지 않는다 — 이 자리가 손으로 고르는 자리다.
    // *"안 준 손은 흔적이 없다"* 가 재료에도 그대로 적용된다.
    if (result.읽은상태 === 'shell') {
      lines.push('알맹이 없음: 메뉴·링크뿐이라 이 페이지에는 답이 없어요(껍데기).');
    }
    const 후보 = Array.isArray(result.다른후보) ? result.다른후보.slice(0, 3) : [];
    if (후보.length) {
      lines.push(`검색에서 같이 나온 곳: ${후보.map((c) => `${c.title || '(제목 없음)'} ${c.url}`).join(' · ')}`);
    }
    const 수단 = Array.isArray(result.다음수단)
      ? [...new Set(result.다음수단.map((x) => x.방법))].filter(Boolean) : [];
    if (수단.length) lines.push(`이 답으로 부족하면 다음을 부를 수 있어요: ${수단.join(' · ')}`);
    const 링크전체 = (result.links ?? []).map((l) => (typeof l === 'string' ? l : l?.url)).filter(Boolean);
    const links = 링크전체.slice(0, 6);
    // 조용히 자르지 않는다(같은 계열) — 안 실은 링크가 있으면 몇 개인지 말한다.
    if (links.length) {
      lines.push(`그 페이지의 링크: ${links.join(' · ')}`
        + (링크전체.length > links.length ? ` (전체 ${링크전체.length}개 중 ${links.length}개만 실음)` : ''));
    }
    const body = fold(md || result.excerpt || '', Math.max(maxChars - lines.join('\n').length - 40, 200));
    return `${lines.join('\n')}\n본문: ${body}`;
  }

  // ②-a 대량 파일 이동 — 수백 개 경로 배열을 그대로 주면 모델이 다음 판단 대신 결과 더미에 묻힌다.
  // 원본 상세는 영수증에 남고, 모델 방에는 "어떤 조건 실행이 실제로 어느 정도 효과를 냈는지"만
  // 판단 가능한 크기로 돌린다. 조용히 자르지 않고, 표본만 실었다는 사실을 함께 말한다.
  if (Array.isArray(result.moved) && typeof result.from === 'string' && typeof result.to === 'string') {
    const moved = result.moved;
    const skipped = Array.isArray(result.skipped) ? result.skipped : [];
    const baseName = (value) => String(value ?? '').split('/').filter(Boolean).at(-1) ?? String(value ?? '');
    const sample = moved
      .slice(0, 6)
      .map((item) => baseName(item?.to ?? item?.from ?? item))
      .filter(Boolean);
    const byReason = new Map();
    for (const item of skipped) {
      const reason = item?.reason ?? 'reason_unknown';
      byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    }
    const skippedReasons = [...byReason.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => `${reason} ${count}개`)
      .join(' · ');
    return [
      `bulk 이동: ${moved.length}개`,
      `출발: ${result.from}`,
      `도착: ${result.to}`,
      sample.length
        ? `이동 표본: ${sample.join(' · ')}${moved.length > sample.length ? ` (전체 ${moved.length}개 중 ${sample.length}개만 실음)` : ''}`
        : '',
      skipped.length ? `건너뜀: ${skipped.length}개${skippedReasons ? ` — ${skippedReasons}` : ''}` : '',
      // **남은 수를 뺀 채로 주면 모델은 끝났는지 알 수 없다.**
      //
      // S1 실모델 실측(2026-08-04, 회차 6): 모델이 380개를 옮기고 "싹 돌려놨어"라고 답했다.
      // 옮긴 수는 정확했는데 **루트에 57개가 남았다는 말이 없었다.** 동결 §5.2 는
      // "진행 보고가 실물과 일치 (옮긴 수·**남은 수**)"를 요구한다 — 남은 수가 빠진 것이다.
      //
      // 사실은 이미 영수증에 있었다(`result.remainingSource`). 여기 요약에서 빠져서
      // 모델 눈에 안 들어갔을 뿐이다. 런타임이 "더 옮겨라"라고 시킬 일이 아니라
      // **남은 것이 무엇인지 보여줄 일**이다 — 그 뒤 무엇을 할지는 모델과 사용자의 것이다.
      // 확장자 분포까지 주는 이유: "57개 남음"만으로는 되물을 말을 못 만든다.
      // ".hwp 8 · .mp4 9 · 확장자 없음 18" 이면 "이건 어떻게 할까요?"가 나온다.
      남은자리말(result.remainingSource),
    ].filter(Boolean).join('\n');
  }

  // ②-b 폴더 목록 — 이름 옆에 **사람 말 상대시각**을 붙인다. H08 라이브 실측(2026-08-01):
  // ISO 시각이 JSON 덩어리 속에 있으면 모델이 "방금 받은" 판단에 못 잇고 이름표("최종")로
  // 골랐다. 같은 사실을 판단이 닿는 형태로 준다(며칠·몇 분 전 — 지시가 아니라 사실이다).
  if (typeof result.path === 'string' && Array.isArray(result.items)) {
    const 지금 = Date.now();
    const 시각말 = (iso) => {
      const ms = 지금 - Date.parse(iso);
      if (!Number.isFinite(ms)) return '';
      const 분 = Math.max(1, Math.round(ms / 60_000));
      if (분 < 60) return ` — ${분}분 전 고침`;
      if (분 < 60 * 24) return ` — ${Math.round(분 / 60)}시간 전 고침`;
      return ` — ${Math.round(분 / (60 * 24))}일 전 고침`;
    };
    // ── **조용히 자르지 않는다** (오너 라이브 실측 2026-08-03) ──────────────
    // 다운로드 437개 정리 요청에서 이 갈래는 `slice(0,40)` 뒤 1200자에서 다시 잘려
    // **23개(5%)만** 모델에게 갔다. 그런데 요약은 "437개를 찾았어요"였고, 잘렸다는 말은
    // 마침표 세 개가 전부였다. 나머지를 가져올 인자(offset·limit)도 없다.
    // 모델은 "437개가 있다"는 말과 23개의 이름을 받은 채 "예고만으로 턴을 소비하지 말라"는
    // 요구까지 받았다 — 불가능한 자리다. 그래서 다섯 턴 내내 계획만 반복했다.
    // 되풀이는 모델의 고집이 아니라 **런타임이 대신 판단하고 그 사실을 숨긴 결과**였다.
    //
    // 그래서 둘을 함께 준다: ① 무엇을 얼마나 뺐는지 ② 뺀 부분을 판단할 수 있는 **집계**.
    // 437개 이름을 다 싣는 건 답이 아니다 — 이 일에 필요했던 건 이름이 아니라 분포였다.
    // 집계는 사실이지 판단이 아니다(`modifiedAt` 을 주는 것과 같은 급).
    // **문을 쓰면 `items` 는 한 쪽일 뿐이다.** `total` 이 있으면 그것이 진짜 전체다 —
    // 안 보면 "전체 100개"라고 말하게 되고 모델은 438개를 다 봤다고 믿는다(실측 2026-08-04:
    // 모델이 `limit:100` 을 쓰자 바로 이 거짓이 났다). 조용한 절단을 고치다 새 조용한
    // 거짓을 만들 뻔한 자리다.
    const 진짜전체 = Number.isInteger(result.total) ? result.total : result.items.length;
    const 이번쪽시작 = Number.isInteger(result.offset) ? result.offset : 0;
    const 전체 = result.items;
    const 줄 = (i) => `- ${i.name}${i.kind === 'folder' ? '/' : ''}${i.modifiedAt ? 시각말(i.modifiedAt) : ''}`;
    const 머리 = `자리: ${result.path}`;
    const 이름예산 = Math.floor(maxChars * 0.6); // 나머지는 "뺀 것"을 정직하게 말하는 데 쓴다
    const 실은것 = [];
    let 쓴글자 = 머리.length;
    for (const i of 전체) {
      const l = 줄(i);
      if (쓴글자 + l.length + 1 > 이름예산) break;
      실은것.push(l); 쓴글자 += l.length + 1;
    }
    // 이 쪽을 다 실었어도 **뒤에 더 있으면** 끝난 게 아니다.
    if (실은것.length === 전체.length && 이번쪽시작 + 전체.length >= 진짜전체) {
      return `${머리}\n${실은것.join('\n')}`;
    }

    const 나머지 = 전체.slice(실은것.length);
    const 세기 = (뽑기) => {
      const m = new Map();
      for (const i of 나머지) { const k = 뽑기(i); m.set(k, (m.get(k) ?? 0) + 1); }
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    const 확장자 = 세기((i) => (i.kind === 'folder' ? '폴더' : (i.name.match(/\.[^.]+$/)?.[0] ?? '(확장자 없음)').toLowerCase()));
    const 나이 = 세기((i) => {
      const ms = 지금 - Date.parse(i.modifiedAt ?? '');
      if (!Number.isFinite(ms)) return '고친 때 모름';
      const 일 = ms / 86_400_000;
      return 일 < 7 ? '7일 안' : 일 < 30 ? '30일 안' : 일 < 180 ? '180일 안' : '180일 넘음';
    });
    const 짧게 = (쌍들, n) => 쌍들.slice(0, n).map(([k, v]) => `${k} ${v}개`).join(' · ')
      + (쌍들.length > n ? ` · 그 밖 ${쌍들.slice(n).reduce((s, [, v]) => s + v, 0)}개` : '');
    return [
      머리,
      실은것.join('\n'),
      `— 여기까지가 이름을 실은 ${실은것.length}개다. **나머지 ${진짜전체 - 이번쪽시작 - 실은것.length}개는 이 답에 이름을 싣지 못했다**(전체 ${진짜전체}개).`,
      `못 실은 ${나머지.length}개의 확장자: ${짧게(확장자, 8)}`,
      `못 실은 ${나머지.length}개의 고친 때: ${짧게(나이, 4)}`,
      // **문을 알려준다**(정본 §S3). 사고 원문에서 정확히 이 줄이 없었다 — 모델은 "437개가
      // 있다"는 말과 23개의 이름을 받은 채 실행을 요구받았고, 나머지를 가져올 인자가
      // 없었다. 잘렸다는 사실만 주고 문을 안 주면 그건 알려준 게 아니라 막은 것이다.
      `나머지는 offset 으로 이어서 받는다: offset=${이번쪽시작 + 실은것.length}, limit 로 몇 개씩 받을지 정한다.`,
      '이름 하나하나가 아니라 조건으로 다룰 거면 bulk_move 의 match 를 쓴다.',
    ].join('\n');
  }

  // ③ 파일 본문 — **줄 구조를 지운 채 주지 않는다**(C 감사 F4.2). `fold` 의 `\s+` 접기는
  // 웹 본문용 규칙인데 파일 읽기 결과가 JSON 갈래로 떨어져 CSV·정산표의 행 경계가 모델
  // 입력에서 통째로 사라졌다 — 모델은 행을 근거 없이 재구성해야 했다. 줄바꿈은 남기고,
  // 넘치면 앞뒤를 남기며 접었다는 표식을 단다(모름을 사실로 전달).
  if (typeof result.text === 'string' && typeof result.path === 'string') {
    const lines = [`파일: ${result.path}`];
    if (result.modifiedAt) lines.push(`고침: ${result.modifiedAt}`); // 최신 판단의 재료(F2.3·H08)
    if (result.bytes != null) lines.push(`크기: ${result.bytes}바이트`);
    const keep = Math.max(maxChars - lines.join('\n').length - 40, 200);
    const t = String(result.text).replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    const body = t.length <= keep
      ? t
      : `${t.slice(0, Math.ceil(keep * 0.7))}\n…(가운데 ${t.length - keep}자 생략)…\n${t.slice(-(keep - Math.ceil(keep * 0.7)))}`;
    return `${lines.join('\n')}\n내용:\n${body}`;
  }

  // ④ 그 밖(작은 결과) — 통째로 주되, 넘치면 가운데를 접는다(앞부분만 남기지 않는다).
  const json = JSON.stringify(result);
  if (!json || json === '{}') return undefined;
  return fold(json, maxChars);
}

/**
 * P2-9 · 외부 표면 상태 — **무엇을 요청했고, 무엇을 읽었고, 무엇을 못 읽었는가.**
 *
 * 큰 분류 체계를 만들지 않는다(routeKind 11개·surfaceType 12개 금지 — 발화에서 예측하는 분류기는
 * 오늘 걷어낸 것과 같은 병이다). `surfaceAction` 은 **실제로 한 일**의 사후 기록 하나뿐이다.
 *
 * **못 읽은 것은 실패가 아니다.** failureState 는 그대로 'none' 이다 — 페이지는 읽었다.
 * 왜 더 못 읽었는지는 `web.collect` 의 **능력 문장**이 말한다(브라우저로 열어 버튼·탭·스크롤을
 * 다루는 손이 없다). 능력 부재를 실패로 기록하면 T5 가 "막혔다"고 말하게 되고, 그건
 * P2-8 에서 고친 것과 정면으로 충돌한다.
 */
export function surfaceOf(receipt) {
  if (receipt?.actualCall?.tool !== 'web.collect') return undefined;
  if ((receipt.failureState ?? 'none') !== 'none') return undefined; // 실패는 여기서 말하지 않는다
  const read = receipt.sources?.[0];
  if (!read?.sourceUrl) return undefined;
  const via = receipt.result?.foundVia;
  const pick = (c) => (typeof c === 'string' ? c : c?.url);
  return {
    action: receipt.result?.surfaceAction ?? (via ? 'search_then_read' : 'read_url'),
    requested: via?.query ?? receipt.actualCall?.args?.request,
    read: {
      url: read.sourceUrl,
      title: read.title || receipt.result?.title,
      chars: (receipt.result?.markdown ?? '').length, // 얼마나 읽었는지 — "보이는 만큼"의 근거
    },
    notRead: {
      // 그 사이트 안에 있는데 열지 않은 곳 = **다음에 갈 수 있는 경로**
      onPage: sameSiteLinks(read.sourceUrl, receipt.result?.links),
      // 검색이 준 다른 후보. 찾던 곳이 여기 없으면 **검색이 못 찾은 것**이지 막힌 게 아니다.
      fromSearch: (via?.candidates ?? []).map(pick).filter((u) => u && u !== read.sourceUrl).slice(0, 4),
    },
  };
}

/** 지금 시각·시간대·지역 — OS 가 아는 사실. 모델이 "오늘"을 알아야 오늘 일을 할 수 있다. */
export function nowFacts(clock = () => new Date()) {
  const d = clock();
  let timeZone; let locale;
  try {
    const opt = Intl.DateTimeFormat().resolvedOptions();
    timeZone = opt.timeZone; locale = opt.locale;
  } catch { /* 알 수 없으면 안 싣는다 — 지어내지 않는다 */ }
  let local;
  try {
    local = new Intl.DateTimeFormat('ko-KR', {
      dateStyle: 'full', timeStyle: 'short', timeZone,
    }).format(d);
  } catch { local = d.toISOString(); }
  return { iso: d.toISOString(), local, timeZone, locale };
}

/**
 * 이번 턴에 실제로 열린 연결 입력면과 직접 확인한 단서.
 *
 * 이건 특정 서비스나 도구를 분류하지 않는다. 도구가 영수증 계약으로 낸 사실을 읽을 뿐이다.
 * 입력면이 열리지 않았으면 T5 는 비밀값을 받을 통로가 없다. 그 사실이 없으면 모델은
 * "입력창에 넣어 달라"는, 실제로는 없는 길을 자연스럽게 상상한다.
 */
export function connectionAdmissionFacts(receipts = []) {
  const requests = receipts
    .map((r) => r?.surfaceRequest)
    .filter((r) => r?.kind === 'secret_input');
  const discovery = receipts
    .map((r) => r?.connectionDiscovery)
    .filter(Boolean)
    .at(-1);

  return {
    secretInput: requests.length
      ? {
          label: requests.at(-1).label,
          fields: (requests.at(-1).fields ?? []).map((f) => f.label ?? f.name).filter(Boolean),
        }
      : null,
    ...(discovery ? { discovery } : {}),
  };
}

function verifiedExecutionFacts(receipts = []) {
  const bulk = receipts.filter((r) => r?.actualCall?.tool === 'local.file'
    && (r.failureState ?? 'none') === 'none'
    && Array.isArray(r.result?.moved)
    && typeof r.result?.from === 'string'
    && typeof r.result?.to === 'string');
  if (!bulk.length) return undefined;

  const destinations = new Map();
  const sources = new Set();
  let moved = 0;
  let skipped = 0;
  for (const r of bulk) {
    const movedCount = r.result.moved.length;
    const skippedCount = Array.isArray(r.result.skipped) ? r.result.skipped.length : 0;
    moved += movedCount;
    skipped += skippedCount;
    sources.add(r.result.from);
    destinations.set(r.result.to, (destinations.get(r.result.to) ?? 0) + movedCount);
  }
  const remainingSources = [];
  for (const path of sources) {
    const lastList = [...receipts].reverse().find((r) => r?.actualCall?.tool === 'local.file'
      && (r.failureState ?? 'none') === 'none'
      && r.result?.path === path
      && Array.isArray(r.result?.items));
    const lastBulkSummary = [...receipts].reverse().find((r) => r?.actualCall?.tool === 'local.file'
      && (r.failureState ?? 'none') === 'none'
      && r.result?.from === path
      && r.result?.remainingSource
      && typeof r.result.remainingSource.files === 'number');
    if (!lastList && lastBulkSummary) {
      remainingSources.push(lastBulkSummary.result.remainingSource);
      continue;
    }
    if (!lastList) continue;
    const items = lastList.result.items;
    const extensionCounts = new Map();
    for (const item of items) {
      if (item?.kind !== 'file') continue;
      const ext = extname(String(item.name ?? '')).toLowerCase() || '[no-ext]';
      extensionCounts.set(ext, (extensionCounts.get(ext) ?? 0) + 1);
    }
    const topExtensions = [...extensionCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 12)
      .map(([ext, count]) => ({ ext, count }));
    remainingSources.push({
      path,
      items: items.length,
      files: items.filter((i) => i?.kind === 'file').length,
      folders: items.filter((i) => i?.kind === 'folder').length,
      ...(topExtensions.length ? { topExtensions } : {}),
    });
  }

  return {
    bulkMove: {
      calls: bulk.length,
      moved,
      skipped,
      ...(remainingSources.length ? { remainingSources } : {}),
      destinations: [...destinations.entries()].map(([to, count]) => ({ to, moved: count })),
    },
  };
}

/**
 * @param {Object} p
 * @param {import('../contracts.js').IntentPacket} p.intent
 * @param {import('../contracts.js').SelfStateSnapshot} p.selfState
 * @param {string[]} [p.admittedContext]
 * @param {Array<{role:string,text:string}>} [p.recentTurns]  같은 대화의 최근 발화(사람이 읽는 말만)
 * @param {import('../contracts.js').ActionPlan} [p.plan]
 * @param {import('../contracts.js').ToolReceipt[]} [p.receipts]
 * @returns {import('../contracts.js').TaskContextPacket}
 */
/** 주소로 읽히는 것만 주소로 센다. 검색어(`오늘 코스피`)를 가본 곳으로 세면 안 된다. */
function 주소만(v) {
  try { return /^https?:$/.test(new URL(String(v)).protocol) ? String(v) : null; } catch { return null; }
}

/**
 * **이번 턴이 가진 후보.** 어느 손이 받아 왔든 상관없다 — 찾는 손의 목록도, 읽는 손이
 * 검색으로 왔을 때 딸려 온 목록도 같은 사실이다. 순서는 받은 순서를 지킨다(순위를 다시 매기지 않는다).
 */
function 후보모으기(receipts = []) {
  const out = []; const 본것 = new Set();
  const 넣기 = (title, url) => {
    if (!url || 본것.has(url)) return;
    본것.add(url); out.push({ title: String(title ?? ''), url });
  };
  for (const r of receipts) {
    for (const c of r?.result?.후보 ?? []) 넣기(c?.title, c?.url);
    for (const c of r?.result?.다른후보 ?? []) 넣기(c?.title, c?.url);
    for (const c of r?.result?.foundVia?.candidates ?? []) 넣기(c?.title, c?.url);
    for (const c of r?.다른후보 ?? []) 넣기(c?.title, c?.url);
  }
  return out;
}

/** **이번 턴에 이미 열어 본 곳.** 읽은 곳·막힌 곳·부른 주소 — 셋 다 우리가 밟은 사실이다. */
function 가본곳모으기(receipts = []) {
  const 본것 = new Set();
  for (const r of receipts) {
    for (const s of r?.sources ?? []) if (s?.sourceUrl) 본것.add(s.sourceUrl);
    for (const m of r?.막힌곳 ?? []) if (m?.url) 본것.add(m.url);
    const a = r?.actualCall?.args ?? {};
    for (const v of [a.url, a.request]) { const u = 주소만(v); if (u) 본것.add(u); }
  }
  return 본것;
}

/**
 * 막힌 영수증의 **빈 자리만** 메운다.
 *
 * 손이 스스로 쥔 것이 있으면 그것을 그대로 쓴다 — 손의 사실을 커널이 갈아치우면
 * 그게 답 갈아치우기의 축소판이다. 빈 자리에만 **턴이 이미 가진 후보**를 놓는다.
 * 어느 것이 좋은지는 정하지 않는다(§1.2 · 절대원칙 8).
 */
function 막힌자리메우기(r, { 턴후보 = [], 이미가본곳 = new Set() } = {}) {
  const 손이쥔후보 = r?.다른후보 ?? [];
  const 후보 = 손이쥔후보.length
    ? 손이쥔후보
    : 턴후보.filter((c) => !이미가본곳.has(c.url)).slice(0, 5);
  const 손이쥔수단 = r?.다음수단 ?? [];
  // 구체 주소를 앞에 둔다 — `search`(다시 찾기)는 늘 있는 수라 뒤에 와야 눈에 덜 밀린다.
  const 이미실린주소 = new Set(손이쥔수단.filter((m) => m?.url).map((m) => m.url));
  const 읽기수 = 손이쥔후보.length ? [] : 후보
    .filter((c) => !이미실린주소.has(c.url))
    .map((c) => ({ 방법: 'read_url', url: c.url, 왜: `이번 턴에 찾아 둔 곳: ${c.title || c.url}` }));
  const 수단 = [...읽기수, ...손이쥔수단];
  return {
    ...(수단.length ? { 다음수단: 수단 } : {}),
    ...(후보.length ? { 다른후보: 후보 } : {}),
  };
}

export function buildTaskContext(p) {
  const { intent, selfState } = p;
  const summary = selfStateSummary(selfState);

  // 사실만. 요청과 무관한 사실은 넣지 않는다(§11 규칙).
  const selfStateFacts = {
    model: summary.model,
    modelAuthState: summary.modelAuthState,
    // Phase 2-2 다이어트(§11 "무관한 사실을 나열하지 않는다"): 능력 **설명 문장**은 도구를 실제로
    // 쓰는 턴이나 능력을 물어본 턴에만. 인사 한 마디에 설명서를 통째로 실으면 모델이 그걸 읽고
    // 번호 목록으로 되읊는다(실측). 가벼운 턴에는 도구 **이름만** 준다 — 과장 금지는 이름만으로도 선다.
    readyTools: intent.answerMode === 'fast_chat' && !p.selfhoodDetail
      ? (summary.ready ?? [])
      : (summary.readyCapabilities ?? summary.ready),
    // ── **한계는 사실이다 — 분류기가 지우지 않는다**(S7 ③ · F-18 · 2026-08-05) ──────
    //
    // 예전 주석은 *"한계는 그 도구가 걸리는 턴에서만 쓸모 있다. 잡담에는 소음이다"* 였다.
    // 그런데 **얼마나 되는지 재 보니 79자**다(메일·슬랙·텔레그램 연결 안내 3줄).
    // 79자를 아끼려고 "무엇을 못 하는지"를 통째로 지우면, 모델은 "슬랙 보낼 수 있어?"에
    // 짐작으로 답한다 — 사실을 안 주면 모델은 사실을 만든다(이 흐름에서 여러 번 밟았다).
    //
    // 원 주석이 걱정한 *"설명서를 통째로 실어 번호 목록으로 되읊는"* 것은 바로 위
    // `readyCapabilities`(능력 **설명 문장**) 쪽이고 `limits` 가 아니다 — 그건 안 건드린다.
    limits: 사실공급(p.processEnv)
      ? summary.limits
      : (intent.answerMode === 'fast_chat' && !p.selfhoodDetail ? [] : summary.limits),
    // 승인 필요 손은 자기 상태를 물었을 때만 상세히 준다. 평범한 대화에 권한 설명을 매번
    // 싣지 않되, 물었을 때 모델이 추측으로 위험 범위를 만들지 않게 한다.
    approvalRequired: p.selfhoodDetail ? summary.approvalRequired : [],
  };

  const authorityFacts = {
    boundary: intent.authorityBoundary,
    autoAllowed: p.plan ? p.plan.autoAllowed : [],
    needsApproval: p.plan ? p.plan.needsApproval.map((g) => g.action) : [],
    forbidden: p.plan ? p.plan.forbidden : [],
  };

  const packet = {
    // **집 문서**(S4) — 사용자가 자기 컴퓨터에서 열어 고치는 파일. 매 세션 실린다.
    // 지시가 아니라 **사용자의 뜻**이고, 이번 턴 사실(원장)과 다른 자리에 놓인다.
    ...(p.homeDocs && (p.homeDocs.지침 || p.homeDocs.사용자) ? { homeDocs: p.homeDocs } : {}),
    // P-ID-1: 자기인지. identity 는 매 턴(짧게), selfhoodDetail 은 물어봤을 때만(문서에서 꺼낸 대목).
    identity: p.identity,
    capabilityCounts: p.capabilityCounts,
    selfhoodDetail: p.selfhoodDetail,
    currentRequest: intent.currentRequest, // 원문 보존
    // **방법이 목적을 덮지 않게**(오너 지적 2026-08-05).
    //
    // 라이브에서 `오늘 한국 증시 상황은 어때?` 에 T5 가 세 번 손을 썼는데, 세 번 다
    // **질의 문구만 바꿨다**(`장중` → `마감` → 날짜 붙이기). 매번 페이지를 읽고 거기 있는 것을
    // 말했을 뿐, **"코스피 숫자를 얻었나"** 는 한 번도 안 물었다. 결국 오늘 지수를 못 말했다.
    //
    // 같은 질문을 나(Claude Code)에게 돌려 보니 차이는 도구가 아니라 **순서**였다:
    // 나는 열기 전에 *무엇이 답인지*를 정하고, 못 얻으면 **출처를 바꾼다**(질의가 아니라).
    // T5 에는 그 첫 칸과 대조 칸이 없었다.
    //
    // 커널이 "답이 됐나"를 판정하면 내용 판정이고 심문의 부활이다(절대원칙 8).
    // 그래서 판정하지 않고 **순서만 재료에 세운다** — 판단은 모델이 한다.
    // 웹 전용이 아니다. 파일·터미널·커넥터까지 모든 손에 같은 순서가 선다.
    도구쓰는순서: '① 무엇을 얻으면 답이 되는지 먼저 정한다 ② 결과가 그것을 줬는지 대조한다'
      + ' ③ 못 얻었으면 질의 문구를 바꾸지 말고 다음수단·다른후보로 출처를 바꾼다'
      + ' ④ 끝내야 하면 무엇을 못 얻었는지 말한다(사용자에게 대신 찾아보라고 넘기지 않는다)',
    // Phase 2-1: 같은 대화의 최근 발화. 이게 없으면 매 턴이 단발이라 방금 한 말을 기억하지 못하고
    // 말투도 턴마다 다시 골라진다(실측: 이름을 기억하겠다고 답한 다음 턴에 모른다고 했다).
    recentTurns: p.recentTurns ?? [],
    // 모델이 스스로 찾을 수 있는가 — 사실이므로 알려준다. 모르면 "못 한다"고 답해 버린다.
    nativeSearch: Boolean(p.nativeSearch),
    // 이번 턴에 손을 더 못 쓰는 상태. **없는 것과 다르다** — 그 차이를 안 주면 모델이
    // 빈칸을 '능력 없음'으로 메우고 사용자에게 떠넘긴다(실측 2026-07-28).
    ...(p.toolBudgetSpent ? { toolBudgetSpent: true } : {}),
    // 빈 답을 한 번 더 받는 자리는 도구 예산을 쓴 것이 아니다. 실행 사실은 그대로 두고
    // 사용자에게 보낼 최종 문장만 요구한다.
    ...(p.answerOnly ? { answerOnly: true } : {}),
    // 출구 검증이 되돌린 **사실**(§S5). 지시가 아니다 — 무엇을 말할지는 모델이 정한다.
    ...(p.completionMismatch ? { completionMismatch: p.completionMismatch } : {}),
    // 반대 방향의 같은 사실 — **아직 이어 쓸 수 있는 손이 남아 있다.** H08 라이브 실측
    // (2026-08-01): 손이 3걸음 남았는데 모델이 "지금 손은 다 써서"라며 일을 다음 턴과
    // 사용자에게 미뤘다. 남았다는 사실이 어디에도 없으니 빈칸을 소진으로 메운 것이다.
    ...(Number.isInteger(p.toolStepsLeft) && p.toolStepsLeft > 0 ? { toolStepsLeft: p.toolStepsLeft } : {}),
    // **예산 사실**(정본 §S3 — 6상한을 걷기 전에 서야 하는 것). 두 축을 그대로 준다:
    // 왕복(비용이 실제로 드는 곳)과 걸음(폭주 방지 뒷단). 남은 양을 알아야 모델이
    // "한 번에 얼마나 할지"를 스스로 정할 수 있다 — 지시가 아니라 사실이다(계약 ④).
    ...(p.turnBudget ? { turnBudget: p.turnBudget } : {}),
    // 되풀이 신호. **경고이지 명령이 아니다** — 같은 손이 계속 막히고 있다는 사실만 주고
    // 방향을 바꿀지는 모델이 정한다. 런타임이 대신 멈추면 그게 다시 주객 전도다.
    ...(p.guardrailNotes?.length ? { guardrailNotes: p.guardrailNotes } : {}),
    // 어느 provider 인가 — 모델 계열별 운영 보정을 고르는 데만 쓴다(정체성은 안 바뀐다).
    modelProviderId: p.modelProviderId,
    // 막힌 것이 있을 때 다음 계단(사다리). 지시가 아니라 **지금 쓸 수 있는 길**이라는 사실이다.
    recoveryHint: p.recoveryHint,
    // 자기 파악 세 번째 축(운용 상태) — 실제 기록만. 모델 추정은 넣지 않는다(오염 방지).
    workingState: p.workingState,
    projectWorkState: p.projectWorkState,
    // 서버가 아는 실행 현실. 주소·경로·포트 같은 내부값은 싣지 않고 사용자에게 의미 있는
    // 경계만 준다. 모델이 자기 호스팅 환경을 출신 지식으로 추측하지 않게 한다.
    runtimeEnvironment: p.runtimeEnvironment,
    // **지금 언제, 어디인가.** OS 는 이걸 안다. 안 주면 모델은 "오늘"이 언제인지 몰라 되묻거나
    // 엉뚱한 날짜로 답한다(실측: "미국 기준 오늘인 7월 26일을 말씀하신 거라면…").
    // 지역도 마찬가지 — 사실이 없으니 "어느 지역이요?"를 매번 물었다. 규칙이 아니라 사실이 부족했다.
    now: p.now ?? nowFacts(),
    selfStateFacts,
    admittedContext: p.admittedContext ?? [],
    // S3 · 다른 대화에서 이어받을 수 있는 작업(§4.7). 사실 나열이며 지시가 아니다 —
    // "아까 그거"가 무엇인지는 모델이 이 사실 위에서 판단한다. 후보가 여럿이면 여럿 그대로.
    carryableWork: p.carryableWork ?? [],
    // S5-3: 직전 답이 놓고 쓴 문장들 — 정정이 무엇을 고치는지 지목할 대상.
    priorShown: p.priorShown ?? [],
    authorityFacts,
    answerMode: intent.answerMode,
    // 방법·언어는 모델에 열어둔다(§10.2). 이 문자열은 지시문이 아니라 규칙 표식이다.
    naturalness: 'method_and_language_open',
    ...(p.workContractAssessment ? { workContractAssessment: p.workContractAssessment } : {}),
  };

  // SOUL 말투 — 매 턴 고정 접두에 얹힌다(캐시에 붙는다).
  if (p.voice) packet.voice = p.voice;

  // 3축: 응답 표면(웹/텔레그램/슬랙). 방 id·정책·도구명은 싣지 않는다 — 라벨과 성질만.
  if (p.surface) packet.surface = p.surface;

  // P5-B-0.5: **외부 서비스 얘기가 나오면 지금 가능한 현실을 함께 놓는다.**
  // 금지문("복붙 시키지 마라")을 더하지 않는다 — 실측에서 그런 규칙은 안 먹혔다(§24).
  // 대신 "직접 연결은 이 상태이고, 이미 있는 손으로는 이런 게 된다"를 사실로 준다.
  // 그 사실이 없으면 모델은 없는 자리를 상상으로 메우고, 가장 쉬운 상상이 복붙 요청이다.
  // **분류기에 매달지 않는다.** 처음엔 fast_chat 턴에서 뺐는데, 오너가 든 네 시나리오 중 셋이
  // fast_chat 으로 분류됐다(실측):
  //   "너 내 노션 볼 수 있어?" · "구글에 연결하고 싶어" · "Gmail에서 견적서 찾아줘"
  // 셋 다 현실을 못 받은 채 답했고, 그래서 있는 브라우저 손을 두고 복붙을 시켰다.
  //
  // 이건 사실이 분류에 좌우된 것이다 — **말귀를 intent 분류기로 축소하지 말라**(오너 지시).
  // 이 블록은 T5 자기 손과 연결 상태에 대한 **능력 사실**이다(readyTools·limits 와 같은 급).
  // 짧게 유지하는 것으로 소음을 다루고, 실을지 말지를 분류기가 정하게 두지 않는다.
  if (p.externalReality) packet.externalReality = p.externalReality;
  // M5 연속성 ②: 같은 목록을 다시 놓을 때 **그것이 새 사실이 아니라는 사실**을 함께 놓는다.
  // 사실을 빼는 게 아니라 한 줄을 더하는 것이다(위 주석의 흉터 — 빼면 능력이 사라진다).
  if (p.externalReality && p.externalRealityDelta) packet.externalRealityDelta = p.externalRealityDelta;

  // 연결·비밀 입력은 가능한지의 문제 이전에 **실제로 열린 표면이 있는지**의 문제다.
  // 매 턴 같은 구조 사실을 싣되, 후보와 값은 영수증으로 확인된 것만 넣는다.
  if (p.externalReality || p.receipts?.length) packet.connectionAdmission = connectionAdmissionFacts(p.receipts);

  const 실행합계 = verifiedExecutionFacts(p.receipts);
  if (실행합계) packet.verifiedExecutionFacts = 실행합계;

  // 대화 대상이 파일·웹·외부 서비스·개발 작업 중 무엇이든 같은 운영 현실을 본다.
  // 이건 "이 도구를 써라"가 아니라, T5가 이미 사용자 대신 직접 다룰 수 있는 일을 알려 주는
  // 사실이다. 서비스별 분기나 발화 분류에 매달리면 다음 낯선 요청에서 다시 빈칸이 생긴다.
  const operating = operatorReality(selfState);
  if (operating) packet.operatorReality = operating;

  // ── 모델이 실제로 부른 것은 **모델의 것으로 돌려준다** (실측 2026-08-03) ──────────
  //
  // 실모델 한 턴 전문을 받아 보니 매 호출의 메시지가 `[system, user]` **두 개뿐**이었다.
  // `tool` 역할도, `assistant` 의 tool_calls 도 없었다 — 도구 결과가 사용자 메시지 안에
  // **3인칭 서술**로 들어갔다("179개를 찾았어요. 부른 인자: …").
  //
  // 모델 입장에서 그건 자기가 한 일이 아니라 **남이 알려준 소식**이다. 그래서 같은 폴더를
  // 세 번 읽고("매번 처음이라고 느낀다"), 실행을 이어가지 못하고, "다음 턴에 하겠다"고 미루고,
  // 하지 않은 일을 했다고 말했다. 헌장에 "네가 T5다"라고 적어도 다음 호출에서 자기 행동이
  // 3인칭으로 돌아오면 그 문장은 힘이 없다 — **행동 이력이 지워진 존재에게 selfhood 는 없다.**
  //
  // 그래서 **실제로 부른 것**(actualCall 이 있는 영수증)은 표준 도구 대화로 넘긴다.
  // **못 부른 것**(부르지 않아 actualCall 이 null 이고 `제안한호출` 만 있는 것)은 대화로
  // 표현할 수 없으므로
  // 아래 `evidenceFacts` 서술로 남는다 — 둘이 겹치지 않게 가른다(같은 사실을 두 번 주지 않는다).
  // **성공한 호출만** 교환으로 간다. 실패한 호출의 인자는 `확인되지 않은 값`이라 아래 서술이
  // 가림(`확인되지않은인자`)을 걸어 다루고 있다 — 그걸 대화 이력에 사실처럼 심으면 모델이
  // 확인되지 않은 절대 경로를 자기가 실제로 쓴 값으로 읽는다(그 계약을 검사가 지키고 있다).
  //
  // **S1 슬라이스**(`T5_MODEL_SOVEREIGN=1`, 주객 회복 계약 ②): 실패·차단도 자기 행동이다.
  // 성공만 자기 것으로 돌려주면 모델은 **자기가 무엇을 시도해 어디서 막혔는지**를 3인칭 서술로
  // 받는다 — 그 상태로는 "다른 손으로 바꾼다"가 자기 판단이 아니라 남의 보고에 대한 반응이 된다.
  // 다만 **가림은 그대로 선다.** 첫 판에서 나는 인자를 원문 그대로 실어놓고 주석에는 "가림은
  // 결과 쪽에서 건다"고 적었다 — 어디서도 안 걸었다. 플래그 ON 회귀에서 `/Users/someone/Downloads`
  // 가 모델 입력에 원문 재공급되며 걸렸다(실측 2026-08-04). 실패한 호출의 절대 경로가 확인된
  // 값처럼 도는 것을 막는 계약(`02375fe`)은 이 슬라이스가 여는 셋에 들어 있지 않다.
  // 그래서 성공은 원문, 실패는 아래 `확인되지않은인자` 를 통과한 인자로 간다.
  // ── **앞 턴의 도구 대화도 모델의 것이다** (정본 §S2 필수 계약 ②) ─────────────
  //
  // `turnExchange` 는 이번 턴 영수증에서만 나온다. 그래서 턴이 넘어가면 모델은 자기가
  // 방금 무엇을 했는지 **서술(recentTurns)로만** 받았다 — 재시작하면 그마저도 형태가 바뀐다.
  // 모델 주도 구조에서 행동 이력이 지워지는 것은 **기억상실**이다(계약 ② 의 정의역).
  //
  // 그래서 저장된 앞 턴 교환을 **이번 턴 교환 앞에** 잇는다. 순서는 시간 순이다.
  // 사실을 두 벌로 만들지 않는다 — 같은 신분(`providerCallId`·`ref`)이 오면 뒤엣것이 이긴다.
  const 앞턴교환 = Array.isArray(p.priorExchange) ? p.priorExchange : [];
  // ── **S2 · 모델이 낸 호출은 어떻게 됐든 모델에게 돌아간다**(2026-08-05) ──────
  //
  // 원리 ⑤ — 커널이 막았으면 **막았다는 사실을 프로세스에게 결과로 돌려준다.**
  // 예전엔 두 겹으로 어긋나 있었다:
  //   ① 실행됐지만 실패한 호출은 `T5_MODEL_SOVEREIGN` 을 켜야만 여기 들어왔다.
  //   ② **실행 전에 막힌 호출은 플래그를 켜도 못 들어왔다** — `못한호출남기기` 의 영수증은
  //      `actualCall: null` 이라 아래 필터에 애초에 안 걸렸다. 모델은 자기가 낸 호출이
  //      어떻게 됐는지 **산문으로만** 받았고, 구조로는 그 호출이 통째로 사라져 보였다.
  //
  // A/B 실측(2026-08-03·04 · 같은 발화 · gpt-5.1)이 방향을 정했다 —
  //   A(기준선) 실물 이동 성공 1/4 · 왕복 평균 9.5 · 심문호출 매회 2
  //   B(모델주도) 실물 이동 성공 5/7 · 왕복 평균 7.1 · 심문호출 0
  // 계약 ③(실패도 교환)은 **플래그에서 내린다.** ①②(심문 미실행)는 이 칸의 일이 아니라
  // 그대로 플래그에 남는다 — 한 번에 하나만 바꾼다.
  //
  // 호출 신분은 `actualCall` 또는 `제안한호출` 중 **있는 쪽**에서 온다. 어느 쪽이든
  // **모델이 낸 그 호출**이고, 모델은 그 신분으로 자기 행동을 잇는다.
  const 낸호출 = (r) => r?.actualCall ?? r?.제안한호출 ?? null;
  const 부른것 = (p.receipts ?? []).filter((r) => 낸호출(r)?.tool);
  // **후보는 손 하나가 아니라 턴이 갖는다**(라이브 2026-08-05, 내가 직접 돌린 5턴).
  //
  // `web.collect` 가 4번 막혔고 **네 번 다 `다른후보` 가 0개**였다. 계약은 지켜졌다 —
  // 그 넷은 모델이 **주소를 직접 넣어** 부른 호출이라 검색 이력이 없었고,
  // *"검색을 안 했으면 후보를 지어내지 않는다"* 가 맞게 돌았다.
  // **그런데 바로 그 턴에 `web.search` 가 후보 여덟을 이미 받아 놓고 있었다.**
  // 계약은 관통했고 목적은 안 지켜졌다 — 찾은 손과 막힌 손이 남남이라 **왼손이 쥔 것을
  // 오른손이 못 썼다.** 그래서 후보를 턴이 갖는 사실로 올린다.
  //
  // **이건 심문이 아니다.** 어느 후보가 좋은지 정하지 않는다. 이번 턴에 실제로 받아 둔
  // 목록에서 **이미 열어 본 곳만 빼고** 그대로 옆에 놓는다. 없는 턴에는 아무것도 안 붙는다.
  const 턴후보 = 후보모으기(부른것);
  const 이미가본곳 = 가본곳모으기(부른것);
  if (부른것.length || 앞턴교환.length) {
    // **손이 든 화면 증거를 교환에 붙인다**(CU F-2). 영수증에는 없다 — 옆길로 왔다.
    const 그림들 = p.이번턴그림 instanceof Map ? p.이번턴그림 : new Map();
    packet.turnExchange = 부른것.map((r, i) => {
      const 실패 = (r.failureState ?? 'none') !== 'none';
      // 실행 전에 막힌 것은 `제안한호출` 이 그 신분을 갖는다(계약상 `actualCall` 은 null).
      const 호출 = 낸호출(r);
      return {
        // **두 신분을 구분해 담는다**(오너 지시 2026-08-04).
        //   `providerCallId` — 공급자가 발급한 것. 없으면 **칸을 만들지 않는다.**
        //   `ref`            — T5 내부 상관용. 언제나 있다.
        // 예전엔 `c1, c2…` 하나뿐이었고 그것을 공급자 신분 자리에 실어 보냈다 — 모델은
        // 자기가 발급한 적 없는 id 의 tool_call 을 "네가 한 일"로 돌려받았다(실측 2026-08-04).
        // 내용도 짝도 맞았지만 신분이 지어낸 것이라, 런타임은 "모델이 무엇을 요청했는가"와
        // "T5 가 무엇을 했는가"를 경계 너머로 이을 수 없었다.
        ref: 호출.callRef ?? `c${i + 1}`,
        ...(호출.providerCallId ? { providerCallId: 호출.providerCallId } : {}),
        tool: 호출.tool,
        // **실행 안 된 호출의 인자는 확인된 값이 아니다.** 실패와 같은 계약으로 가린다 —
        // 확인되지 않은 절대 경로가 사실처럼 도는 것을 막는 계약(`02375fe`)이 여기서도 선다.
        args: (실패 || !r.actualCall ? 확인되지않은인자(호출.args) : 호출.args) ?? {},
        // 결과는 서술 블록이 주던 것과 **같은 내용**이다(줄이지 않는다). 렌더는 provider 가 한다 —
        // 읽은 곳/안 읽은 곳은 와이어마다 같은 문장을 쓰므로 그쪽 `surfaceLines` 를 그대로 재사용한다.
        summary: r.userSafeSummary,
        surface: surfaceOf(r),
        // **못 본 자리의 화면 증거**(CU F-2). 손이 옆길로 넘긴 것이라 영수증엔 없다.
        // 커널은 이 그림을 읽지 않는다 — 모델에게 그대로 옮길 뿐이다.
        ...(그림들.has(r) ? { 그림: 그림들.get(r) } : {}),
        // 실패한 호출의 결과는 확인된 값이 아니다 — 내용을 사실처럼 싣지 않고 상태만 준다.
        ...(실패 ? { failureState: r.failureState } : { data: compactResult(r.result) }),
        ...(실패 && r.nextSafeAction ? { nextSafeAction: r.nextSafeAction } : {}),
        // **막혔을 때야말로 다음 수가 필요하다**(라이브 2026-08-05).
        //
        // 바로 윗줄의 계약 — *실패한 호출의 결과는 확인된 값이 아니다* — 은 옳고 그대로다.
        // 그런데 그 계약이 `data` 를 걷을 때 **손이 쥔 다음 길까지 함께 걷어 갔다.** 성공하면
        // `data.다음수단` 으로 가고, 막히면 아무것도 안 갔다. 그래서 T5 는 후보 다섯 중 셋이
        // 막히자 *"대신 제가 아는 경로로 찾아볼게요"* 라 해 놓고 **아무 데도 안 갔다.**
        //
        // 내용과 다음 길은 다른 것이다. 못 본 페이지의 본문은 사실이 아니지만, 검색기가
        // 실제로 돌려준 후보 목록과 우리가 부딪힌 벽은 **밟은 사실**이다. 사실은 보낸다.
        //
        // 손이 스스로 쥔 것이 있으면 **그것을 쓴다.** 커널은 **빈 자리만 메운다** —
        // 손의 사실을 갈아치우면 그게 답 갈아치우기의 축소판이다.
        ...(실패 ? 막힌자리메우기(r, { 턴후보, 이미가본곳 }) : {}),
        ...(r.막힌곳?.length ? { 막힌곳: r.막힌곳 } : {}),
      };
    });
    if (앞턴교환.length) {
      const 이번신분 = new Set(packet.turnExchange.map((x) => x.providerCallId ?? x.ref));
      packet.turnExchange = [
        ...앞턴교환.filter((x) => !이번신분.has(x?.providerCallId ?? x?.ref)),
        ...packet.turnExchange,
      ];
    }
  }

  // 실행 결과가 있으면 사실로만 덧붙인다(진단면 제외 — userSafeSummary 만).
  // **`turnExchange` 가 가져간 것은 여기 없다** — 같은 사실을 두 번 주지 않는다.
  const 남은것 = (p.receipts ?? []).filter((r) => !부른것.includes(r));
  if (남은것.length) {
    packet.evidenceFacts = 남은것.map((r) => ({
      // **신분은 여기에도 온다.** 서술로 남는 것들(부르지도 못한 것 · 없는 손 · 상한에 걸린 것)도
      // 모델이 낸 호출이면 그 신분이 있다. 없으면 모델은 "내가 call_SKIP 으로 시킨 게 어떻게
      // 됐지"를 물을 수 없고, 안 간 것을 간 것으로 세어 답을 쓴다(오너 지시 2026-08-04).
      // 부르지 않은 호출의 신분은 `제안한호출` 에 있다(`actualCall` 은 계약상 null 이다).
      // 두 칸을 여기서 한 번에 읽는다 — 어느 쪽이든 **모델이 낸 그 호출**이다.
      ...((r.제안한호출 ?? r.actualCall)?.providerCallId
        ? { providerCallId: (r.제안한호출 ?? r.actualCall).providerCallId } : {}),
      ...((r.제안한호출 ?? r.actualCall)?.callRef
        ? { ref: (r.제안한호출 ?? r.actualCall).callRef } : {}),
      intended: r.intended,
      failureState: r.failureState,
      // P2-8: **주소를 직접 받아 읽은 것**과 **검색해서 찾아 읽은 것**을 구분한다.
      // 실측(2026-07-27): 모델이 "부오상회 을지로점 **네이버 플레이스**"를 요청했는데 우리가 검색해서
      // 나온 블로그를 읽고 failureState=none 으로 성공 기록했다. 모델은 플레이스를 못 받았다는 것만
      // 알고 이유를 몰라 "검색 수집이 제한돼서"라고 **추측**했다 — 우리가 안 알려줬기 때문이다.
      // 불일치 탐지기(토큰 휴리스틱)를 만들지 않는다. 그건 다음에 또 어긋난다(절대원칙 8).
      // 사실만 준다: 무엇을 찾으려 했고, 무엇을 읽었고, 안 읽은 후보가 무엇인가. 판단은 모델이 한다(§24).
      surface: surfaceOf(r),
      summary: r.userSafeSummary, // diagnosticTrace 는 절대 넣지 않는다
      // 결과의 **알맹이**도 준다. 요약만 주면 모델이 "목록을 붙여달라"고 되묻는다(실측: 파일 목록을
      // 실제로 읽어 놓고 "도구가 없어 못 본다"고 답했다). 진단면은 여전히 안 넣는다.
      data: compactResult(r.result),
      // **무엇으로 불렀는가**도 준다. 요약과 결과만 주면 모델은 자기가 보낸 인자를 다시 못 본다.
      // 그러면 "무엇을 적었는지"를 기억으로 재구성한다 — 실측(2026-07-27 라이브, 텔레그램·화면
      // 양쪽): `메모5.md` 에 실제로 쓴 목록과 T5 가 "이렇게 적었어"라며 보고한 목록이 **세 줄 다
      // 달랐다.** 원장·파일은 일치했고 답변만 갈라졌다. 짧은 값("세번째")은 우연히 맞아서 세 번을
      // 통과했고, 목록이 되자 드러났다.
      //
      // action-plan.js 는 이미 **판정과 실행이 같은 인자를 봐야 한다**고 못박았다(두 진실 금지).
      // 보고도 같은 인자를 봐야 한다. 셋 중 하나만 다른 것을 보면 원장만 진실이 되고, 사용자가
      // 읽는 답변은 그럴듯한 창작이 된다. 도구마다 결과에 실어 보내게 하면 빠뜨리는 도구가 생기므로
      // (조용한 미참여) 커널이 **모든 도구에 대해** 한 자리에서 준다.
      ...(r.failureState === 'none'
        ? { calledWith: compactResult(r.actualCall?.args) }
        // 부르지 않은 호출은 **제안값**이다 — 어휘가 이미 그렇게 말하고 있었다("확인된 사실 아님").
        : { attemptedWith: compactResult(확인되지않은인자((r.제안한호출 ?? r.actualCall)?.args)) }),
      // **손이 남긴 다음 길도 그 손의 사실이다**(2026-08-05 밟음).
      // `turnExchange` 는 이미 이걸 싣는데 여기만 빠져 있었다. 그래서 실행 전에 막힌 손
      // (`approvalEligibility` 거절 등)은 *왜* 막혔는지만 가고 *무엇을 하면 되는지*는 사라졌다.
      //
      // 턴 하나짜리 `recoveryHint` 로 대신할 수 없다. 그 자리는 **해낸 손이 있으면 막힌 손의
      // 다음 길을 일부러 버린다**(userSafeNextAction 의 `해낸손` 계약 — 라이브 c217a0c6:
      // locate 가 자료를 찾았는데도 "폴더를 통째로 복사해 주세요"가 턴 전체를 지배했다).
      // 그 계약은 옳고 그대로 둔다. 대신 **손마다의 사실은 손마다 붙여 준다** —
      // 하나로 합친 판정이 아니라 사실 나열이므로, 무엇을 쓸지는 모델이 고른다(§24).
      ...((r.failureState ?? 'none') !== 'none' && r.nextSafeAction
        ? { nextSafeAction: r.nextSafeAction } : {}),
    }));
  }

  return packet;
}

function 확인되지않은인자(value) {
  if (Array.isArray(value)) return value.map(확인되지않은인자);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const pathLike = /(?:path|directory|root|cwd)$/i.test(key);
    if (pathLike && typeof item === 'string' && item.startsWith('/')) {
      return [key, '[확인되지 않은 절대 경로]'];
    }
    return [key, 확인되지않은인자(item)];
  }));
}

/**
 * **화면 증거의 수명은 이번 턴이다**(CU F-2 · 계획 §6).
 *
 * 그림은 오너 화면이다. 다음 턴으로 넘기면 **한 번 본 것이 계속 도는 것**이 되고,
 * 원장에 남으면 지워지지 않는다. 나머지 사실은 그대로 이어야 한다 —
 * 교환이 끊기면 모델은 자기가 무엇을 했는지 잊는다(기억상실).
 */
export function 이번턴만그림(turnExchange = []) {
  return (turnExchange ?? []).map(({ 그림, ...나머지 }) => 나머지);
}
