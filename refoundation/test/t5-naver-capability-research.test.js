import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Naver 연구는 하나의 managed Browser identity에서 Mail·Blog physical adapter를 분리한다', async () => {
  const plan = await read('티파이브개발 연구/T5-NAVER-IDENTITY-MAIL-BLOG-CAPABILITY-RESEARCH.md');
  assert.match(plan, /NV3_TO_NV7_TECHNICAL_COMPLETE[\s\S]*INTEGRATION_SEAL_CURRENT/u);
  assert.match(plan, /Naver Identity Broker[\s\S]*Naver Mail physical adapter[\s\S]*Naver Blog physical adapter/u);
  assert.match(plan, /IMAP\/app-password 후보를 폐기/u);
  assert.match(plan, /naver-browser-tool\.js/u);
  assert.match(plan, /naver-blog-craft-adapter\.js/u);
  assert.match(plan, /블로그 글쓰기 Open API는[\s\S]*2020-05-06 종료/u);
  assert.match(plan, /로그인 상태 유지 미선택\/선택 AB/u);
  assert.match(plan, /raw `agent-browser`, Selenium script, T5 Browser가 같은 계정을 각각 로그인하지 않는다/u);
  assert.match(plan, /Managed Playwright provider — 기본/u);
  assert.match(plan, /Selenium provider — Windows qualification 후보/u);
  assert.match(plan, /send\/publish duplicate 0/u);
  assert.doesNotMatch(plan, /Mail read\/search\/send\s*\n→ IMAP\/SMTP/u);
});

test('Naver 연구 색인은 현재 NX를 중단하거나 자동 구현하지 않는다', async () => {
  const index = await read('티파이브개발 연구/INDEX.md');
  assert.match(index, /T5-NAVER-IDENTITY-MAIL-BLOG-CAPABILITY-RESEARCH\.md/u);
  assert.match(index, /로그인 상태 유지.*opposing test/u);
  assert.match(index, /현재 NX-1을 중단하거나.*구현을 시작하지 않는다/u);
});
