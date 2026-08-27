import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../scripts/launch-file-intelligence-human-console.mjs', import.meta.url), 'utf8');

test('파일 지능 인간 콘솔은 합성 fixture·읽기 전용 모델·빈 messenger만 연다', () => {
  assert.match(source, /--human-controlled is required/u); assert.match(source, /loadReadOnlyConnectionCredential/u);
  assert.match(source, /realUserFilesMayBeRead: false/u); assert.match(source, /externalWrites: realHomeBlind \? 1 : 0/u);
  assert.match(source, /new MessengerCredentialStore\(join\(stateDir, 'messenger'\)\)/u);
  assert.match(source, /한빛상사 478만원 견적 사진/u); assert.match(source, /여권사진처럼 보이는 파일/u);
  assert.match(source, /사람 신원은 추정하지 말고/u); assert.match(source, /makeLocalImageOcr/u);
  assert.match(source, /restrictFileRealityToComputerRoots: true/u);
  assert.match(source, /protectedReadRoots: \[homedir\(\)\]/u);
  assert.match(source, /terminalEnvironment: \{ HOME: syntheticHome/u);
  assert.doesNotMatch(source, /migrateStoredModelCredentials|MessengerCredentialStore\([^)]*homedir/u);
});

test('blind 여권사진 fixture는 정답을 보호 상태에만 두고 콘솔 출력에서 위치를 숨긴다', () => {
  assert.match(source, /--blind-passport/u); assert.match(source, /blind-expected\.json/u);
  assert.match(source, /fixtureRoot: blindPassport \? '\[withheld blind fixture\]'/u);
  assert.match(source, /computerFileRoots: realHomeBlind \? \[realBlindRoot\] : blindPassport \? \[syntheticHome\]/u);
  assert.match(source, /passport_portrait_fixture/u);
});

test('real-home blind fixture는 무작위 전용 폴더 하나만 만들고 종료 시 정확히 정리한다', () => {
  assert.match(source, /--real-home-blind-passport/u); assert.match(source, /Documents'.*`업무자료-\$\{randomUUID\(\)\}`/su);
  assert.match(source, /computerFileRoots: realHomeBlind \? \[realBlindRoot\]/u);
  assert.match(source, /if \(realBlindRoot\) await rm\(realBlindRoot, \{ recursive: true, force: true \}\)/u);
  assert.doesNotMatch(source, /rm\(homedir\(\)/u);
});
