// L1 · LLM-ready Task Context Packet (모델 입력 계약, §11)
// 계약들이 모델에게 전달되는 최종 형태. "사실·경계"를 주고 "판단·문장"은 모델에 남긴다.
// 지시문 장문 주입이 아니다(T3 tool-path-briefing 실증 원리). 무관한 사실을 나열하지 않는다.
import { extname } from 'node:path';
import { selfStateSummary } from '../l0-evidence/self-state.js';
import { sameSiteLinks, 빈손으로돌아왔나 } from '../l0-evidence/working-state.js';
import { operatorReality } from './operator-reality.js';
import { 실패도교환 } from '../model-sovereign.js';

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
 * 터미널 출력 한 갈래(stdout 또는 stderr)를 **줄 경계에서만** 접는다.
 *
 * 글자로 자르면 행이 반토막 나고, 모델은 그 반토막을 값으로 읽는다(실측: `ls -la` 의 크기 칸이
 * 잘려 파일 크기가 통째로 다른 수가 됐다). 파일 갈래(③)가 이미 같은 이유로 `fold` 를 버렸다 —
 * *"`fold` 의 `\s+` 접기가 CSV 행 경계를 통째로 지웠다"*. 터미널은 표·로그라 더 심하다.
 *
 * 그리고 **문을 함께 준다**(정본 §S3 — 뺀 양 · 뺀 것의 성질 · 문). 뺀 가운데는 같은 명령의
 * 그 **줄 범위**이므로, 모델이 그대로 부를 수 있는 값(`sed -n 'A,Bp'`)으로 적는다.
 * 잘렸다는 사실만 주고 문을 안 주면 그건 알려준 게 아니라 막은 것이다.
 */
function 터미널본문(라벨, 원문, 예산, command) {
  const 줄들 = 원문.split('\n');
  const 머리 = `${라벨} 전체 ${줄들.length}줄 ${원문.length}자`;
  if (원문.length <= 예산) return `${머리}:\n${원문}`;

  const 앞예산 = Math.ceil(예산 * 0.6);
  const 앞 = []; let 앞자 = 0;
  for (const l of 줄들) {
    if (앞자 + l.length + 1 > 앞예산) break;
    앞.push(l); 앞자 += l.length + 1;
  }
  const 뒤 = []; let 뒤자 = 0;
  const 뒤예산 = 예산 - 앞자;
  for (let i = 줄들.length - 1; i >= 앞.length; i -= 1) {
    if (뒤자 + 줄들[i].length + 1 > 뒤예산) break;
    뒤.unshift(줄들[i]); 뒤자 += 줄들[i].length + 1;
  }
  // 줄 하나가 예산보다 길다 — 줄 경계가 없으니 글자로 자르되 **그 사실을 말한다.**
  // 줄 범위로 나눌 수 없으니 줄 범위 문도 안 준다(없는 문을 가리키지 않는다).
  if (!앞.length && !뒤.length) {
    const 앞쪽 = Math.ceil(예산 * 0.6);
    return `${머리}:\n${원문.slice(0, 앞쪽)}\n…[가운데 ${원문.length - 예산}자 생략 — `
      + `줄바꿈이 없어 줄 범위로 나눌 수 없다]…\n${원문.slice(-(예산 - 앞쪽))}`;
  }
  const 뺀줄 = 줄들.length - 앞.length - 뒤.length;
  if (뺀줄 <= 0) return `${머리}:\n${원문}`;
  const 문 = `…[${라벨} 가운데 ${뺀줄}줄(${원문.length - 앞자 - 뒤자}자)은 이 답에 없다 — `
    + `그 범위는 \`${command} | sed -n '${앞.length + 1},${줄들.length - 뒤.length}p'\` 로 이어 받는다]…`;
  return [`${머리}:`, 앞.join('\n'), 문, 뒤.join('\n')].filter((s) => s !== '').join('\n');
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
  // 폴더는 침묵하면 「다 봤다」로 읽힌다(J6 계보 · §7-cd 실측): 치우던 자리 **안**으로
  // 옮겨 하위폴더가 새로 섰는데 이 문장이 파일만 세서, 「압축본만 남았다」는 완료 주장
  // 옆에 반박 사실이 못 섰다 — 모델이 받은 것은 「남은 파일: 1개 (.gz)」뿐이었다.
  // 세기만 한다 — 무엇을 할지는 모델과 사용자의 것이다(아래 남은 수 주석의 그 원칙).
  const 폴더말 = typeof r.folders === 'number' && r.folders > 0 ? ` · 남은 폴더: ${r.folders}개` : '';
  if (r.files === 0) return `남은 파일: 0개 (${r.path} 에 파일이 더 없다)${폴더말}`;
  const 분포 = (r.topExtensions ?? []).slice(0, 8)
    .map((x) => `${x.ext === '[no-ext]' ? '확장자 없음' : x.ext} ${x.count}개`).join(' · ');
  return `남은 파일: ${r.files}개 (${r.path})${폴더말}${분포 ? `\n남은 것의 종류: ${분포}` : ''}`;
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
    // **자를 함께 준다**(오너 2026-08-06 · 손과 눈). 그림만 주면 모델은 *"입력창이 아래에 있다"*
    // 까지만 알고 **어디를 누르라고 말할 수가 없다.** 창의 자리와 크기를 주면 비율로 짚는다.
    // 전용 기능이 아니다 — 모든 창에 같은 자가 붙는다.
    if (본창) {
      const b = 본창.bounds;
      // **자는 하나만.** 그림을 줄 때 창 크기까지 주면 모델이 앞의 것을 쓴다 —
      // 실측: `크기 559×859 · 화면 500×768` 을 주니 `y=840` 을 짚어 그림 밖(창 939)이 됐다.
      // 창의 화면상 자리·크기는 짚을 때 쓰는 값이 아니다.
      const 그림있나 = Number(result.그림크기?.w) > 0;
      const 자 = !그림있나 && b && Number.isFinite(Number(b.x))
        ? ` · 자리 x${b.x} y${b.y} 크기 ${b.w ?? b.width}×${b.h ?? b.height}` : '';
      // **모델이 짚을 자는 모델이 보는 그림의 자다.** 창 크기를 주면 밖을 짚는다 —
      // 실측: 그림 500×768 인데 창 크기(559×859)를 보고 `y=840` 을 짚어 창 밖(939)이 됐다.
      // `zoom` 이 20% 패딩을 붙이고 500px 로 줄이므로 둘은 늘 다르다.
      // **"보여 드린"은 반대로 읽힌다.** 이 압축본은 모델이 읽는 글인데, 그 말은
      // *남이 나에게 보여 줬다*로 읽혀 T5 가 *"제게는 딱 이 한 화면만 전달된 상태"* ·
      // *"캡처해서 보내 주시면"* 이라고 답했다(라이브 2026-08-06 · 세 번). 받은 그림은
      // 더 얻을 수 없지만 **내가 본 화면은 밀고 다시 볼 수 있다** — 그 차이가 스크롤을 막았다.
      const 그림자 = 그림있나
        ? ` · 네가 본 화면 ${result.그림크기.w}×${result.그림크기.h}(지금 보이는 만큼 · 짚을 자리는 이 안에서)` : '';
      lines.push(`본 창: ${본창.app ?? ''}${본창.title ? ` · ${본창.title}` : ''}${본창.앞창인가 ? ' (앞 창)' : ''}${자}${그림자}`);
      // 픽셀 좌표도 요소 토큰처럼 **관찰 신분과 함께** 되붙여야 한다. 드라이버가
      // `그림스냅샷`을 만들어도 이 압축 갈래가 버리면 모델은 같은 그림에서 짚은 좌표를
      // 실행 손에 건넬 수 없고, 결국 좌표를 지어내거나 사용자에게 떠넘긴다.
      if (result.그림스냅샷) {
        lines.push(`화면 관찰 신분: ${result.그림스냅샷} (이 그림에서 x·y를 짚을 때 대상.스냅샷으로 함께 준다)`);
      }
    }
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
    // **되붙일 한 벌을 그대로 준다** — 모델이 조각을 골라 조립하게 두면 틀린다.
    //
    // 밟은 사실(라이브 2026-08-06 · 오너의 ④). 예전 줄은 `- TextArea[s1:25]: 메시지 입력` 이었고
    // 모델은 `대상: {id:'s1:25', label:'TextArea'}` 로 조립했다 — **역할을 이름으로 착각했다.**
    // 우리가 뭉쳐 놓고 무엇이 이름인지 안 말했으니 당연한 일이다. 게다가 글이 `value || label`
    // 이라 **값이 있으면 이름이 사라져** 그 요소를 다시 짚을 방법이 없었다.
    //
    // 이 한 줄이 두 가지를 동시에 막고 있었다 — 실행(손이 못 찾는다)과 승인(탐침도 못 찾아
    // 값 있는 칸인데 카드가 뜬다). **복사만 하면 되게** 한다.
    const 줄 = 요소들.map((e) => {
      const 이름 = String(e?.label ?? '').trim();
      const 값 = String(e?.value ?? '').trim();
      const 역할 = String(e?.type ?? e?.role ?? '').replace(/^AX/i, '');
      const 표 = e?.토큰 ?? e?.id ?? '';
      const 보이는것 = [값, 값 && 이름 && 값 !== 이름 ? `(이름: ${이름})` : (값 ? '' : 이름)]
        .filter(Boolean).join(' ');
      // 이름 없는 요소는 **이름 칸을 비운다** — 역할로 채우면 모델이 그걸 이름으로 베낀다.
      const 짚기 = 표 ? ` 대상=${JSON.stringify({ id: 표, label: 이름 })}` : '';
      return `- ${역할}: ${보이는것.replace(/\s+/g, ' ').slice(0, 200)}${짚기}`;
    });
    // 읽기는 알맹이라 예산을 넉넉히 준다 — 그래도 조용히 자르지는 않는다.
    // **브라우저 탭은 로그인 뒤 자리로 가는 문이다**(CU-④). 손이 들고만 있으면 소용없다 —
    // 실측: 탭을 CDP 로 다 읽어 놓고도 모델은 *"AX 로는 각 탭 URL 을 못 읽는다"* 고 답했다.
    if (Array.isArray(result.탭들) && result.탭들.length) {
      lines.push(`열린 탭 ${result.탭들.length}개`);
      for (const t of result.탭들.slice(0, 30)) {
        lines.push(`- ${String(t.title ?? '').replace(/\s+/g, ' ').slice(0, 80)} — ${t.url ?? ''}`);
      }
    }
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
  // bulk_copy(F-120)도 같은 압축을 탄다 — 안 타면 대량 복사에서 경로 더미가 모델 방에 간다.
  const 일괄 = Array.isArray(result.moved) ? { 목록: result.moved, 동사: '이동' }
    : Array.isArray(result.copied) ? { 목록: result.copied, 동사: '복사' } : null;
  if (일괄 && typeof result.from === 'string' && typeof result.to === 'string') {
    const moved = 일괄.목록;
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
      `bulk ${일괄.동사}: ${moved.length}개`,
      `출발: ${result.from}`,
      `도착: ${result.to}`,
      sample.length
        ? `${일괄.동사} 표본: ${sample.join(' · ')}${moved.length > sample.length ? ` (전체 ${moved.length}개 중 ${sample.length}개만 실음)` : ''}`
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
    // 목록의 표 사실(⑬ 진단·표적 수리 · 2026-08-09) — 손이 동봉한 CSV 합계를 이름 옆에 싣는다.
    // 멈춘 자리(목록)에 이름·시각뿐이면 일반론이 인용보다 쉽다(E4-R3 vs X1 대조 실측).
    const 표말 = (t) => (t?.sums
      ? ` (표 ${t.rows}행 · 열: ${(t.columns ?? []).slice(0, 5).join('·')} · 합계 ${Object.entries(t.sums).slice(0, 2)
        .map(([열, v]) => `${열} ${Number(v).toLocaleString('ko-KR')}`).join(' · ')})`
      : '');
    // ② 집계 범위(§7-ay) · 크기도 싣는다 — items 에만 넣으면 **모델에 안 닿는다**(감시자 ⑤ ·
    // 「만든 것과 닿은 것은 다르다」). 바이트 그대로(진값 기준 · 사람 단위 변환은 모델 몫).
    // 항목당 +8~12자 — 이름예산(maxChars*0.6) 안에서 실리는 개수가 그만큼 준다(측정해 신고).
    const 줄 = (i) => `- ${i.name}${i.kind === 'folder' ? '/' : ''}${i.size !== undefined ? ` ${i.size}B` : ''}${i.modifiedAt ? 시각말(i.modifiedAt) : ''}${표말(i.table)}`;
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
    // 같은 자리의 다른 파일 — 부분합을 전체처럼 말하는 병의 재료 칸(매듭 ① · 2026-08-08).
    // 사실만 준다: 읽었는지 안 읽었는지는 모델의 교환 이력이 안다.
    if (result.같은자리파일?.length) lines.push(`같은 자리의 다른 파일: ${result.같은자리파일.join(' · ')}`);
    // ── **손이 이미 쪽을 넘겼으면 그 문을 그대로 옮긴다**(정본 §S3 · 2026-08-11) ──
    //
    // `local.file read` 는 `offset`·`limit`·`nextOffset` 을 **이미 갖고 있다**(local-file.js §문).
    // 그런데 모델 입력에는 그 값이 한 번도 안 실렸다 — 손에 문이 있는데 모델은 손잡이를 못 봤다.
    // 새 저장소를 만들 일이 아니라 있는 문을 여는 일이다.
    const 쪽시작 = Number.isFinite(Number(result.offset)) ? Number(result.offset) : 0;
    if (result.totalChars != null) {
      lines.push(`이 파일 전체 ${result.totalChars}자 중 offset ${쪽시작} 부터 ${String(result.text).length}자를 받았다`
        + (result.nextOffset != null ? ` · 다음 쪽은 local.file read 에 offset=${result.nextOffset}` : ''));
    }
    const keep = Math.max(maxChars - lines.join('\n').length - 40, 200);
    // **접기 계산은 날것 위에서 한다.** 공백 정리를 먼저 하면 글자 수가 밀려 문의 offset 이
    // 어긋난다 — 어긋난 문은 문이 아니라 또 하나의 거짓이다. 정리는 실을 조각에만 건다.
    const 날것 = String(result.text);
    const 정리 = (s) => s.replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    let body;
    if (날것.trim().length <= keep) body = 정리(날것);
    else {
      const 앞 = Math.ceil(keep * 0.7);
      const 뒤 = keep - 앞;
      const 뺀양 = 날것.length - 앞 - 뒤;
      // **문**: 뺀 가운데는 이 파일의 `offset` 부터 `limit` 만큼이다. 모델이 그대로 부를 수 있는 값.
      body = `${정리(날것.slice(0, 앞))}\n…(가운데 ${뺀양}자 생략 — 그 부분은 `
        + `local.file read 에 offset=${쪽시작 + 앞} · limit=${뺀양} 로 이어 받는다)…\n`
        + `${정리(날것.slice(-뒤))}`;
    }
    return `${lines.join('\n')}\n내용:\n${body}`;
  }

  // ③-b **터미널 — 원문 그대로.** (기본 ③ · 2026-08-14)
  //
  // 여기에 갈래가 **없어서** 터미널 결과가 맨 아래 JSON 통짜(④)로 떨어지고 있었다. 결과 둘:
  //   · `stdout` 의 줄바꿈이 JSON 안에서 `\n` **리터럴로 이스케이프**된다 — 표·로그의 행 구조가
  //     한 줄로 눌린다. **파일 갈래(③)는 이미 같은 병을 고쳤다**(`fold` 의 `\s+` 접기가 CSV
  //     행 경계를 지운 자리). 터미널만 안 고쳐져 있었다.
  //   · 잘릴 때 **JSON 문자열 한가운데**가 끊겨 모델이 깨진 JSON 을 받는다. 실측: 600줄
  //     `ls -la`(35,408자)가 gpt-5.1 창에 11,400자(32%)만, 그나마 조각으로 실렸다.
  //   · 그리고 **이어 받을 문이 없었다.** `local.file read` 갈래는 `offset`·`limit` 로 이어 받는
  //     문을 준다 — 터미널은 「잘렸다」만 말하고 나머지를 가져올 방법이 없었다.
  //
  // 저장소가 이미 이 축을 적어 뒀다(`design/T5-STATE-MAP-ko.md:586` · 아래 §S2 주석):
  // *"헤르메스는 실패도 성공과 같은 그릇에 담아 그대로 싣는다 … 클로드코드도 원문 그대로다."*
  //
  // **판정하지 않는다.** 손이 낸 기계 사실(`ran`·`localChanged`·`effects`·`failedBy`·`stopped`·`terminated`)을 그대로
  // 옮길 뿐이고, 무엇을 말할지는 모델이 정한다(§24).
  if (typeof result.command === 'string'
    && (typeof result.stdout === 'string' || typeof result.stderr === 'string'
      || typeof result.exitCode === 'number' || result.probeRan === true)) {
    const 머리 = [`명령: ${result.command}`];
    if (result.cwd) 머리.push(`자리: ${result.cwd}`);
    if (result.exitCode != null) 머리.push(`끝난 코드: ${result.exitCode}`);
    if (result.durationMs != null) 머리.push(`걸린 시간: ${result.durationMs}ms`);
    // 실행 사실과 로컬 변경 사실은 다른 질문이다. `ran`이 있는 새 영수증이
    // 구버전 `applied`보다 우선한다. 미관측은 false로 메우지 않는다.
    if (result.ran === true) 머리.push('실제로 돌았다');
    else if (result.ran === false) 머리.push('실제로는 돌지 않았다');
    else if (result.applied === true) 머리.push('실제로 돌았다(구버전 영수증)');
    else if (result.applied === false) 머리.push('실제로는 안 돌았다(구버전 영수증)');
    if (result.localChanged === true) 머리.push('로컬 사용자 상태 변경이 관측됐다');
    else if (result.localChanged === false) 머리.push('로컬 사용자 상태 변경은 관측되지 않았다');
    if (Array.isArray(result.effects) && result.effects.length) {
      머리.push(`승인되어 열린 효과 범위: ${result.effects.join(' · ')}`);
    }
    if (result.blockedBy) 머리.push(`막은 것: ${result.blockedBy}${result.blockReason ? ` · ${result.blockReason}` : ''}`);
    if (result.probeRan) 머리.push('탐침이 한 번 돌았다 — 지금까지 바뀐 것은 없다');
    if (result.failedBy) 머리.push(`끝난 이유: ${result.failedBy}${result.failReason ? ` · ${result.failReason}` : ''}`);
    if (result.stopped) 머리.push(`멈춘 이유: ${result.stopped}`);
    if (Array.isArray(result.terminated) && result.terminated.length) {
      머리.push(`끈 대상: ${result.terminated.map((t) => `${t.pid} ${t.stillRunning ? '아직 돌고 있음' : '지금 없음'}`).join(' · ')}`);
    }
    // 실행기가 이미 접은 것(30,000자 상한)도 절단이다 — 두 절단을 겹쳐 놓고 한쪽만 말하지 않는다.
    if (result.truncated) 머리.push(`실행기가 먼저 ${result.omittedChars ?? 0}자를 접었다(원문이 실행기 상한을 넘었다)`);
    if (result.다음수단?.length) {
      머리.push(`다음 수: ${result.다음수단.map((n) => `${n.방법}${n.cwd ? `(${n.cwd})` : ''} — ${n.왜}`).join(' · ')}`);
    }

    const 나가는것 = [머리.join('\n')];
    const 남은예산 = () => Math.max(maxChars - 나가는것.join('\n').length, 200);
    const stderr원문 = String(result.stderr ?? result.probe?.stderr ?? '');
    const stdout원문 = String(result.stdout ?? result.probe?.stdout ?? '');
    // **stderr 를 먼저 담는다.** exit 0 이 아닌 것의 알맹이는 거기 있고 대개 짧다 —
    // stdout 이 예산을 다 먹으면 정작 왜 실패했는지가 모델 입력 밖으로 밀린다.
    if (stderr원문.trim()) {
      나가는것.push(터미널본문('stderr', stderr원문, Math.max(Math.floor(남은예산() * 0.5), 200), result.command));
    }
    if (stdout원문.trim()) {
      나가는것.push(터미널본문('stdout', stdout원문, 남은예산(), result.command));
    }
    // **빈 것도 사실이다** — 아무 말이 없으면 모델은 "못 받았다"와 "원래 없었다"를 못 가른다.
    if (나가는것.length === 1) 나가는것.push('stdout·stderr 둘 다 비어 있었다.');
    return 나가는것.join('\n');
  }

  // ④ 그 밖(작은 결과) — **구조(JSON)를 그대로 준다**(§5-3 b · 2026-08-12).
  // 예전엔 `fold` 로 접었다 — 뺀 양은 밝혔지만 전체 크기·실은 범위·다음 위치가 없어
  // 모델이 나머지를 셈할 수 없었다(잘렸다는 말만 하고 막은 것). 넘치면 앞·끝을 남기고
  // 그 셋을 값으로 밝힌다. 나머지 원문은 영수증에 그대로 있고, 크게 넘치면 흘린 파일이
  // 문이 된다(`흘린원문` — tool-runner §5-3 c).
  const json = JSON.stringify(result);
  if (!json || json === '{}') return undefined;
  if (json.length <= maxChars) return json;
  const 앞 = Math.ceil(maxChars * 0.7);
  const 뒤 = Math.max(maxChars - 앞, 0);
  return `${json.slice(0, 앞)}\n…[잘림: 전체 ${json.length}자 · 실은 범위 0-${앞} 과 끝 ${json.length - 뒤}-${json.length} · 가운데 다음 위치 ${앞}]…\n${json.slice(-뒤)}`;
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
    // 자는 **원장 배열 인덱스**(수령 순서)다 — 시계 비교 금지(§7-ce-1 정정 ②). 예전엔
    // lastList 가 무조건 이겨서, 옮기기 **전**에 본 목록(files:6 · .md 5)이 옮긴 뒤의
    // remainingSource(files:1 · 폴더 1)를 덮었다 — 같은 모델 입력 안에 「남은 파일 1개」와
    // 낡은 6개가 정면 모순으로 함께 실렸다(§7-cd ④ 실측). 더 나중 영수증이 더 새 실측이다 —
    // 방향 무관 균일: 옮긴 뒤 다시 본 list 는 그대로 이긴다(그때는 list 가 실측이다).
    const listIdx = receipts.findLastIndex((r) => r?.actualCall?.tool === 'local.file'
      && (r.failureState ?? 'none') === 'none'
      && r.result?.path === path
      && Array.isArray(r.result?.items));
    const bulkIdx = receipts.findLastIndex((r) => r?.actualCall?.tool === 'local.file'
      && (r.failureState ?? 'none') === 'none'
      && r.result?.from === path
      && r.result?.remainingSource
      && typeof r.result.remainingSource.files === 'number');
    if (bulkIdx > listIdx) {
      remainingSources.push(receipts[bulkIdx].result.remainingSource);
      continue;
    }
    if (listIdx < 0) continue;
    const items = receipts[listIdx].result.items;
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
/**
 * **실패의 기계 원문** (§5-3 a · 오너 승인 2026-08-12 · Hermes model_tools.py `[TOOL_ERROR]` 축 흡수).
 *
 * 예전엔 실패하면 상태 토큰과 사람말 요약만 갔다 — 승격을 막은 게 아니라 내용을 통째로 안 줬고,
 * 모델은 빈자리를 「환경이 막혀서」로 메웠다(cu-c-effect-not-dispatch 실측). 유지하는 계약:
 * 실패 내용을 **사실로 승격하지 않는다** — `확인안됨` 표식을 달아 **주기는 준다**.
 *
 * 정의역은 **실제로 부른 호출**(actualCall 이 있는 영수증)뿐이다. 실행 전에 막힌 것의
 * diagnosticTrace 는 기계 원문이 아니라 커널 내부 분류값(callId·순번·reason)이다 —
 * 그 비노출 봉인(s1-execution-wall:141)은 그대로 선다.
 *
 * 이 칸은 **모델 입력에만 산다.** 저장 봉투(턴 결과·세션 저장·사용자 결과)에서는 걷힌다
 * (turn.js 결과 조립 — 봉인 recovery A·B·B' 가 그 자리를 문다).
 */
const 실패원문상한 = 2000; // Hermes 와 같은 축 — 값은 그쪽 실측을 그대로 쓴다(2,000자 절단)
function 실패원문칸(r) {
  if (!r?.actualCall) return {};
  const 진단 = r.diagnosticTrace;
  const 원문 = 진단 == null ? '' : (typeof 진단 === 'string' ? 진단 : JSON.stringify(진단));
  if (!원문 || 원문 === '{}') return { 확인안됨: true };
  return {
    확인안됨: true,
    실패원문: 원문.length <= 실패원문상한
      ? 원문
      : `${원문.slice(0, 실패원문상한)}…[잘림: 전체 ${원문.length}자 중 앞 ${실패원문상한}자만 실음]`,
  };
}

/**
 * 결과 요약에 **흘린 원문 파일의 문**을 단다(§5-3 c). 흘린 게 없으면 요약 그대로다.
 * 요약(compactResult)은 판단 크기의 사실이고, 흘린 파일은 원문 전체로 가는 문이다 — 둘 다 준다.
 */
function 자료실기(r, 결과자) {
  const 요약 = compactResult(r.result, 결과자 ?? undefined);
  const 흘림 = r.흘린원문;
  if (!흘림?.path) return 요약;
  const 문 = `원문 전체 ${흘림.totalChars}자는 파일로 남겼다: ${흘림.path} — 나머지는 local.file read (offset·limit) 로 이어 읽는다.`;
  return 요약 ? `${요약}\n${문}` : 문;
}

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
    // ── **F-115 · 발화 분류는 사실 공급의 열쇠가 아니다**(오너 지시 2026-08-14) ──────
    //
    // 여기 있던 것은 Phase 2-2 「다이어트」였다: `answerMode === 'fast_chat'` 이면 능력
    // **설명 문장**을 빼고 도구 **이름만** 주고, 한계(`limits`·`scopedLimits`)는 통째로 비웠다.
    // 이유는 "인사 한 마디에 설명서를 실으면 모델이 번호 목록으로 되읊는다"였다.
    //
    // 그 자리가 **손을 못 뻗는 원인**이었다(라이브 4회차 · gpt-5.1 · 터미널 호출 0회).
    //   `순매출.tsv 로 저장해줘` · `파일로 남겨줘` · `합쳐서 요약해줘` · `ERROR 를 세서 알려줘`
    // 넷 다 `fast_chat` 이다 — `저장`·`남겨`·`요약`·`세다` 가 `ACTION_SIGNALS` 에 없어서다.
    // 그 턴에 빠지는 문장 안에 이것이 있었다(`demo-context.js` · `local.terminal`):
    //   *"실행 직전에 확인 카드가 한 번 뜨고, 승인되면 네가 이어서 실행한다 —
    //     **사용자에게 명령어를 적어 주지 않는다.**"*
    // **떠넘김을 막으라고 넣은 문장이, 떠넘김이 나는 턴에는 안 갔다.**
    //
    // 낱말을 더하지 않는다(절대원칙 4 · 목록은 항상 뚫린다 — 다음 낱말에서 또 난다).
    // **계약을 끊는다**: 도구 스키마는 이미 `answerMode` 와 무관하게 전량 간다
    // (`turn.js` · `modelSchemasFor`). 그런데 **그 손을 쓰는 법만** 분류로 빠지고 있었다 —
    // 커널이 대신 고르는 것보다 나쁘다. **고를 재료를 뺏는 것**이기 때문이다.
    // 「강제가 아니라 유도」의 정반대라서, 여기서는 분류를 안 본다.
    //
    // `answerMode` 가 응답의 길이·깊이를 정하는 자리(`model-client.js` · 스트리밍 분기)는
    // 그대로다. 끊은 것은 **사실 공급** 하나다.
    //
    // **캐시는 되레 붙는다**(밟은 사실): 이 세 칸은 `model-provider.js` 의 캐시 경계 **위**
    // (고정 접두)에 앉는다. 분류로 갈리는 동안 안정 접두 지문이 발화마다 2종으로 갈렸고
    // (3,312자 ↔ 4,724자), 잡담과 일이 번갈아 오면 매 턴 접두가 통째로 무효였다 —
    // F-73 이 걷어 낸 것과 같은 병이 발화 축으로 남아 있었다. 항상 실으면 지문이 1종이 된다.
    //
    // 원 주석이 걱정한 *"인사에 능력을 번호 목록으로 되읊는다"* 는 **사실을 지워서** 막을 것이
    // 아니다 — 그건 헌장(묻지 않은 능력 나열 금지)이 무는 자리다. 사실을 지우면 모델은
    // 짐작으로 답한다("슬랙 보낼 수 있어?" 실측).
    readyTools: summary.readyCapabilities ?? summary.ready,
    // ── **한계는 사실이다 — 분류기가 지우지 않는다**(S7 ③ · F-18 · 2026-08-05) ──────
    //
    // 예전 주석은 *"한계는 그 도구가 걸리는 턴에서만 쓸모 있다. 잡담에는 소음이다"* 였다.
    // 그런데 **얼마나 되는지 재 보니 79자**다(메일·슬랙·텔레그램 연결 안내 3줄).
    // 79자를 아끼려고 "무엇을 못 하는지"를 통째로 지우면, 모델은 "슬랙 보낼 수 있어?"에
    // 짐작으로 답한다 — 사실을 안 주면 모델은 사실을 만든다(이 흐름에서 여러 번 밟았다).
    //
    // **F-18 ① 은 플래그를 졸업했다**(F-115). `사실공급(T5_FACTS_UNFILTERED)` 이 켜져야만
    // 서던 이 사실은 이제 기본값이다 — 위 `readyTools` 와 **같은 문**을 타야 하기 때문이다.
    // 플래그는 `context-mesh.js`(F-18 ② · 검증 사례 없는 원칙)에서 계속 산다.
    limits: summary.limits,
    // **손·동사에 걸린 한계**(칸 1). `readyTools` 와 **같은 문**을 탄다 — 능력 설명이 실리는
    // 턴에는 그 한계도 함께 실려야 한다. 둘을 갈라 놓으면 모델은 능력만 읽거나 한계만 읽고,
    // 그게 성질 1(자기 손을 모른다)과 거짓 한계를 동시에 만든다.
    scopedLimits: summary.scopedLimits ?? [],
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
    // **②가 새로 들어왔다**(2026-08-07 · 노드 R · 판 ③⑤⑬ 전부 원장 0).
    // 예전엔 ①(무엇을 얻을지) 다음이 바로 대조였다 — **얻으러 가는 걸음이 없었다.**
    // 그 빈칸을 모델이 *"사용자에게 물어야 한다"* 로 메웠다. ⑤ 라이브가 그 증거다:
    // *"컴퓨터에 있는 정산 파일을 읽어서 계산해 드려야 해요"* 라고 **말해 놓고 안 읽고**
    // 사장님께 *"가능한 방법 두 가지"* 를 설명했다. 무엇을 할지는 알았고 안 뻗은 것이다.
    // **③이 새로 들어왔다**(2026-08-11). 손 스물여덟이 의미별 이름으로 먼저 잡히니
    // 셸이 마지막 수단처럼 놓였다 — "엑셀 만들어줘"가 「생성 부품 0건」으로 끝났는데
    // 실측으로는 셸에서 그냥 만들어진다(zip+XML · textutil · cupsfilter). 전용 손이 없다는
    // 것과 못 한다는 것은 다르다. 한 줄로 적는다 — 능력을 산문으로 설명하는 것이 결함이다.
    도구쓰는순서: '① 무엇을 얻으면 답이 되는지 먼저 정한다'
      + ' ② 그것이 이 컴퓨터·화면·브라우저 안에 있으면 **먼저 손으로 찾아본다** —'
      + ' 어디 있는지 묻기 전에 찾는다. 확인을 물으면 기억으로 답하지 말고 다시 보고 답한다'
      + ' ③ 이 컴퓨터에서 되는 일은 터미널로 먼저 해본다 — 전용 손이 없어도 명령으로 되는 일이 많다'
      + ' ④ 결과가 그것을 줬는지 대조한다'
      + ' ⑤ 못 얻었으면 질의 문구를 바꾸지 말고 다음수단·다른후보로 출처를 바꾼다'
      + ' ⑥ 끝내야 하면 무엇을 못 얻었는지 말한다(사용자에게 대신 찾아보라고 넘기지 않는다)',
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
    // §7-bs 순수 사실 칸 — tc 는 명시 복사만 하므로 여기서 잇는다(안 이으면 조용히 떨어진다).
    산출물사실: p.산출물사실 ?? [],
    // 국면 4 슬라이스 2 — 지금 사용자 결정을 기다리는 카드. **사실이지 지시가 아니다.**
    승인대기카드: p.승인대기카드 ?? [],
    projectWorkState: p.projectWorkState,
    // F-65: runtime이 실제로 관측한 bounded 현재 작업셋. 허용 범위 자체와 구분하며,
    // 목록 실패/절단도 그대로 보존한다. 판단이나 도구 순서는 포함하지 않는다.
    worksetReality: p.worksetReality,
    // L6: 같은 principal의 canonical 자동화 저장소·실행 원장에서 투영한 bounded 현실.
    automationReality: p.automationReality,
    automationControl: p.automationControl,
    // 서버가 아는 실행 현실. 주소·경로·포트 같은 내부값은 싣지 않고 사용자에게 의미 있는
    // 경계만 준다. 모델이 자기 호스팅 환경을 출신 지식으로 추측하지 않게 한다.
    runtimeEnvironment: p.runtimeEnvironment,
    // **지금 언제, 어디인가.** OS 는 이걸 안다. 안 주면 모델은 "오늘"이 언제인지 몰라 되묻거나
    // 엉뚱한 날짜로 답한다(실측: "미국 기준 오늘인 7월 26일을 말씀하신 거라면…").
    // 지역도 마찬가지 — 사실이 없으니 "어느 지역이요?"를 매번 물었다. 규칙이 아니라 사실이 부족했다.
    now: p.now ?? nowFacts(),
    selfStateFacts,
    // **어떤 손이 붙었는가** — 손마다 다른 사용법을 실을 때 이걸 본다(화면 손이 그렇다).
    // 이 줄이 없어서 `화면다루는법(tc.connectedTools)` 은 늘 `undefined` 를 받았고,
    // 어제 만든 안내가 **한 번도 모델에게 간 적이 없다**(라이브 2026-08-06 · 스크롤을
    // 가르쳐도 T5 는 *"윤님이 캡처해서 보내 주세요"* 라고 답했다).
    // **id 만 간다** — 사용법을 고르는 데 필요한 건 그것뿐이고, 라벨·상태는 이미
    // `selfStateFacts` 가 준다(두 벌로 주면 서로 어긋난다).
    connectedTools: (p.selfState?.connectedTools ?? []).map((t) => t?.id).filter(Boolean),
    admittedContext: p.admittedContext ?? [],
    // **문장만 나르면 신분이 죽는다**(노드 K · 판 ④ 0/3). `context-mesh.js` 가 `kind` 를
    // 달아 주는데 `turn.js` 가 `statement` 만 뽑아 왔다 — 그래서 *"아침에 보리차를 마셨다"*
    // 같은 **사실**이 저장된 **명령**과 같은 격리 딱지를 받았고, 모델이 그걸 읽고 버렸다.
    // 실려 갔는데도 *"볼 방법이 없어요"* 라고 답한 자리다.
    //
    // **`kind` 와 `statement` 만 추린다.** 원본을 통째로 넘기면 내부 신분(`id`)이 따라와
    // 모델 입력에 샌다 — S5 봉인이 그 자리를 문다(실측: 이 수정의 첫 판이 걸렸다).
    // 필요한 것은 *"이 문장이 지시냐 사실이냐"* 하나뿐이다.
    // **앞 턴에 한 것을 앞 턴 것으로 준다**(노드 K · 판 ③ · 라이브 2026-08-07).
    //
    // 원장이 **완전히 빈** 턴에 T5 가 *"방금 실제 파일 다시 열어서 확인해 봤어요"* 라고 답했다.
    // `[이번 턴 실행 사실] 없음` 은 프롬프트에 실렸는데도 그랬다 — 모델이 보는 것이 둘뿐이라
    // 그렇다: ① 이번 턴에 아무것도 안 했다 ② 대화 이력에 파일 내용이 있다.
    // **앞 턴에 그것을 읽었다는 사실이 어디에도 없어서** ②를 ①의 빈자리에 끌어다 놓는다.
    //
    // 금지 문구를 세게 쓰는 길은 막혀 있다(⛔ · F-12). **구분할 재료를 준다.**
    // 최근 것만 준다 — 세션 전체를 실으면 이번 턴 사실이 밀린다.
    priorFacts: (p.priorReceipts ?? []).slice(-6).map((r) => ({
      summary: r?.userSafeSummary ?? '',
      확인됨: (r?.failureState ?? 'none') === 'none',
    })).filter((f) => f.summary),
    admittedRich: (p.admittedRich ?? [])
      .filter((e) => e?.statement)
      .map((e) => ({ kind: e.kind, statement: e.statement })),
    // **만든 것을 모델이 알아야 한다**(판 ⑦ 0/3). 예약 후보는 `turn.js` 에서 만들어져
    // 표면까지 가는데 모델 프롬프트에는 한 번도 안 갔다 — T5 가 만들어 놓고
    // *"스스로 먼저 말 걸 수 없어요"* 라고 답했다(거짓 실패).
    ...(p.automationProposal ? { automationProposal: p.automationProposal } : {}),
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
        // 객체가 안 맞으면 **호출 신분**으로 찾는다(같은 그림을 두 열쇠로 걸어 둔다).
        ...((() => {
          const g = 그림들.get(r)
            ?? (호출.providerCallId ? 그림들.get(호출.providerCallId) : undefined)
            ?? (호출.callRef ? 그림들.get(호출.callRef) : undefined);
          return g ? { 그림: g } : {};
        })()),
        // 실패한 호출의 결과는 확인된 값이 아니다 — `data` 로 승격하지 않고 상태를 준다.
        // 결과 상한은 창 예산의 파생값이다(노드 W) — 창을 알면 원문이 접히지 않고 간다.
        //
        // §5-3 a(오너 승인 2026-08-12): 실패의 **기계 원문은 준다** — `확인안됨` 표식과 함께
        // (`실패원문칸`). 2026-08-11 되돌림 때 물렸던 봉인 셋과는 밭을 갈라 공존한다:
        //   · s1-execution-wall:141 — 정의역 밖(부르지 않은 호출에는 원문 칸을 만들지 않는다)
        //   · recovery A·B·B'      — 저장 봉투에서 걷는다(turn.js 결과 조립이 `실패원문`을 뺀다)
        ...(실패
          ? { failureState: r.failureState, ...실패원문칸(r) }
          : { data: 자료실기(r, p.창예산?.결과자) }),
        // 실패라는 한 단어로 제출 전 거절과 제출 뒤 미확인을 뭉개지 않는다. 도구가
        // 영수증에 남긴 진행 사실만 싣는다. 결과 원문·diagnosticTrace·그림 수명은
        // 각각 기존 실패원문/진단면/옆길 계약을 그대로 타며 이 칸으로 승격되지 않는다.
        ...(실패 && r.진행 ? { 진행: r.진행 } : {}),
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
        // **빈손으로 돌아온 걸음도 여기 든다**(F-107 · 오너 지시 2026-08-13).
        //
        // 오너 정본: *"**강제가 아니라 유도**야. 모델 다루는 법을 절대 잊지마.
        // 엘엘엠을 깡통으로 만드는건 한순간이니까."* — 그래서 여기서 **아무것도 시키지
        // 않는다.** 새 규칙도 분기도 없다. 고치는 것은 **같은 사실의 눈에 띄는 정도** 하나다.
        //
        // 밟은 비대칭: 손이 막히면 「안 가 본 곳」이 `다음길줄` 을 타고 **문장**으로 간다.
        // 그런데 껍데기를 물고 온 걸음은 `failureState:'none'` 이라 이 문을 그냥 지나가고,
        // 같은 사실이 결과 JSON 덩어리 **안에만** 남는다. 사용자 자리에서 둘은 같은 일인데
        // (목적이 한 걸음 앞에서 멈춘다) 한쪽만 잘 보인다. 그 기울기를 편다.
        //
        // 고르는 것은 여전히 모델이다 — 커널은 **볼 것을 같은 무게로 놓기만** 한다.
        ...((실패 || 빈손으로돌아왔나(r)) ? 막힌자리메우기(r, { 턴후보, 이미가본곳 }) : {}),
        ...(r.막힌곳?.length ? { 막힌곳: r.막힌곳 } : {}),
      };
    });
    if (앞턴교환.length) {
      // E1(4단계 · PM 승인 2026-08-09): 앞 턴 교환을 이번 턴 규약 메시지로 **재생하지 않는다.**
      // 규약 모양(도구 호출 메시지)에는 시제가 없어, 모델 눈에 지난 턴 읽기가 "방금 내가
      // 부른 호출"로 선다 — 회차 G~M 턴2의 원장-0 현재형 서사("지금 다시 읽어서 계산했어")의
      // 재료다(M-1). 같은 입력에 "[이번 턴 실행 사실] 없음"이 공존하는 자기모순(F-48)도
      // 이 합류가 만든다. 계약 ②(행동 이력은 모델에게 돌아간다)는 지운 게 아니라 **시제가
      // 박힌 밭으로 옮겼다** — 아래 priorExchange 를 model-provider 가 "[앞선 턴에서 한 것]"
      // 딱지 아래 싣는다. 신분·인자 요약은 남기고, 결과 원문(data)은 안 싣는다 — 확인을
      // 물으면 다시 보는 것이 맞는 행동이고, 원문이 손에 있으면 말로 때운다(같은 블록의 계약).
      const 이번신분 = new Set(packet.turnExchange.map((x) => x.providerCallId ?? x.ref));
      packet.priorExchange = 앞턴교환
        .filter((x) => !이번신분.has(x?.providerCallId ?? x?.ref))
        .slice(-8)
        .map((x) => ({
          summary: String(x?.summary ?? ''),
          ...(x?.tool ? { tool: x.tool } : {}),
          ...(x?.args ? { calledWith: JSON.stringify(x.args).slice(0, 160) } : {}),
          // **신분은 계약 ② 의 핵심이다** — 모델은 이 신분으로 자기 행동을 잇는다.
          // 규약 재생을 걷어도 신분은 시제 딱지 밭으로 그대로 간다(봉인 넷이 이걸 문다).
          ...(x?.providerCallId ? { providerCallId: x.providerCallId } : {}),
          ...(x?.ref ? { ref: x.ref } : {}),
          // **된 것과 안 된 것을 한 얼굴로 만들지 않는다**(J2 · 지도 §12).
          //
          // 여기서 상태를 안 옮기면 model-provider 가 앞선 것들을 **전부 `확인됨:true`** 로
          // 세웠다. 그래서 「그 창 띄웠어요」와 「그 창을 못 띄웠어요」가 같은 표식 없는 줄로
          // 나란히 섰고, 모델은 지난 턴 실패를 **한 일**로 읽었다(라이브: *"내가 아까 어떤 식당
          // 검색해 달라고 했지?"* 에 없는 기억을 사실처럼 답한 회차의 재료).
          //
          // 옮기는 것은 **상태 토큰 하나**다. 결과 원문(`data`)·실패 원문은 그대로 안 싣는다 —
          // 바로 위 E1 계약이다(원문이 손에 있으면 모델은 다시 안 보고 말로 때운다).
          ...((x?.failureState ?? 'none') !== 'none' ? { failureState: x.failureState } : {}),
        }))
        .filter((f) => f.summary);
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
      // 흘린 원문 파일이 있으면 그 문(경로·전체 크기)도 함께 간다(§5-3 c).
      data: 자료실기(r, p.창예산?.결과자),
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
