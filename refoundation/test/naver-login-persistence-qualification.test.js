import assert from 'node:assert/strict';
import test from 'node:test';

import { qualifyNaverLoginPersistence } from '../src/naver-login-persistence-qualification.js';

const round = (mode, after = { mailWeb: 'ready', blogWeb: 'ready' }) => ({
  mode, profileHandle: 'managed-profile-default',
  beforeRestart: { mailWeb: 'ready', blogWeb: 'ready' }, afterRestart: after,
  cleanShutdown: true, runtimeRestarted: true, cookieExported: false,
  secretObserved: false, userChromeProfileControlled: false,
});

test('동일 managed profile의 선택/미선택 opposing test에서 B의 Mail·Blog 재시작 readback만 장기 로그인을 자격한다', () => {
  const result = qualifyNaverLoginPersistence({
    withoutPersistence: round('keep_signed_in_not_selected', { mailWeb: 'login_required', blogWeb: 'login_required' }),
    withPersistence: round('keep_signed_in_selected'),
  });
  assert.equal(result.state, 'qualified'); assert.equal(result.cookieContentObserved, false);
  assert.match(result.claim, /Mail and Blog after clean restart/u);
});

test('로그인 상태 유지를 선택해도 재시작 뒤 한 서비스가 login_required면 자격하지 않는다', () => {
  const result = qualifyNaverLoginPersistence({
    withoutPersistence: round('keep_signed_in_not_selected'),
    withPersistence: round('keep_signed_in_selected', { mailWeb: 'ready', blogWeb: 'login_required' }),
  });
  assert.equal(result.state, 'not_qualified');
});

test('다른 profile·cookie export·secret 관측·불완전 shutdown은 opposing evidence가 아니다', () => {
  assert.throws(() => qualifyNaverLoginPersistence({
    withoutPersistence: round('keep_signed_in_not_selected'),
    withPersistence: { ...round('keep_signed_in_selected'), profileHandle: 'foreign-profile' },
  }), /same managed profile/u);
  for (const forbidden of [
    { cookieExported: true }, { secretObserved: true }, { userChromeProfileControlled: true },
    { cleanShutdown: false }, { runtimeRestarted: false },
  ]) assert.throws(() => qualifyNaverLoginPersistence({
    withoutPersistence: round('keep_signed_in_not_selected'),
    withPersistence: { ...round('keep_signed_in_selected'), ...forbidden },
  }), /privacy boundary|shutdown and runtime restart/u);
});
