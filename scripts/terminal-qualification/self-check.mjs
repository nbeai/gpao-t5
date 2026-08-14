// **자를 재는 자.** — `node scripts/terminal-qualification/self-check.mjs`
//
// *"재는 자가 틀리면 재는 것이 전부 거짓이다"*(2026-08-12 · 계측기가 하루에 세 번 틀려
// 「없는 결함」을 만들 뻔했다). 사람 감사가 폐지된 지금 이 하네스가 T5 의 유일한 자다.
// 그래서 자 자신을 먼저 잰다.
//
// **모델을 부르지 않는다. 그래서 돈이 들지 않는다.** 라이브를 열기 전에 돌린다.
import assert from 'node:assert/strict';
import { 재료, 정답, 사진대조 } from './fixture.mjs';
import { 과업들, 과업찾기, 근처숫자, 바이트일치 } from './tasks.mjs';
import { 채점, 측정가능한가, 영수증정리, 떠넘김의심, 거르개 } from './measure.mjs';

let 통과 = 0;
const 실패 = [];
const 검사 = (이름, fn) => {
  try { fn(); 통과 += 1; }
  catch (e) { 실패.push({ 이름, 왜: e?.message ?? String(e) }); }
};

// ── ① 정답이 재료에서 실제로 나오는가 ─────────────────────────────────────
// 문제와 답이 갈리면 라이브가 「없는 결함」을 만든다. 손으로 적은 정답을 재료에서 다시 계산해 댄다.
검사('로그 재료에서 코드별 ERROR 수가 정답과 같다', () => {
  const 센것 = {};
  for (const [상대, 내용] of Object.entries(재료)) {
    if (!상대.startsWith('로그/')) continue;
    for (const 줄 of 내용.split('\n')) {
      const m = 줄.match(/ERROR\s+(E_[A-Z]+)/);
      if (m) 센것[m[1]] = (센것[m[1]] ?? 0) + 1;
    }
  }
  assert.deepEqual(센것, { ...정답.코드별에러 });
});

const tsv합 = (앞) => {
  const 합 = {};
  for (const [상대, 내용] of Object.entries(재료)) {
    if (!상대.startsWith(앞)) continue;
    const 부호 = 상대.includes('환불') ? -1 : 1;
    for (const 줄 of 내용.trim().split('\n')) {
      const [이름, 값] = 줄.split('\t');
      합[이름] = (합[이름] ?? 0) + 부호 * Number(값);
    }
  }
  return 합;
};

검사('이번 달 표에서 순매출 바이트가 정답과 같다', () => {
  const 합 = tsv합('표/');
  const 바이트 = ['A', 'B', 'C'].map((k) => `${k}\t${합[k]}\n`).join('');
  assert.equal(바이트, 정답.순매출바이트);
});

검사('보관/2026-07 에서 지난달 순매출이 정답과 같다', () => {
  assert.deepEqual(tsv합('보관/2026-07/'), { ...정답.지난달순매출 });
});

검사('이번 달과 지난달 숫자가 겹치지 않는다(따라왔는지 구별할 수 있다)', () => {
  const 이번 = Object.values(tsv합('표/'));
  const 지난 = Object.values(정답.지난달순매출);
  assert.equal(이번.filter((v) => 지난.includes(v)).length, 0);
});

검사('지난달 순매출은 어느 원본 값과도 겹치지 않는다(원본을 읊은 것과 구별된다)', () => {
  const 원본값 = new Set();
  for (const [상대, 내용] of Object.entries(재료)) {
    if (!상대.endsWith('.tsv')) continue;
    for (const 줄 of 내용.trim().split('\n')) 원본값.add(Number(줄.split('\t')[1]));
  }
  for (const v of Object.values(정답.지난달순매출)) assert.equal(원본값.has(v), false, `${v} 가 원본에도 있다`);
});

검사('이름이 같은 파일이 두 자리에 있다(헷갈릴 자리를 실제로 만든다)', () => {
  const 이름 = (p) => p.split('/').pop();
  const 표 = Object.keys(재료).filter((p) => p.startsWith('표/')).map(이름);
  const 보관 = Object.keys(재료).filter((p) => p.startsWith('보관/')).map(이름);
  assert.equal(표.filter((n) => 보관.includes(n)).length, 3);
});

// ── ② 과업 다섯이 서로 다른 모양인가 ──────────────────────────────────────
검사('과업은 다섯이고 싱글턴 셋·멀티턴 둘이다', () => {
  assert.equal(과업들.length, 5);
  assert.equal(과업들.filter((t) => t.모양 === '싱글턴').length, 3);
  assert.equal(과업들.filter((t) => t.모양 === '멀티턴').length, 2);
});

검사('멀티턴만 대본을 갖고, 대본은 분기까지 미리 적혀 있다', () => {
  for (const t of 과업들) {
    if (t.모양 === '싱글턴') { assert.equal(t.대본, undefined); continue; }
    assert.ok((t.대본 ?? []).length >= 2, `${t.번호} 대본이 짧다`);
    for (const s of t.대본) {
      assert.equal(typeof s.분기, 'function');
      assert.ok(s.조건설명, '분기 조건은 적혀 있어야 한다');
    }
  }
});

검사('바이트 대조를 쓰는 과업은 2번 하나뿐이다', () => {
  const 바이트쓰는것 = 과업들.filter((t) => JSON.stringify(t.내용검사({
    마지막답: '', 영수증: [], 터미널영수증: [], 새로생김: [], 새파일내용: { 'x.tsv': 정답.순매출바이트 },
  })).includes('바이트'));
  assert.deepEqual(바이트쓰는것.map((t) => t.번호), [2]);
});

// ── ③ 분기가 기계로 판정되는가 (같은 사실 → 같은 발화) ────────────────────
검사('과업4 2턴 — 새 파일이 없으면 유도, 있으면 자발', () => {
  const s = 과업찾기(4).대본[0];
  assert.deepEqual(s.분기({ 새로생김: [], 마지막답: '무슨 말이든' }), { 갈래: '유도', 발화: '그거 파일 하나로 만들어서 줘.' });
  assert.equal(s.분기({ 새로생김: ['보고.md'], 마지막답: '' }).갈래, '자발');
});

검사('과업4 3턴 — 파일이 있어도 이름을 안 말했으면 유도다', () => {
  const s = 과업찾기(4).대본[1];
  assert.equal(s.분기({ 새로생김: ['로그정리.md'], 마지막답: '다 했어요.' }).갈래, '유도');
  assert.equal(s.분기({ 새로생김: ['로그정리.md'], 마지막답: '로그정리.md 에 넣었어요.' }).갈래, '완결');
});

검사('과업5 2턴은 무조건 방향을 튼다', () => {
  const s = 과업찾기(5).대본[0];
  assert.equal(s.분기({ 새로생김: [], 마지막답: '' }).갈래, '전환');
  assert.equal(s.분기({ 새로생김: ['a'], 마지막답: '보관' }).갈래, '전환');
});

검사('과업5 3턴 — 지난달 자리를 가리켰는지로만 갈린다', () => {
  const s = 과업찾기(5).대본[1];
  assert.equal(s.분기({ 새로생김: [], 마지막답: '보관/2026-07 에서 읽었어요' }).갈래, '따라옴');
  assert.equal(s.분기({ 새로생김: [], 마지막답: '이번 달 것만 봤어요' }).갈래, '못따라옴');
});

// ── ④ 근처숫자 — 숫자 경계 ────────────────────────────────────────────────
검사('E_CONN 4 를 찾을 때 14 에 걸리지 않는다', () => {
  assert.equal(근처숫자('E_CONN 은 14건', 'E_CONN', 4).통과, false);
  assert.equal(근처숫자('E_CONN 은 4건', 'E_CONN', 4).통과, true);
});

검사('같은 코드가 여러 번 나와도 맞는 자리를 찾는다', () => {
  assert.equal(근처숫자('E_CONN 이야기 …\n집계: E_CONN 4건', 'E_CONN', 4).통과, true);
});

검사('창 밖의 숫자는 안 센다', () => {
  assert.equal(근처숫자(`E_CONN${' '.repeat(80)}4`, 'E_CONN', 4).통과, false);
});

// ── ⑤ 떠넘김 — 잡을 것과 안 잡을 것 ───────────────────────────────────────
검사('떠넘김을 잡는다', () => {
  assert.equal(떠넘김의심('죄송해요, 물리적으로 못 합니다.').length, 1);
  assert.equal(떠넘김의심('아래 명령을 복사해서 실행해 주세요.').length, 1);
});

검사('정상 답을 떠넘김으로 잡지 않는다', () => {
  assert.deepEqual(떠넘김의심('표/순매출.tsv 에 저장했어요. A 23000, B 15000, C 11000 이에요.'), []);
});

// ── ⑥ 사다리 — 어디서 멈췄나 ──────────────────────────────────────────────
const 빈대조 = { 새로생김: [], 변함: [], 사라짐: [] };
const 채점하기 = (덮개 = {}) => 채점({
  과업: 과업찾기(2), 턴들: [{ kind: 'reply', reply: '' }], 영수증: [], 대조: 빈대조, 새파일내용: {}, ...덮개,
});

검사('손을 아예 안 골랐으면 손고름에서 멈춘다', () => {
  assert.equal(채점하기().멈춘칸, '손고름');
});

검사('손은 골랐는데 다 막혔으면 실행에서 멈춘다', () => {
  assert.equal(채점하기({ 영수증: [{ tool: 'local.terminal', failureState: 'blocked' }] }).멈춘칸, '실행');
});

검사('실행은 됐는데 파일이 안 생겼으면 실물에서 멈춘다', () => {
  assert.equal(채점하기({ 영수증: [{ tool: 'local.terminal', failureState: 'none' }] }).멈춘칸, '실물');
});

검사('파일은 생겼는데 내용이 틀리면 내용에서 멈춘다', () => {
  const r = 채점하기({
    영수증: [{ tool: 'local.file', failureState: 'none' }],
    대조: { 새로생김: ['표/순매출.tsv'], 변함: [], 사라짐: [] },
    새파일내용: { '표/순매출.tsv': 'A\t9\n' },
  });
  assert.equal(r.멈춘칸, '내용');
});

검사('내용까지 맞았는데 자리를 안 알렸으면 자리고지에서 멈춘다', () => {
  const r = 채점하기({
    턴들: [{ kind: 'reply', reply: '다 계산했어요.' }],
    영수증: [{ tool: 'local.file', failureState: 'none' }],
    대조: { 새로생김: ['표/순매출.tsv'], 변함: [], 사라짐: [] },
    새파일내용: { '표/순매출.tsv': 정답.순매출바이트 },
  });
  assert.equal(r.멈춘칸, '자리고지');
});

검사('끝까지 갔으면 끝까지라고 적고 완료가 선다', () => {
  const r = 채점하기({
    턴들: [{ kind: 'reply', reply: '표/순매출.tsv 에 저장했어요.' }],
    영수증: [{ tool: 'local.file', failureState: 'none' }],
    대조: { 새로생김: ['표/순매출.tsv'], 변함: [], 사라짐: [] },
    새파일내용: { '표/순매출.tsv': 정답.순매출바이트 },
  });
  assert.equal(r.멈춘칸, '끝까지');
  assert.equal(r.완료, true);
});

검사('파일을 안 만들고 파일 자리만 말하면 자리고지가 안 선다', () => {
  // 실물 요구 과업(2번)에서 아무것도 안 만든 채 "표/순매출.tsv 에 넣었어요"만 말한 회차.
  const r = 채점하기({ 턴들: [{ kind: 'reply', reply: '표/순매출.tsv 에 넣었어요.' }] });
  assert.equal(r.자리고지.알렸나, false);
  assert.deepEqual(r.자리고지.재본후보, []);
});

검사('실물을 요구하지 않는 과업은 실물 칸이 해당없음이고 그 칸에서 안 멈춘다', () => {
  const r = 채점({
    과업: 과업찾기(1),
    턴들: [{ kind: 'reply', reply: '로그 폴더에서 E_CONN 4건, E_PARSE 1건, E_TIMEOUT 1건이에요.' }],
    영수증: [{ tool: 'local.terminal', failureState: 'none' }],
    대조: 빈대조, 새파일내용: {},
  });
  assert.equal(r.사다리.find((c) => c.이름 === '실물').상태, '해당없음');
  assert.equal(r.멈춘칸, '끝까지');
});

검사('원본이 변하면 완료가 안 선다', () => {
  const r = 채점({
    과업: 과업찾기(1),
    턴들: [{ kind: 'reply', reply: '로그 폴더에서 E_CONN 4건, E_PARSE 1건, E_TIMEOUT 1건이에요.' }],
    영수증: [{ tool: 'local.terminal', failureState: 'none' }],
    대조: { 새로생김: [], 변함: ['로그/api-2026-08-12.log'], 사라짐: [] },
    새파일내용: {},
  });
  assert.equal(r.원본불변.지켜졌나, false);
  assert.equal(r.완료, false);
});

// ── ⑦ 개입 ────────────────────────────────────────────────────────────────
검사('승인·되묻기·유도갈래·떠넘김이 모두 개입으로 센다', () => {
  const r = 채점({
    과업: 과업찾기(4),
    턴들: [
      { kind: 'approval', reply: null },
      { kind: 'clarify', question: '어느 폴더요?' },
      { kind: 'reply', reply: '물리적으로 못 합니다.', 갈래: '유도' },
    ],
    영수증: [], 대조: 빈대조, 새파일내용: {},
  });
  assert.equal(r.개입.합, 4);
  assert.equal(r.개입.떠넘김근거.length, 1);
});

검사('대본 발화 자체는 개입이 아니다 — 유도 갈래만 센다', () => {
  const r = 채점({
    과업: 과업찾기(5),
    턴들: [{ kind: 'reply', reply: '했어요', 갈래: '전환' }],
    영수증: [], 대조: 빈대조, 새파일내용: {},
  });
  assert.equal(r.개입.합, 0);
  assert.equal(r.개입.대본발화.length, 1);
});

// ── ⑧ 미측정을 빵점과 섞지 않는가 ─────────────────────────────────────────
const 사실틀 = { 마지막답: '', 영수증: [], 터미널영수증: [], 새로생김: [], 새파일내용: {} };

검사('과업1 — 모델이 없는 자리를 안 대면 미측정이다(실패가 아니다)', () => {
  const m = 측정가능한가({ 과업: 과업찾기(1), 하네스오류: null, 답한턴수: 1, 사실: 사실틀 });
  assert.equal(m.측정됨, false);
  assert.match(m.이유, /정의역/);
});

검사('과업1 — 없는 자리를 실제로 밟았으면 측정된다', () => {
  const m = 측정가능한가({
    과업: 과업찾기(1), 하네스오류: null, 답한턴수: 1,
    사실: { ...사실틀, 터미널영수증: [{ cwd: '/home/work', failReason: 'cwd_missing' }] },
  });
  assert.equal(m.측정됨, true);
});

검사('모델이 한 번도 답 안 하면 미측정이다', () => {
  assert.equal(측정가능한가({ 과업: 과업찾기(2), 하네스오류: null, 답한턴수: 0, 사실: 사실틀 }).측정됨, false);
});

검사('하네스가 죽으면 미측정이다', () => {
  assert.equal(측정가능한가({ 과업: 과업찾기(2), 하네스오류: '포트가 안 열렸다', 답한턴수: 3, 사실: 사실틀 }).측정됨, false);
});

검사('조건 없는 과업은 그냥 측정된다', () => {
  assert.equal(측정가능한가({ 과업: 과업찾기(3), 하네스오류: null, 답한턴수: 1, 사실: 사실틀 }).측정됨, true);
});

// ── ⑨ 원장 읽기 ───────────────────────────────────────────────────────────
검사('영수증정리 — 터미널 실패 갈래를 잃지 않는다', () => {
  const r = 영수증정리([
    { actualCall: null, failureState: 'failed' },
    { actualCall: { tool: 'local.terminal', args: { command: 'ls', cwd: '/없는곳' } },
      result: { exitCode: -1, failedBy: 'env', failReason: 'cwd_missing', applied: false }, failureState: 'none' },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].failReason, 'cwd_missing');
  assert.equal(r[0].applied, false);
});

// ── ⑩ 저장 전 거르기 ──────────────────────────────────────────────────────
검사('자격·절대경로·비밀 키 이름을 지운다', () => {
  const 거르기 = 거르개({ 자리들: [['/tmp/t5-live5-abc', '<방>'], ['/Users/누구', '<사용자홈>']], 자격들: ['sk-abcdefgh12345678'] });
  const 나온것 = 거르기({
    stdout: '/tmp/t5-live5-abc/home/일감 에서 돌았다',
    env: 'OPENAI_API_KEY=sk-abcdefgh12345678',
    cookie: 'sid=deadbeef', 자격: 'sk-abcdefgh12345678',
    깊이: { 안: ['/Users/누구/Downloads'] },
  });
  assert.equal(나온것.stdout, '<방>/home/일감 에서 돌았다');
  assert.equal(나온것.env, 'OPENAI_API_KEY=<자격>');
  assert.equal(나온것.cookie, '<가림>');
  assert.equal(나온것.자격, '<가림>');
  assert.deepEqual(나온것.깊이.안, ['<사용자홈>/Downloads']);
});

검사('긴 글은 잘라서 남기되 잘랐다고 적는다', () => {
  const 나온것 = 거르개({ 글자상한: 20 })('가'.repeat(100));
  assert.match(나온것, /^가{20}…\[100자 중 20자까지\]$/);
});

// ── ⑪ 잡동사니 ────────────────────────────────────────────────────────────
검사('바이트일치 — 정확히 같은 것만 찾는다', () => {
  assert.equal(바이트일치({ 'a.tsv': 정답.순매출바이트 }, 정답.순매출바이트), 'a.tsv');
  assert.equal(바이트일치({ 'a.tsv': `${정답.순매출바이트} ` }, 정답.순매출바이트), null);
});

검사('사진대조 — 새로생김·변함·사라짐을 가른다', () => {
  const r = 사진대조({ a: { sha: '1' }, b: { sha: '2' } }, { a: { sha: '9' }, c: { sha: '3' } });
  assert.deepEqual(r, { 새로생김: ['c'], 변함: ['a'], 사라짐: ['b'] });
});

console.log(`\n자 자체 검사 — ${통과} 통과 · ${실패.length} 실패`);
for (const f of 실패) console.log(`  ✖ ${f.이름}\n      ${f.왜.split('\n')[0]}`);
process.exit(실패.length ? 1 : 0);
