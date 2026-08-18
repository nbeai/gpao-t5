import test from 'node:test';
import assert from 'node:assert/strict';

import { assessBackendDemand } from '../src/backend-demand.js';

test('로컬 PC 파일·터미널 과업만 있으면 backend를 만들 근거가 아니다', () => {
  const result = assessBackendDemand([
    { runId: 'r1', request: '다운로드 폴더에서 파일을 찾아줘', events: [] },
    { runId: 'r2', request: '로컬 테스트를 실행해줘', events: [] },
  ]);
  assert.equal(result.required, false);
  assert.deepEqual(result.signals, []);
});

test('명시적 원격·격리 실행 위치 요구는 backend 종류와 근거 Run을 남긴다', () => {
  const result = assessBackendDemand([
    { runId: 'ssh-run', request: 'SSH 서버에서 이 명령을 실행해줘', events: [] },
    { runId: 'docker-run', request: 'Docker 컨테이너에서 재현해줘', events: [] },
  ]);
  assert.equal(result.required, true);
  assert.deepEqual(result.signals.map((signal) => signal.backend), ['ssh', 'docker']);
  assert.deepEqual(result.signals.map((signal) => signal.runId), ['ssh-run', 'docker-run']);
});
