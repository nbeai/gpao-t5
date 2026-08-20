import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  HUMAN_SCENARIOS, assessHumanScenario, commonHumanChecks, materializeHumanScenario,
} from '../src/human-scenarios.js';

test('R4 제품 판정은 세 개의 긴 멀티턴 인간 여정을 사용한다', () => {
  assert.deepEqual(HUMAN_SCENARIOS.map((scenario) => scenario.turns.length), [18, 12, 11]);
  assert.deepEqual(HUMAN_SCENARIOS.map((scenario) => scenario.kind), ['conversation', 'files', 'personal']);
  assert.ok(HUMAN_SCENARIOS.flatMap((scenario) => scenario.turns)
    .every((turn) => !/7391|BEACON|먼저 rg|tool call|exit code/iu.test(turn.prompt)));
});

test('사용자 표면 판정은 내부 도구명과 실패한 Turn을 허용하지 않는다', () => {
  assert.equal(commonHumanChecks([{
    answer: '완료했어요.', httpStatus: 200, runStatus: 'completed',
  }]).noInternalTerms, true);
  const bad = commonHumanChecks([{
    answer: 'session_search의 runId를 확인했어요.', httpStatus: 200, runStatus: 'completed',
  }]);
  assert.equal(bad.noInternalTerms, false);
});

test('personal fixture는 홈 발견과 절대경로 쓰기를 격리 HOME 밖으로 내보내지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-personal-isolation-'));
  const home = join(room, 'home');
  const protectedHome = await mkdtemp(join(tmpdir(), 't5-personal-protected-'));
  await mkdir(home, { recursive: true });
  const definition = HUMAN_SCENARIOS.find((scenario) => scenario.kind === 'personal');
  const fixture = await materializeHumanScenario(definition, home, room, {
    protectedHomes: [protectedHome],
  });
  const run = (command) => spawnSync(fixture.shellProgram, ['-lc', command], {
    encoding: 'utf8', env: { ...process.env, HOME: protectedHome, PATH: process.env.PATH },
  });

  const discovered = run('set -e; REAL_HOME=$(/usr/bin/dscl . -read /Users/$(/usr/bin/id -un) NFSHomeDirectory | awk -F\": \" \"{print \\$2}\"); printf isolated > \"$REAL_HOME/discovered.txt\"; printf \"%s\" \"$REAL_HOME\"');
  assert.equal(discovered.status, 0, discovered.stderr);
  assert.equal(discovered.stdout, home);
  assert.equal(await readFile(join(home, 'discovered.txt'), 'utf8'), 'isolated');
  assert.equal(existsSync(join(protectedHome, 'discovered.txt')), false);

  const direct = run(`printf escaped > ${JSON.stringify(join(protectedHome, 'escaped.txt'))}`);
  assert.notEqual(direct.status, 0);
  assert.equal(existsSync(join(protectedHome, 'escaped.txt')), false);

  const python = spawnSync(fixture.shellProgram, ['-lc', 'python3 -c \'import os, pathlib; pathlib.Path(os.environ["PROTECTED_TARGET"]).write_text("escaped")\''], {
    encoding: 'utf8', env: {
      ...process.env, HOME: protectedHome, PATH: process.env.PATH,
      PROTECTED_TARGET: join(protectedHome, 'python-escaped.txt'),
    },
  });
  assert.notEqual(python.status, 0);
  assert.equal(existsSync(join(protectedHome, 'python-escaped.txt')), false);

  const node = spawnSync(fixture.shellProgram, ['-lc', 'node -e \'require("node:fs").writeFileSync(process.env.PROTECTED_TARGET,"escaped")\''], {
    encoding: 'utf8', env: {
      ...process.env, HOME: protectedHome, PATH: process.env.PATH,
      PROTECTED_TARGET: join(protectedHome, 'node-escaped.txt'),
    },
  });
  assert.notEqual(node.status, 0);
  assert.equal(existsSync(join(protectedHome, 'node-escaped.txt')), false);

  const loaded = run('launchctl load "$HOME/Library/LaunchAgents/com.t5.fixture.plist"; launchctl list');
  assert.equal(loaded.status, 0, loaded.stderr);
  assert.match(loaded.stdout, /com\.t5\.fixture/u);
  const domain = run('launchctl print gui/$(id -u)');
  assert.equal(domain.status, 0, domain.stderr);
  assert.match(domain.stdout, /domain\s*=\s*gui/u);
  const unloaded = run('launchctl unload "$HOME/Library/LaunchAgents/com.t5.fixture.plist"; launchctl list');
  assert.equal(unloaded.status, 0, unloaded.stderr);
  assert.doesNotMatch(unloaded.stdout, /com\.t5\.fixture/u);
  const absentService = run('launchctl print gui/$(id -u)/com.t5.fixture');
  assert.notEqual(absentService.status, 0);
});

test('영어로 저장된 커피 취향도 취소된 work 기억과 분리해 유용한 현재 기억으로 판정한다', () => {
  const definition = HUMAN_SCENARIOS.find((scenario) => scenario.kind === 'personal');
  const turns = definition.turns.map((_, index) => ({
    answer: '확인했어.', httpStatus: 200, runStatus: 'completed',
    approvals: 0, computerToolCalls: 0,
    turn: index + 1,
  }));
  turns[1].answer = '어디로 알려드릴까?';
  turns[4].answer = '매일 오후 4시에 알려줄게.';
  turns[8].answer = '커피에 샷 추가를 좋아해.';
  turns[9].answer = '스트레칭 알림을 만들었다가 취소했어.';
  turns[10].answer = '커피에 샷 추가를 좋아해.';
  const observations = Array.from({ length: 12 }, () => ({
    notificationConfigured: false, memoryItems: [], files: {},
  }));
  observations[3].notificationConfigured = true;
  observations.at(-1).memoryItems = [{
    kind: 'user', content: 'The user likes adding an extra espresso shot when drinking coffee.',
  }];

  const result = assessHumanScenario({ definition, turns, fixture: {}, observations });
  assert.equal(result.passed, true, JSON.stringify(result.checks));
});
