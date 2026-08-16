// **손이 한 일이 남는다** (UX 기획 §2 조각 D · 2026-08-12).
//
// 조사가 낸 것: `partial_result` 는 답이 시작되면 **통째로 삭제**되고, 끝나면 접힌 줄 하나만
// 남는데 그 안쪽은 셋을 `'; '` 로 이어 붙인 한 덩이 글이었다. 그래서 둘이 동시에 일어났다 —
// 팀원은 *"진행을 본 적이 없다"* 고 했고, 펼쳐도 **실패한 손이 성공한 것과 같은 글자**로 섰다.
//
// 이 조각의 규율은 기획 §6-1 관통 원칙이다: **판단에 꼭 필요한 최소치만 1차 화면에.**
// 그래서 답은 「남긴다」가 아니라 **「접어서 남긴다」**다 — 지우면 못 보고, 펼쳐 두면 잔소리다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../src/surface/web/index.html', import.meta.url), 'utf8');

/** 이름 있는 함수 하나의 본문(다음 줄머리 `}` 까지) — 조각 A 검사와 같은 방식. */
function 본문(머리) {
  const at = html.indexOf(머리);
  if (at < 0) return '';
  const 뒤 = html.slice(at);
  return 뒤.slice(0, 뒤.indexOf('\n}') + 2);
}

// ── ① 지우지 않는다. 접는다 ────────────────────────────────────────────────
test('검증 전 답이 시작돼도 걸음들을 지우거나 접지 않는다', () => {
  const 답시작 = html.slice(html.indexOf("if (!preview) {"), html.indexOf("previewText += piece;"));
  assert.ok(답시작.length > 0, 'answer_delta 의 첫 조각 갈래를 못 찾았다');
  assert.doesNotMatch(답시작, /steps\?\.remove\(\)/,
    '지우면 「진행을 본 적이 없다」로 돌아간다 — 정보가 없었던 게 아니라 사라진 것이었다');
  assert.doesNotMatch(답시작, /걸음접기\(\)/,
    '검증 전 답은 화면에 안 보이므로, 확인된 걸음을 접어 자리를 내줄 이유가 없다');
  assert.match(답시작, /data-unverified-answer/, '검증 전 답은 내부 누적기에만 있어야 한다');
});

test('접힌 것은 **기본이 닫힘**이다 — 잔소리를 늘리지 않는다', () => {
  const 접기 = html.slice(html.indexOf('const 걸음접기 ='), html.indexOf('const 걸음접기 =') + 900);
  assert.match(접기, /걸음몸\.classList\.remove\('open'\)/, '접는 순간 안쪽은 닫혀 있어야 한다');
  assert.match(접기, /steps\.classList\.add\('folded'\)/, '접힘 표시가 붙어야 CSS 가 안쪽을 감춘다');
  assert.match(html, /\.msg\.steps\.folded \.steps-body \{ display:none; \}/,
    '접힘 표시가 실제로 안쪽을 감춰야 한다 — 클래스만 붙고 안 감추면 아무것도 안 접힌 것이다');
  assert.match(접기, /머리\.onclick/, '펼 수 있어야 「접었다 편다」가 성립한다');
});

// 라이브에서 잡은 자리다(2026-08-12). 줄 배치를 주려고 `.record .body.rows` 에
// `display:flex` 를 썼는데, 그게 위의 `.record .body { display:none }` 보다 specificity 가
// 높아 **기록이 늘 펼쳐진 채로 섰다** — 「기본은 접힌 한 줄」이 그 자리에서 깨졌다.
// 코드만 읽는 검사로는 못 잡는 종류라(계산된 스타일을 재야 보인다) 규칙 자체를 못 박는다.
test('줄 배치가 접힘을 이기지 않는다 — .body.rows 는 display 를 안 건드린다', () => {
  const 줄 = html.split('\n').find((l) => l.includes('.record .body.rows {'));
  assert.ok(줄, '.record .body.rows 규칙을 못 찾았다');
  assert.doesNotMatch(줄, /display:/,
    '여기서 display 를 주면 기본 display:none 을 이겨 기록이 늘 펼쳐진다(라이브에서 밟았다)');
  assert.match(html, /\.rec-row \+ \.rec-row \{ margin-top:/,
    '줄 간격은 flex 의 gap 이 아니라 이웃 여백으로 준다 — 그래야 display 를 안 건드린다');
});

test('접힌 이름은 **숫자가 아니라 첫 사실**이다', () => {
  const 이름 = 본문('const 걸음이름 = () => {');
  assert.match(이름, /걸음말\[0\]/, '첫 사실을 이름으로 올린다');
  assert.doesNotMatch(이름, /걸음 \$\{|도구 \$\{/,
    '「걸음 3개」는 참이지만 사용자가 알고 싶은 것이 아니다(대리지표 · 오너 결정 2026-08-03)');
  assert.match(이름, /외 \$\{나머지\}건/, '나머지가 있으면 몇 건이 더 있는지는 말한다');
});

test('접힌 뒤에 온 걸음도 이름에 센다 — 「외 N건」이 낡지 않는다', () => {
  assert.match(html, /걸음이름갱신\(\);/, '걸음이 붙을 때마다 이름을 다시 세운다');
  assert.match(html, /const 걸음이름갱신 = \(\) => \{ if \(걸음머리글\)/,
    '접히기 전에는 머리가 없다 — 그때는 아무것도 안 한다');
});

// ── ② 실패한 손이 성공한 것과 구별된다 ──────────────────────────────────────
test('기록을 펼치면 **한 걸음 한 줄**이다 — 한 덩이 글이 아니다', () => {
  const rec = 본문('function renderRecord(box, ledger) {');
  assert.ok(rec.length > 0, 'renderRecord 를 못 찾았다');
  assert.doesNotMatch(rec, /join\('; '\)/,
    "';' 로 이어 붙이면 걸음 경계가 사라져 펼쳐도 무엇이 몇 건인지 안 보인다");
  assert.match(rec, /body\.classList\.add\('rows'\)/, '줄 배치로 세운다');
  assert.match(rec, /줄놓기\(ledger\.confirmed[\s\S]*줄놓기\(ledger\.unconfirmed[\s\S]*줄놓기\(ledger\.estimated/,
    '세 배열을 각각 줄로 놓는다 — 새 데이터를 만들지 않는다');
});

test('미확인·추정은 **색만이 아니라 말로도** 갈린다', () => {
  const rec = 본문('function renderRecord(box, ledger) {');
  assert.match(rec, /줄놓기\(ledger\.unconfirmed, 'unk', '○', '미확인'\)/,
    '못 한 일에는 「미확인」 꼬리표가 붙어야 한다');
  assert.match(rec, /줄놓기\(ledger\.estimated, 'est', '◌', '추정'\)/,
    '추정도 확인과 갈려야 한다');
  assert.match(rec, /줄놓기\(ledger\.confirmed, 'ok', '●', ''\)/,
    '확인된 것에는 꼬리표를 안 붙인다 — 기본이 확인이다');
  // 색만으로 가르면 색을 못 보는 사람에게는 성공과 같은 줄이 된다.
  assert.match(html, /\.rec-row \.tag \{/, '꼬리표가 실제로 스타일을 갖는다');
  assert.match(html, /\.rec-row\.unk \.m \{ color:var\(--warn\); \}/, '표식 색도 함께 준다(색은 보조다)');
});

test('OS 가 만든 문장을 HTML 로 해석하지 않는다 — 줄로 바꾸면서 그 규율을 안 놓쳤다', () => {
  const rec = 본문('function renderRecord(box, ledger) {');
  assert.doesNotMatch(rec, /innerHTML/,
    '기록 본문은 원장 문장이다 — innerHTML 로 넣으면 그 문장 안의 꺾쇠가 태그가 된다');
  assert.match(rec, /t\.textContent = String\(말\)/, '글자로만 넣는다');
});

// ── ③ 조각 A·B 를 안 깬다 ──────────────────────────────────────────────────
test('조각 A 의 미리보기 상자와 따라가기를 안 건드렸다', () => {
  assert.match(html, /preview\.className = 'msg bot';/,
    '조각 A 가 세운 「미리보기는 최종 답과 같은 조」가 그대로 있어야 한다');
  const 답시작 = html.slice(html.indexOf("if (!preview) {"), html.indexOf("previewText += piece;"));
  assert.doesNotMatch(답시작, /scrollTop|scrollHeight/,
    '조각 D 는 스크롤을 안 만진다 — 그 자리는 조각 A 것이다');
});
