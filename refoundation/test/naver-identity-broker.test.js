import assert from 'node:assert/strict';
import test from 'node:test';

import { makeNaverIdentityBroker } from '../src/naver-identity-broker.js';

const observed = (url, text) => ({ state: 'observed', profile: { id: 'default' },
  tab: { url }, observation: { text } });

test('동일 managed profile의 Mail·Blog actual observation만 하나의 authenticated Naver identity를 만든다', async () => {
  const broker = makeNaverIdentityBroker({ now: () => new Date('2026-09-02T00:00:00Z') });
  broker.observeBrowserResult({ args: { action: 'navigate', url: 'https://mail.naver.com/' },
    result: observed('https://mail.naver.com/v2/folders/0/all', '받은메일함') });
  assert.equal((await broker.inspect()).state, 'needs_connection');
  broker.observeBrowserResult({ args: { action: 'navigate', url: 'https://blog.naver.com/' },
    result: observed('https://blog.naver.com/', '로그아웃 내 블로그 글쓰기') });
  const ready = await broker.inspect();
  assert.equal(ready.state, 'ready'); assert.deepEqual(ready.capabilities,
    { mail_web: true, blog_web: true, mail_protocol: false });
  assert.equal(ready.naverIdentity.state, 'authenticated');
  assert.doesNotMatch(JSON.stringify(ready), /cookie|localStorage|\/Users\/|password|otp/iu);
});

test('Naver 공식 Blog Home redirect host도 같은 Blog identity의 readback이다', async () => {
  const broker = makeNaverIdentityBroker({ profileHandle: 'default' });
  broker.observeBrowserResult({ args: { action: 'navigate', url: 'https://mail.naver.com/' },
    result: observed('https://mail.naver.com/v2/folders/0/all', '메일함') });
  broker.observeBrowserResult({ args: { action: 'navigate', url: 'https://blog.naver.com/' },
    result: observed('https://section.blog.naver.com/BlogHome.naver', '로그아웃 내 블로그 글쓰기') });
  const result = await broker.inspect();
  assert.equal(result.state, 'ready'); assert.equal(result.capabilities.blog_web, true);
});

test('authenticated 뒤 login_required는 expired이고 profile reset은 generation을 올린다', async () => {
  const broker = makeNaverIdentityBroker();
  broker.observeBrowserResult({ args: { action: 'navigate', url: 'https://mail.naver.com/' },
    result: observed('https://mail.naver.com/v2/folders/0/all', '받은메일함') });
  broker.observeBrowserResult({ args: { action: 'navigate', url: 'https://blog.naver.com/' },
    result: observed('https://blog.naver.com/', '로그아웃 글쓰기') });
  broker.observeBrowserResult({ args: { action: 'navigate', url: 'https://mail.naver.com/' },
    result: { state: 'login_required', profile: { id: 'default' },
      loginBoundary: { url: 'https://nid.naver.com/nidlogin.login' } } });
  assert.equal((await broker.inspect()).naverIdentity.state, 'expired');
  const reset = broker.resetProfile(); assert.equal(reset.profileGeneration, 2);
  assert.equal(reset.services.mailWeb, 'unknown'); assert.equal(reset.services.blogWeb, 'unknown');
});

test('foreign profile과 비정상 protocol state는 Naver identity를 바꾸지 못한다', () => {
  const broker = makeNaverIdentityBroker({ profileHandle: 'default' });
  assert.throws(() => broker.observeBrowserResult({ args: { action: 'navigate', url: 'https://mail.naver.com/' },
    result: { ...observed('https://mail.naver.com/', '메일'), profile: { id: 'foreign' } } }), /foreign/u);
  assert.throws(() => broker.observeMailProtocol('connected'), /protocol state/u);
});

test('설정의 Naver 연결은 credential 입력 없이 managed Browser login과 Mail·Blog readback으로 닫힌다', async () => {
  const broker = makeNaverIdentityBroker({ profileHandle: null }); const calls = [];
  const browserLogin = {
    async probe() { calls.push(['probe']); return { state: 'observed', observations: [] }; },
    async begin(url) { calls.push(['begin', url]); return { state: 'user_control_required',
      profile: { id: 'managed-profile' } }; },
    async check(urls) { calls.push(['check', urls]); return { state: 'handoff_complete_candidate', observations: [
      { args: { action: 'navigate', url: 'https://mail.naver.com/' },
        result: observed('https://mail.naver.com/v2/folders/0/all', '받은메일함') },
      { args: { action: 'navigate', url: 'https://blog.naver.com/' },
        result: observed('https://blog.naver.com/', '로그아웃 내 블로그 글쓰기') },
    ].map((item) => ({ ...item, result: { ...item.result, profile: { id: 'managed-profile' } } })) }; },
  };
  const before = await broker.inspect();
  assert.match(before.userSafeSummary, /메일을 찾고 읽고 답장을 준비/u);
  assert.match(before.userSafeSummary, /블로그 글을 작성·저장·예약·발행/u);
  assert.equal(before.actions[0].label, '네이버 로그인');
  assert.equal('credentialRequest' in before, false);
  const started = await broker.performAction('login', { browserLogin });
  assert.equal(started.performed, true); assert.equal((await broker.inspect()).actions[0].label, '로그인 완료 확인');
  const checked = await broker.performAction('check-login', { browserLogin });
  assert.equal(checked.performed, true); assert.equal((await broker.inspect()).state, 'ready');
  assert.deepEqual(calls.map((item) => item[0]), ['probe', 'begin', 'check']);
});

test('process-local identity가 unknown이어도 기존 profile readback이 ready면 로그인 창을 다시 열지 않는다', async () => {
  const broker = makeNaverIdentityBroker({ profileHandle: null }); let begins = 0;
  const result = await broker.performAction('login', { browserLogin: {
    async probe() { return { state: 'observed', observations: [
      { args: { action: 'navigate', url: 'https://mail.naver.com/' }, result: {
        ...observed('https://mail.naver.com/v2/folders/0/all', '받은메일함'), profile: { id: 'managed-profile' } } },
      { args: { action: 'navigate', url: 'https://blog.naver.com/' }, result: {
        ...observed('https://blog.naver.com/', '로그아웃 내 블로그 글쓰기'), profile: { id: 'managed-profile' } } },
    ] }; }, async begin() { begins += 1; }, async check() {},
  } });
  assert.equal(result.performed, true); assert.match(result.userSafeSummary, /기존 네이버 로그인/u);
  assert.equal(result.connectionReady, true);
  assert.equal(begins, 0); assert.equal((await broker.inspect()).state, 'ready');
});

test('restart 뒤 identity projection이 unknown이어도 Naver adapter는 deferred discovery에서 사라지지 않는다', async () => {
  const broker = makeNaverIdentityBroker({ profileHandle: 'managed-profile' });
  const browserTool = { async execute() { return { state: 'login_required' }; } };
  const unknownTool = await broker.makeTool({ browserTool });
  assert.equal(unknownTool.name, 'naver'); assert.equal(unknownTool.deferred, true);

  const readyObservation = (url, text) => ({ state: 'observed', profile: { id: 'managed-profile' },
    tab: { url }, observation: { text } });
  broker.observeBrowserResult({ args: { action: 'navigate', url: 'https://mail.naver.com/' },
    result: readyObservation('https://mail.naver.com/v2/folders/0/all', '받은메일함') });
  broker.observeBrowserResult({ args: { action: 'navigate', url: 'https://blog.naver.com/' },
    result: readyObservation('https://section.blog.naver.com/BlogHome.naver', '로그아웃 내 블로그 글쓰기') });
  const readyTool = await broker.makeTool({ browserTool });
  assert.equal(readyTool.name, 'naver'); assert.equal(readyTool.deferred, undefined);
});
