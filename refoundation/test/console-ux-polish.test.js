import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const htmlUrl = new URL('../ui/index.html', import.meta.url);

test('메시지 복사와 사용자 입력 불러오기는 canonical 원문을 사용하고 과거 기록을 덮어쓰지 않는다', async () => {
  const html = await readFile(htmlUrl, 'utf8');
  assert.match(html, /function appendMessageActions/u);
  assert.match(html, /navigator\.clipboard\.writeText\(raw\)/u);
  assert.match(html, /appendMessageActions\(box, e\.text, \{ editable: true/u);
  assert.match(html, /appendMessageActions\(box, 답문\)/u);
  assert.match(html, /입력창에 불러와 수정/u);
  assert.doesNotMatch(html, /sessions\/edit-message|transcript\/rewrite/u);
});

test('도구가 없으면 활동 피드를 열지 않고 실제 도구·영수증 사건만 누적한다', async () => {
  const html = await readFile(htmlUrl, 'utf8');
  assert.match(html, /trace\.hidden = true;[\s\S]*box\.appendChild\(trace\)/u);
  assert.match(html, /tool_progress', \(e\) => showCurrent\(e, true\)/u);
  assert.match(html, /activity_event/u);
  assert.match(html, /appendActivityFact/u);
  assert.match(html, /while \(events\.children\.length > 6\)/u);
  assert.match(html, /trace\.hidden = true;[\s\S]*preview = document\.createElement/u);
});

test('대화 검색은 전체 원문 결과를 열기만 하고 Memory 반영 UI를 만들지 않는다', async () => {
  const html = await readFile(htmlUrl, 'utf8');
  const start = html.indexOf('function renderQResults');
  const end = html.indexOf('// ── 도구함', start);
  const source = html.slice(start, end);
  assert.match(source, /r\.snippet/u); assert.match(source, /selectSession\(r\.sessionId\)/u);
  assert.doesNotMatch(source, /반영하기|search\/admit|memory\/rollback/u);
  assert.match(html, /aria-label="전체 대화에서 찾기"/u);
});

test('선택 보기별 일괄 동작과 HTTP 실패 보존 계약이 화면에 결속된다', async () => {
  const html = await readFile(htmlUrl, 'utf8');
  assert.match(html, /if \(!r\.ok\)/u);
  assert.match(html, /listView === 'archived'[\s\S]*dataset\.action = 'restore'/u);
  assert.match(html, /else \{ primary\.hidden = false; primary\.textContent = '되돌리기'/u);
  assert.match(html, /catch \{ return; \}/u);
});
