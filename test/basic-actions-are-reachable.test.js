// **기본 동작을 준다** (UX 기획 §2 조각 B · 2026-08-12).
//
// 조사가 낸 것: 복사 0 · 수정 0 · 재생성 0 · 코드블록 복사 0 · Esc 0 · ⌘K 0.
// 그리고 멈춤은 **있는데 안 보였다**(투명 배경 · 회색 글자).
// *"새 화면을 만들지 않는다"* 는 옳은 원칙이 **서버 상태를 하나도 안 만드는 기본 동작**까지
// 삼킨 자리다 — 이 넷은 「죽은 버튼」이 될 수 없는 것들이다.
//
// 이 검사가 지키는 것은 **버튼이 있다**가 아니라 **없어야 할 때 없다**와
// **조각 A 를 안 깬다** 둘이다. 있는 것은 눈으로 보이고, 없는 것은 안 보인다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../src/surface/web/index.html', import.meta.url), 'utf8');

/**
 * 조각 B 가 덧붙인 자바스크립트 블록만 잘라 낸다 — 다른 조각의 코드를 자기 증거로 쓰지 않게.
 * **못 찾으면 빈 문자열을 낸다**(여기서 throw 하지 않는다). throw 하면 파일이 통째로 하나의
 * 실패가 되어 **아래 검사 아홉이 각각 무는지를 아무도 못 본다** — 선빨강이 「1건 실패」로
 * 뭉개지면 그건 아홉 개를 잰 것이 아니라 하나를 잰 것이다(빈 측정 · F-95 에서 밟았다).
 */
const B블록 = (() => {
  const 시작 = html.indexOf('// ── 조각 B · 기본 동작을 준다');
  if (시작 < 0) return '';
  const 끝 = html.indexOf('// 초기화: 세션 목록', 시작);
  return 끝 > 시작 ? html.slice(시작, 끝) : '';
})();

test('조각 B 블록이 index.html 안에 있다 — 없으면 아래 검사가 아무것도 못 지킨다', () => {
  assert.ok(B블록.length > 0, '조각 B 블록을 못 찾았다');
});

// ── ① 조각 A 와 부딪히지 않는다 ─────────────────────────────────────────────
// 조각 A 의 `겹쳐맞추기` 는 흐르는 동안 말풍선의 자식 노드를 제자리 맞춤한다. 말풍선 **안**에
// 버튼을 넣으면 다음 조각에 지워지고, A 반대시험 ⑥(화면 DOM == renderMarkdown 출력)이 깨진다.
// ★ 2026-08-12 오너 지적으로 **무는 사실이 바뀐 자리**(무르게 한 것이 아니라 더 세졌다).
//   첫 판은 호버해야 뜨는 떠 있는 막대였다. 오너가 새 화면을 받고 처음 한 말이
//   *"뭐가 변한 게 하나도 없는 것 같은데?"* 였다 — **있는데 안 보이면 없는 것과 같다.**
//   멈춤이 투명 배경·회색 글자였던 것과 정확히 같은 병을, 그걸 고치면서 새로 만들었다.
//   그래서 이제 문는다: 기본 동작은 **말풍선 아래에 늘 서 있는 줄**이어야 하고, 호버로만
//   나타나면 안 된다. 떠 있는 막대는 코드블록 하나에만 남는다.
test('기본 동작은 **늘 보이는 줄**이다 — 호버해야 나타나면 없는 것과 같다', () => {
  assert.match(B블록, /function 동작줄\(상자, 대상, 종류\)/, '아래에 놓는 줄이 있어야 한다');
  assert.match(html, /동작줄\(box, 내말, 'me'\)/, '사용자 발화 아래에 줄이 서야 한다(투영·전송 두 자리)');
  assert.match(html, /동작줄\(box, bot, 'bot'\)/, '답 아래에 줄이 서야 한다');
  // 늘 보이는 것이 기본이고, 호버는 **진하게만** 한다 — 나타나게 하는 것이 아니다.
  assert.match(html, /\.turn:hover \.acts button \{ color:var\(--fg\); \}/, "호버는 진하게만 한다");
  assert.match(html, /opacity:1; cursor:pointer/, "쉬는 상태를 흐리게 두면 호버 규칙을 투명도로 다시 만든 것이다");
  assert.doesNotMatch(html, /\.acts \{[^}]*display:none/, '줄을 숨기면 첫 판의 병으로 돌아간다');
  // 호버 막대에 남는 것은 코드블록뿐이다.
  const 호버 = B블록.slice(B블록.indexOf("logEl.addEventListener('pointerover'"));
  assert.doesNotMatch(호버.slice(0, 500), /\.msg\.me|\.msg\.bot/,
    '말풍선을 다시 호버로 돌리면 오너가 지적한 그 자리로 돌아간다');
});

test('동작 막대는 말풍선 안이 아니라 body 에 뜬다 — 조각 A 의 겹쳐맞추기와 안 부딪힌다', () => {
  assert.match(B블록, /document\.body\.appendChild\(손바\)/,
    '막대는 body 에 붙어야 한다 — 말풍선·대화상자 안에 넣으면 흐르는 중에 지워진다');
  // 아래 줄도 말풍선 **밖**이어야 한다 — 안에 넣으면 흐르는 동안 겹쳐맞추기가 지운다.
  assert.match(B블록, /대상\.parentNode\?\.insertBefore\(줄, 대상\.nextSibling\)/,
    '줄은 말풍선이 아니라 **턴 상자**에 붙는다');
  assert.doesNotMatch(B블록, /\.innerHTML\s*=/,
    '조각 B 는 innerHTML 을 쓰지 않는다 — 모델 텍스트가 들어가는 자리는 renderMarkdownInto 하나뿐이다');
  const css = html.slice(html.indexOf('#actbar {'), html.indexOf('#actbar {') + 400);
  assert.match(css, /position:fixed/,
    'fixed 가 아니면 대화 높이(scrollHeight)에 끼어들어 조각 A 의 따라가기 계산을 흔든다');
});

test('복사는 그린 글자가 아니라 **모델이 쓴 원문**을 준다 — 속성이 아니라 JS 속성으로 단다', () => {
  assert.match(html, /bot\.__원문 = 답문;/,
    '답 상자에 원문을 달아야 표·코드·목록이 붙여넣는 자리에서 산다');
  assert.doesNotMatch(html, /setAttribute\(['"]data-원문/,
    '속성으로 달면 조각 A 의 속성맞추기가 새것 기준으로 지운다(흐르는 중 사라진다)');
  assert.match(B블록, /대상\.__원문 \?\? 대상\.innerText/,
    '원문이 없으면(흐르는 중 미리보기) 화면 글자로 물러선다 — 복사가 그때도 돼야 한다');
});

// ── ②③④ 죽은 버튼 금지 — **없어야 할 때 없다** ──────────────────────────────
test('클립보드를 못 쓰는 브라우저에서는 복사 버튼을 아예 안 만든다', () => {
  assert.match(B블록, /const 복사가능 = !!\(navigator\.clipboard && navigator\.clipboard\.writeText\)/,
    '있는지부터 물어야 한다 — 눌러 보고 실패하는 버튼이 죽은 버튼이다');
  assert.match(B블록, /if \(종류 !== 'code' \|\| !복사가능\) return false;/,
    '코드블록 갈래도 같은 자로 막아야 한다');
  assert.match(B블록, /if \(복사가능\) 줄\.appendChild\(아이콘\('⧉'/,
    '아래 줄도 복사가능 일 때만 복사 아이콘을 세운다');
});

test('앞선 사용자 발화를 못 찾으면 「같은 질문 다시」가 안 선다', () => {
  assert.match(B블록, /function 앞선발화\(답\)[\s\S]*?return null;/,
    '못 찾으면 null 을 내야 한다 — 지어낸 질문을 다시 보내지 않는다');
  assert.match(B블록, /if \(앞선발화\(대상\) && !흐르는중\(\)\) \{/,
    '앞선 발화가 있을 때만 「같은 질문 다시」를 세운다');
});

test('답이 흐르는 중에는 새 턴을 여는 버튼이 안 서고, 서 있었더라도 누를 때 다시 본다', () => {
  assert.match(B블록, /const 흐르는중 = \(\) => !!document\.querySelector\('\.stopbtn'\)/,
    '멈춤 버튼의 존재가 곧 「지금 턴이 돈다」는 사실이다(따로 상태를 안 만든다)');
  assert.match(B블록, /if \(흐르는중\(\)\) \{ toast\(/,
    '막대를 띄운 뒤에 답이 시작될 수 있다 — 누르는 순간에 한 번 더 봐야 한 대화에 두 턴이 안 겹친다');
});

// ── ⑤ 멈춤이 배경에 안 묻힌다 ──────────────────────────────────────────────
test('멈춤은 있는 버튼의 조를 올린다 — 새 버튼을 만들지 않는다', () => {
  const 자리 = html.lastIndexOf('.stopbtn {');
  assert.ok(자리 > html.indexOf('/* ── 조각 B'), '조각 B 의 덧붙임은 <style> 맨 끝에 있어야 한다(§1 규약)');
  const 조 = html.slice(자리, 자리 + 260);
  assert.match(조, /background:var\(--bot\)/, '투명 배경이 배경에 묻힌 원인이다');
  assert.match(조, /color:var\(--fg\)/, '회색 글자(--muted)로는 답이 흐르는 동안 눈에 안 들어온다');
  assert.match(조, /border-color:var\(--line-strong\)/, '연한 테두리도 같은 이유로 올린다');
  // 있는 버튼을 고친 것이지 새로 만든 것이 아니다 — 새 멈춤 버튼이 생기면 안 된다.
  // ⚠ 첫 판은 `el('stopbtn')` 글자를 세다가 **내가 쓴 주석까지 세어** 스스로 빨개졌다.
  //   세는 자는 코드와 주석을 갈라야 한다 — 만드는 자리는 대입문 하나다.
  assert.equal((html.match(/const 멈춤 = el\('stopbtn'\)/g) || []).length, 1,
    '멈춤 버튼을 만드는 자리는 하나뿐이어야 한다');
});

// ── ⑥ Esc 는 한 번에 하나만 ────────────────────────────────────────────────
test('Esc 는 한 번에 하나만 닫는다 — 무엇이 닫혔는지 사용자가 안다', () => {
  const esc = B블록.slice(B블록.indexOf("if (e.key !== 'Escape') return;"));
  const 갈래 = esc.split('\n').filter((l) => /^\s*if \(.*\) \{ e\.preventDefault\(\);/.test(l));
  assert.ok(갈래.length >= 4, `Esc 갈래가 넷 이상이어야 한다(멈춤·설정·도구함·찾기) — 지금 ${갈래.length}`);
  for (const l of 갈래.slice(0, -1)) {
    assert.match(l, /return;\s*\}$/, `갈래가 return 으로 안 끝나면 한 번에 둘이 닫힌다: ${l.trim()}`);
  }
  // 순서가 곧 우선순위다 — 돌고 있는 일을 세우는 것이 맨 앞이어야 한다.
  // (2026-08-12 · 조각 F 가 화면 닫기를 통로로 옮겼다. 지키는 사실은 그대로이고 **비교 대상만**
  //  `closeSettings()` 에서 통로 호출로 바뀐다 — 이름을 하나씩 적지 않는 것이 F 의 요지다.)
  const 통로닫기 = esc.indexOf('오버레이닫기(열린것');
  assert.ok(통로닫기 > 0, '화면 닫기가 Esc 갈래에 없다');
  assert.ok(esc.indexOf('멈춤.click()') < 통로닫기, '돌고 있는 일이 있으면 그것부터 세운다');
});

// 라이브에서 잡은 자리다(2026-08-12). 첫 판은 `.stopbtn:not(:disabled)` 로 걸렀는데,
// `.stopbtn` 은 `el('stopbtn')` 이 만든 **div** 라 `:disabled` 가 절대 안 맞는다 —
// 이미 「멈추는 중」인 턴에서도 그 갈래가 먹어 **Esc 가 아무것도 못 닫았다.**
// 검사로 세우지 않으면 다음 사람이 같은 선택자를 다시 쓴다.
test('멈춤 상태는 선택자가 아니라 속성으로 본다 — .stopbtn 은 button 이 아니라 div 다', () => {
  assert.match(html, /const 멈춤 = el\('stopbtn'\)/,
    '멈춤을 div 로 만든다는 사실이 이 검사의 근거다 — button 으로 바뀌면 이 검사를 다시 본다');
  assert.doesNotMatch(B블록, /stopbtn:not\(:disabled\)/,
    ':disabled 는 폼 요소에만 붙는다 — div 에는 안 맞아 늘 참이 된다');
  assert.match(B블록, /querySelectorAll\('\.stopbtn'\)\]\.find\(\(b\) => !b\.disabled\)/,
    '속성을 직접 봐야 「이미 멈추는 중」이 갈린다');
});

test('⌘K 는 대화 찾기, ⌘Enter 는 보내기 — 이미 있는 것의 입구지 새 기능이 아니다', () => {
  assert.match(B블록, /\(e\.metaKey \|\| e\.ctrlKey\) && \(e\.key === 'k' \|\| e\.key === 'K'\)[\s\S]{0,80}toggleSearch\(\)/,
    '⌘K 는 이미 있는 검색 패널을 연다(새 화면을 만들지 않는다)');
  assert.match(B블록, /\(e\.metaKey \|\| e\.ctrlKey\) && e\.key === 'Enter'[\s\S]{0,80}submit\(\)/,
    '⌘Enter 는 이미 있는 submit 을 부른다');
});

// ── ⑦ 수정은 삭제가 아니라 분기다 ──────────────────────────────────────────
test('고쳐 다시 보내기는 위의 말과 답을 안 지운다 — 그리고 그 사실을 사용자에게 말한다', () => {
  const 시작 = B블록.indexOf("'고쳐 다시 보내기'");
  const 갈래 = B블록.slice(시작, 시작 + 500);
  assert.doesNotMatch(갈래, /remove\(\)|innerHTML|deleteTurn|삭제/,
    '고치기가 앞의 말·답을 지우면 「언제든 원래 것으로 돌아갈 수 있다」가 깨진다');
  assert.match(갈래, /toast\(/, '그 아래 답이 어떻게 되는지 말해 줘야 한다(반대시험 ③)');
  assert.match(갈래, /위의 말과 답은 그대로 남아요/, '무엇이 남는지를 사용자 언어로 적는다');
});
