// P6-L5 · 앱 존재 확인 — **"열어드릴게요" 앞에 오는 사실.**
// 이게 없으면 모델은 빈 자리를 지어낸다: 설치돼 있지도 않은 앱으로 열어주겠다고 한다(§0).
// 실행은 여기 없다 — 되돌리기 어려운 행동이라 별도 경계다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalAppsTool } from '../src/runtime/local-apps.js';

async function fakeAppDir() {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-apps-'));
  for (const name of ['한글.app', 'Microsoft Excel.app', 'Google Chrome.app']) {
    await mkdir(join(dir, name, 'Contents', 'MacOS'), { recursive: true });
    await writeFile(join(dir, name, 'Contents', 'MacOS', 'run'), '');
  }
  await mkdir(join(dir, '깨진앱.app', 'Contents'), { recursive: true }); // 실행 파일이 없다
  await writeFile(join(dir, '문서.txt'), 'app 이 아니다');
  return dir;
}

const tool = async () => makeLocalAppsTool({ dirs: [await fakeAppDir()], platform: 'darwin' });

test('설치된 앱을 있는 그대로 준다(앱이 아닌 것은 안 센다)', async () => {
  const r = await (await tool()).handler({});
  assert.equal(r.result.total, 4);
  assert.ok(!r.result.apps.some((a) => a.name.includes('문서')));
});

test('이름 일부로 찾는다 — 사용자는 정확한 앱 이름을 모른다', async () => {
  const r = await (await tool()).handler({ query: 'excel' });
  assert.equal(r.result.apps.length, 1);
  assert.equal(r.result.apps[0].name, 'Microsoft Excel');
});

test('없으면 없다고 하고 다음 길을 준다(막다른 답 금지)', async () => {
  const r = await (await tool()).handler({ query: '포토샵' });
  assert.equal(r.result.apps.length, 0);
  assert.match(r.userSafeSummary, /찾지 못했어요/);
  assert.ok(r.nextSafeAction, '못 찾았으면 전체 목록이라는 다음 길이 있어야 한다');
});

test('깨진 번들은 "실행 가능"이라고 하지 않는다', async () => {
  const r = await (await tool()).handler({ query: '깨진앱' });
  assert.equal(r.result.apps[0].launchable, false, '있다고만 하고 안 되는 걸 권하면 그것도 거짓말이다');
});

// ── 못 보는 것을 "없다"로 말하지 않는다 ──────────────────────────────────
test('확인 못 하는 컴퓨터에서는 빈 목록 대신 못 한다고 말한다', async () => {
  const r = await makeLocalAppsTool({ dirs: [], platform: 'linux' }).handler({});
  assert.ok(r.blocked);
  assert.ok(!r.result, '빈 목록을 주면 모델이 "설치된 앱이 없어요"라고 단정한다');
  assert.ok(r.nextSafeAction);
});

test('못 들여다본 자리를 밝힌다', async () => {
  const r = await makeLocalAppsTool({ dirs: ['/없는/폴더'], platform: 'darwin' }).handler({});
  assert.deepEqual(r.result.notChecked, ['/없는/폴더']);
});

// ── 이 도구는 아무것도 실행하지 않는다 ───────────────────────────────────
test('앱을 여는 길은 아직 없다 — 있다고 말하지도 않는다', async () => {
  const { demoDescriptors } = await import('../src/surface/demo-context.js');
  const d = demoDescriptors().find((x) => x.id === 'local.apps');
  assert.equal(d.toolKind, 'read', '확인은 읽기다 — 승인을 물으면 사용자가 기계적으로 누르게 된다');
  assert.doesNotMatch(d.capability, /실행한다|연다/, '못 하는 걸 할 수 있다고 적으면 안 된다');
  assert.match(d.schema.description, /실행하지는 않는다/, '모델에게도 경계를 분명히 말한다');
});
