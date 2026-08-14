// **자를 재는 자.** — `node scripts/terminal-qualification/self-check.mjs`
//
// *"재는 자가 틀리면 재는 것이 전부 거짓이다"*(2026-08-12 · 계측기가 하루에 세 번 틀려
// 「없는 결함」을 만들 뻔했다). 사람 감사가 폐지된 지금 이 하네스가 T5 의 유일한 자다.
// 그래서 자 자신을 먼저 잰다.
//
// **모델을 부르지 않는다. 그래서 돈이 들지 않는다.** 라이브를 열기 전에 돌린다.
import assert from 'node:assert/strict';
import { 재료, 정답, 사진대조 } from './fixture.mjs';
import { 과업들, 과업찾기, 근처숫자, 바이트일치, 숫자있나, 숫자정리 } from './tasks.mjs';
import { 채점, 측정가능한가, 영수증정리, 거르개, 터미널일, 쓴프로그램들 } from './measure.mjs';
import { 실전답들, 실전답들2회차 } from './실전고정물.mjs';

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

검사('과업1 동부합계가 재료에서 나오고, 원본 어디에도 없는 계산 결과다', () => {
  const 동부 = 재료['표/매출-동부.tsv'].trim().split('\n')
    .reduce((합, 줄) => 합 + Number(줄.split('\t')[1]), 0);
  assert.equal(동부, 정답.동부합계);
  const 원본값 = new Set();
  for (const [상대, 내용] of Object.entries(재료)) {
    if (!상대.endsWith('.tsv')) continue;
    for (const 줄 of 내용.trim().split('\n')) 원본값.add(Number(줄.split('\t')[1]));
  }
  assert.equal(원본값.has(정답.동부합계), false, '합이 원본에도 있으면 「읊은 것」과 구별이 안 된다');
});

// ── 과업 3(탐색·대량) 재료 — **함정이 실제로 함정인가** ────────────────────
검사('받은자료는 스물 몇 개고, 내용에 취소가 든 csv 는 정답 셋과 정확히 같다', () => {
  const 받은 = Object.keys(재료).filter((p) => p.startsWith('받은자료/'));
  assert.ok(받은.length >= 20, `대량이 아니다 — ${받은.length}개`);
  const 골라진 = 받은
    .filter((p) => p.endsWith('.csv') && 재료[p].includes('취소'))
    .map((p) => p.split('/').pop())
    .sort();
  assert.deepEqual(골라진, [...정답.취소csv].sort());
});

검사('함정 둘이 실제로 함정이다(하나는 확장자만, 하나는 이름만 걸린다)', () => {
  // 내용에 취소가 있지만 csv 가 아니다 — 확장자를 안 보면 걸린다.
  assert.ok(재료['받은자료/거래-20.txt'].includes('취소'));
  // 이름에 취소가 있지만 내용에는 없다 — 이름만 보면 걸린다.
  assert.ok(!재료['받은자료/취소양식-99.csv'].includes('취소'));
  for (const 이름 of 정답.취소함정) assert.equal(정답.취소csv.includes(이름), false);
});

검사('과업4 호스트 정답은 재료가 아니라 이 컴퓨터에서 온다', () => {
  assert.equal(정답.호스트.node버전, process.versions.node);
  assert.equal(정답.호스트.아키텍처, process.arch);
  // **재료를 아무리 읽어도 안 나온다** — 명령을 돌려야만 나오는 사실이어야 한다.
  const 재료전부 = Object.values(재료).join('\n');
  assert.equal(재료전부.includes(정답.호스트.node버전), false);
  assert.equal(재료전부.includes(정답.호스트.아키텍처), false);
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

// **오너 정정(2026-08-14)** — 다섯이 집계 하나의 변주가 되면 「터미널 능력의 폭」을 못 잰다.
검사('과업 다섯이 서로 다른 터미널 능력을 잰다(능력 문장이 다 다르다)', () => {
  const 능력들 = 과업들.map((t) => t.능력);
  for (const 것 of 능력들) assert.ok(것 && 것.length > 5, '능력이 안 적혔다');
  assert.equal(new Set(능력들).size, 5, '같은 능력을 두 번 잰다');
});

// **규율 B** — 「완주 = 만점」을 전제하지 않는다. 정답을 채점 전에 문장으로 적는다.
검사('과업마다 옳은행동이 문장으로 적혀 있다', () => {
  for (const t of 과업들) {
    assert.ok(typeof t.옳은행동 === 'string' && t.옳은행동.length >= 30, `${t.번호} 옳은행동이 없거나 짧다`);
  }
});

검사('채점이 옳은행동을 그대로 인용한다(내용 칸 근거에 실린다)', () => {
  const r = 채점({
    과업: 과업찾기(2), 턴들: [{ kind: 'reply', reply: '했어요' }],
    영수증: [], 대조: { 새로생김: [], 변함: [], 사라짐: [] }, 새파일내용: {},
  });
  assert.equal(r.옳은행동, 과업찾기(2).옳은행동);
  assert.equal(r.사다리.find((c) => c.이름 === '내용').근거.옳은행동, 과업찾기(2).옳은행동);
});

// **되물을 이유가 없어야 자가 한쪽으로 안 기운다.** 목적이 분명한지는 사람이 읽어야 알지만,
// 「무엇을·어디서」가 발화에 적혀 있는지는 기계로 문다 — 재료에 실재하는 자리를 부르는가.
검사('과업 다섯 모두 발화가 어디서 할 일인지 자리를 대고 있다', () => {
  // 재료에 실제로 있는 폴더 이름 + 호스트 그 자체. 이 중 하나도 안 대면 「어디서」가 빈 발화다.
  const 폴더 = [...new Set(Object.keys(재료).map((p) => p.split('/')[0]))].concat(['일감', '이 컴퓨터']);
  for (const t of 과업들) {
    assert.ok(폴더.some((이름) => t.발화[0].includes(이름)), `${t.번호} 발화가 어느 자리 얘긴지 안 댄다`);
  }
});

// **발화가 손을 지정하면 「터미널이 얼마나 일했나」 축이 공짜로 채워진다.** 그러면 그 축은
// 시켜서 쓴 것과 골라서 쓴 것을 못 가른다 — 아무것도 못 재게 된다. 손을 고르는 것은 모델이다.
검사('과업 발화 어디에도 손 이름이 없다(터미널을 쓰라고 시키지 않는다)', () => {
  const 손이름 = /터미널|셸|쉘|shell|명령어로|커맨드|스크립트로/;
  for (const t of 과업들) {
    assert.equal(손이름.test(t.발화[0]), false, `${t.번호} 발화가 손을 지정한다`);
    for (const s of t.대본 ?? []) {
      for (const 답 of ['거래-05.csv A 13200, B 8000', '못 했어요']) {
        const 발화 = s.분기({ 새로생김: [], 마지막답: 답 }).발화;
        assert.equal(손이름.test(발화 ?? ''), false, `${t.번호} 대본이 손을 지정한다: ${발화}`);
      }
    }
  }
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
검사('과업3 2턴 — 맞는 파일 이름을 말했으면 이어감, 아니면 유도', () => {
  const s = 과업찾기(3).대본[0];
  assert.equal(s.분기({ 새로생김: [], 마지막답: '거래-05.csv 랑 몇 개 더 있어요' }).갈래, '이어감');
  assert.equal(s.분기({ 새로생김: [], 마지막답: '못 찾겠어요' }).갈래, '유도');
});

// **멀티턴은 「목적을 다시 묻는 자리」가 아니다.** 갈래가 갈려도 시키는 일이 같아야 견줄 수 있다.
검사('과업3 2턴 — 두 갈래가 같은 일(취소건 폴더로 복사)을 시킨다', () => {
  const s = 과업찾기(3).대본[0];
  for (const 답 of ['거래-05.csv', '못 찾겠어요']) {
    const 발화 = s.분기({ 새로생김: [], 마지막답: 답 }).발화;
    assert.match(발화, /취소건/);
    assert.match(발화, /복사/);
  }
});

검사('과업3 3턴 — 파일이 생겼으면 끝내고, 안 생겼으면 상태만 묻는다', () => {
  const s = 과업찾기(3).대본[1];
  assert.equal(s.분기({ 새로생김: ['취소건/거래-05.csv'], 마지막답: '' }).발화, null);
  assert.equal(s.분기({ 새로생김: [], 마지막답: '' }).갈래, '유도');
});

검사('과업5 2턴 — 지난달 값을 둘 이상 냈으면 복구, 아니면 못복구', () => {
  const s = 과업찾기(5).대본[0];
  assert.equal(s.분기({ 새로생김: [], 마지막답: 'A 13200, B 8000 이에요' }).갈래, '복구');
  assert.equal(s.분기({ 새로생김: [], 마지막답: 'A 13200 만 나왔어요' }).갈래, '못복구');
  assert.equal(s.분기({ 새로생김: [], 마지막답: 'backup 폴더가 없어요' }).갈래, '못복구');
});

// **못복구 갈래가 답을 주면 안 된다.** 자리를 대 주는 순간 그 회차는 복구를 잰 것이 아니게 된다.
검사('과업5 2턴 — 어느 갈래도 진짜 자리(보관/2026-07)를 가르쳐 주지 않는다', () => {
  const s = 과업찾기(5).대본[0];
  for (const 답 of ['A 13200, B 8000', '못 찾겠어요']) {
    const 발화 = s.분기({ 새로생김: [], 마지막답: 답 }).발화;
    assert.equal(/보관|2026-07/.test(발화), false, `자리를 알려 준다: ${발화}`);
    assert.match(발화, /지난달-순매출\.tsv/);
  }
});

검사('과업5 3턴 — 파일이 생겼으면 끝내고, 안 생겼으면 상태만 묻는다', () => {
  const s = 과업찾기(5).대본[1];
  assert.equal(s.분기({ 새로생김: ['보고/지난달-순매출.tsv'], 마지막답: '' }).갈래, '완결');
  assert.equal(s.분기({ 새로생김: [], 마지막답: '' }).발화, '어디까지 됐는지 지금 상태만 알려줘.');
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

// **자를 헐겁게 만드는 게 아니라 같은 수를 같은 수로 읽는 것이다.** 모델은 `23,000` 이라고 적는
// 일이 잦은데 자가 `23000` 만 찾으면 **맞은 답을 틀렸다고 적게 된다**.
검사('천 단위 쉼표가 붙어도 같은 수로 읽는다', () => {
  assert.equal(숫자정리('23,000 원'), '23000 원');
  assert.equal(숫자있나('순매출은 13,200 이야', 13200), true);
  assert.equal(근처숫자('E_CONN 은 1,004건', 'E_CONN', 4).통과, false);   // 경계는 그대로 지킨다
});

검사('숫자있나 — 더 긴 수의 일부는 안 센다', () => {
  assert.equal(숫자있나('금액 250000', 25000), false);
  assert.equal(숫자있나('금액 25000', 25000), true);
});

// ── ⑤ 떠넘김 — 성질로 가른다 ──────────────────────────────────────────────
//
// 이 축은 한 번 실전에서 **뚫렸다**(2026-08-14 run-125806 · 과업 2). 그때 자는 정규식 목록이었고,
// 목록에 없는 문장("표 폴더 위치를 정확히 짚어 주면 …")을 0 으로 셌다. **목록은 항상 뚫린다.**
// 그래서 지금 축은 성질 둘로 서 있다:
//   · 실행 떠넘김 — 사용자에게 **손을 쓰라고** 시킨다(또는 자기 불능을 선언한다). 영수증과 무관하다.
//   · 정보 떠넘김 — 사용자에게 **정보를 달라고** 하며 끝난다. 이건 **그 턴 영수증과 함께** 본다:
//                   빈손·막힘뿐이면 떠넘김, 결실이 섞여 있으면 의심, 빈손·막힘이 없으면
//                   (다 해 놓고 덧붙인 제안이므로) 아니다.
// 아래 시험의 문장은 전부 **실모델이 실제로 낸 답**이다(→ 실전고정물.mjs).

const 실전채점 = (번호, 덮개 = {}) => {
  const 것 = 실전답들[String(번호)];
  return 채점({
    과업: 과업찾기(번호),
    턴들: [{ 차례: 것.마지막차례, kind: 'reply', reply: 것.마지막답 }],
    영수증: 영수증정리(것.원장),
    대조: 빈대조0, 새파일내용: {},
    ...덮개,
  });
};
const 빈대조0 = { 새로생김: [], 변함: [], 사라짐: [] };

검사('영수증정리 — 아무것도 못 찾은 손을 빈손으로 적는다', () => {
  const r = 영수증정리(실전답들['2'].원장);
  assert.equal(r.length, 2);
  for (const 것 of r) {
    assert.equal(것.빈손, true, `${것.tool} 이 빈손으로 안 적혔다`);
    assert.equal(것.결실, false);
    assert.match(것.결실근거, /candidates/);
  }
});

검사('영수증정리 — 결실이 있는 손을 빈손으로 적지 않는다', () => {
  const 터미널 = 영수증정리(실전답들['1'].원장);   // stdout 이 나왔다
  const 파일 = 영수증정리(실전답들['4'].원장);      // 파일을 썼다(bytes)
  assert.deepEqual(터미널.map((r) => r.결실), [true, true]);
  assert.equal(파일.find((r) => r.tool === 'local.file').결실, true);
  assert.equal(파일.find((r) => r.tool === 'local.system').결실, true);
});

검사('영수증정리 — 막힌 손과 턴 번호를 잃지 않는다', () => {
  const r = 영수증정리(실전답들['3'].원장);
  const 막힌것 = r.filter((x) => x.막힘);
  assert.equal(막힌것.length, 1);
  assert.equal(막힌것[0].path, '일감/회의메모');
  assert.equal(막힌것[0].결실, false);
  for (const 것 of r) assert.equal(것.turnSeq, 1);
});

검사('실전 과업2 — 경로를 대신 찾아 달라며 끝낸 답을 떠넘김으로 잡는다', () => {
  const r = 실전채점(2);
  assert.equal(r.참고관측.떠넘김.판정, '떠넘김');
  assert.equal(r.참고관측.떠넘김의심, 1);
  assert.ok(r.참고관측.떠넘김근거.length > 0, '근거가 비었다');
});

검사('실전 과업5 — 위치와 파일 이름을 대신 대 달라는 답도 같은 성질로 잡는다', () => {
  const r = 실전채점(5);
  assert.equal(r.참고관측.떠넘김.판정, '떠넘김');
  assert.equal(r.참고관측.떠넘김.영수증근거.결실, 0);
});

검사('실전 과업1 — 다 해 놓고 덧붙인 제안은 떠넘김이 아니다', () => {
  const r = 실전채점(1);
  assert.equal(r.참고관측.떠넘김.판정, '없음');
  assert.equal(r.참고관측.떠넘김의심, 0);
});

검사('실전 과업4 — 파일을 만들어 놓고 형식만 물은 답은 떠넘김이 아니다', () => {
  const r = 실전채점(4);
  assert.equal(r.참고관측.떠넘김.판정, '없음');
});

검사('실전 과업3 — 반은 해내고 반을 넘긴 답은 의심으로 남기고 0 으로 세지 않는다', () => {
  // **판단이 갈리는 자리다.** 지난달 표는 실제로 찾아 냈고(결실 3건), 회의메모 쪽만 막힌 뒤
  // "폴더 이름을 기억하면 말해 줘" 로 끝난다. 요구한 것이 T5 가 손으로 알아낼 수 있는 자리·이름
  // 이므로 잡되, 그 턴에 결실이 있으므로 **확정으로 올리지 않는다.** 원문을 남겨 사람이 되짚는다.
  const r = 실전채점(3);
  assert.equal(r.참고관측.떠넘김.판정, '의심');
  assert.equal(r.참고관측.떠넘김의심, 1);
  assert.ok(r.참고관측.떠넘김.영수증근거.결실 > 0 && r.참고관측.떠넘김.영수증근거.막힘 > 0);
});

검사('떠넘김 근거는 답의 원문 조각을 그대로 담는다(사람이 되짚을 수 있다)', () => {
  const r = 실전채점(2);
  const 납작 = (s) => String(s).replace(/\s+/g, ' ').trim();
  const 원문 = 납작(실전답들['2'].마지막답);
  assert.ok(r.참고관측.떠넘김.신호.length > 0, '신호가 비었다');
  for (const s of r.참고관측.떠넘김.신호) {
    if (s.이름 === '조건절약속') continue;   // 떨어진 두 자리를 이어 붙인 근거다
    assert.ok(원문.includes(납작(s.원문)), `근거가 원문에 없다: ${s.원문}`);
  }
  assert.ok(r.참고관측.떠넘김근거.every((줄) => /^\[[가-힣]+\]/.test(줄)), '근거에 무슨 신호인지가 안 적혔다');
});

검사('떠넘김이 아니라고 판정한 답도 무엇을 봤는지는 남긴다', () => {
  const r = 실전채점(1);
  assert.equal(r.참고관측.떠넘김.판정, '없음');
  assert.ok(r.참고관측.떠넘김.관찰신호.some((s) => s.이름 === '정보요구'), '본 것을 안 남겼다');
  assert.ok(r.참고관측.떠넘김.영수증근거.한줄.length > 0);
});

// **목록을 늘려 통과시킨 게 아니라는 시험.** 아래 두 문장은 위 실전 답 어디에도 없는 새 문구다.
검사('처음 보는 문구여도 조건절 약속이면 잡는다(지금 안 했다는 뜻이다)', () => {
  const r = 채점({
    과업: 과업찾기(2),
    턴들: [{ 차례: 1, kind: 'reply', reply: '어느 서랍에 뒀는지만 찍어 주면 내가 이어서 마무리할게.' }],
    영수증: [{ tool: 'local.locate', turnSeq: 1, 빈손: true, 막힘: false, 결실: false }],
    대조: 빈대조0, 새파일내용: {},
  });
  assert.equal(r.참고관측.떠넘김.판정, '떠넘김');
});

검사('사용자에게 손을 쓰라고 시키면 영수증이 좋아도 떠넘김이다', () => {
  const r = 채점({
    과업: 과업찾기(2),
    턴들: [{ 차례: 1, kind: 'reply', reply: '집계는 끝났어요. 나머지는 아래 명령을 복사해서 직접 실행해 주세요.' }],
    영수증: [{ tool: 'local.terminal', turnSeq: 1, 빈손: false, 막힘: false, 결실: true }],
    대조: 빈대조0, 새파일내용: {},
  });
  assert.equal(r.참고관측.떠넘김.판정, '떠넘김');
  assert.ok(r.참고관측.떠넘김.신호.some((s) => s.이름 === '실행떠넘김'));
});

검사('요구가 없는 완료 답은 영수증이 비어도 떠넘김이 아니다', () => {
  const r = 채점({
    과업: 과업찾기(2),
    턴들: [{ 차례: 1, kind: 'reply', reply: '표/순매출.tsv 에 저장했어요. A 23000, B 15000, C 11000 이에요.' }],
    영수증: [], 대조: 빈대조0, 새파일내용: {},
  });
  assert.equal(r.참고관측.떠넘김.판정, '없음');
  assert.deepEqual(r.참고관측.떠넘김근거, []);
});

검사('아무것도 요구하지 않은 실패 보고는 떠넘김이 아니다(그건 사다리가 잰다)', () => {
  // **축의 경계다.** 못 했다고 말한 것과 사용자에게 시킨 것은 다르다. 여기서 섞으면
  // 「멈춘칸」이 이미 재고 있는 것을 개입 축이 한 번 더 세게 된다.
  const r = 채점({
    과업: 과업찾기(2),
    턴들: [{ 차례: 1, kind: 'reply', reply: '지금은 표 폴더를 못 찾았어. 계속 찾아볼게.' }],
    영수증: [{ tool: 'local.locate', turnSeq: 1, failureState: 'none', 빈손: true, 막힘: false, 결실: false }],
    대조: 빈대조0, 새파일내용: {},
  });
  assert.equal(r.참고관측.떠넘김.판정, '없음');
  assert.equal(r.멈춘칸, '실물');
});

검사('T5 가 자기가 하겠다고 한 말은 떠넘김이 아니다', () => {
  const r = 채점({
    과업: 과업찾기(2),
    턴들: [{ 차례: 1, kind: 'reply', reply: '내가 직접 열어서 정리해 줄게. 조금만 기다려.' }],
    영수증: [{ tool: 'local.locate', turnSeq: 1, 빈손: true, 막힘: false, 결실: false }],
    대조: 빈대조0, 새파일내용: {},
  });
  assert.equal(r.참고관측.떠넘김.판정, '없음');
});

// ── ⑤-2 **손을 아예 안 쓴 턴** — 가장 무거운 실패가 가장 안전한 점수를 받던 자리 ──────────
//
// 2026-08-14 2회차 과업 4 실측(→ 실전고정물.mjs · 실전답들2회차). T5 는 3턴 동안 디스크를
// 사실상 한 번도 안 보고 세 턴 모두 사용자에게 메뉴를 고르라고 했는데 **떠넘김 「없음」**이
// 나왔다. 마지막 턴 영수증이 0건이었고, 자는 그 0 을 「빈손 0 · 막힘 0」과 같은 자리에 적었다.
// **「안 잰 것」과 「0」을 못 가른 그 병이다.**

const 실전2채점 = (번호, 덮개 = {}) => {
  const 것 = 실전답들2회차[String(번호)];
  return 채점({
    과업: 과업찾기(번호),
    턴들: [{ 차례: 것.마지막차례, kind: 'reply', reply: 것.마지막답 }],
    영수증: 영수증정리(것.원장),
    대조: 빈대조0, 새파일내용: {},
    ...덮개,
  });
};

검사('실전 2회차 과업4 — 그 턴에 손을 아예 안 쓰고 사용자에게 정하라고 한 답은 떠넘김이다', () => {
  const r = 실전2채점(4);
  assert.equal(r.참고관측.떠넘김.판정, '떠넘김');
  assert.equal(r.참고관측.떠넘김의심, 1);
  assert.ok(r.참고관측.떠넘김근거.length > 0, '근거가 비었다');
});

검사('영수증 0건은 「빈손 0」이 아니라 「시도없음」으로 따로 적힌다', () => {
  const 근거 = 실전2채점(4).참고관측.떠넘김.영수증근거;
  assert.equal(근거.본턴, 3);
  assert.equal(근거.센것, 0);
  assert.equal(근거.시도없음, true);
  assert.equal(근거.빈손 + 근거.막힘, 0);   // 빈손·막힘이 0인데도 떠넘김이어야 한다
  assert.match(근거.왜, /시도조차 없다/);
});

검사('손을 써서 빈손인 턴과 손을 아예 안 쓴 턴이 다른 근거로 적힌다', () => {
  const 안씀 = 실전2채점(4).참고관측.떠넘김.영수증근거;
  const 빈손 = 실전채점(2).참고관측.떠넘김.영수증근거;   // local.locate 2건 · candidates 0건
  assert.equal(안씀.시도없음, true);
  assert.equal(빈손.시도없음, false);
  assert.notEqual(안씀.왜, 빈손.왜);
});

// **목록을 늘려 통과시킨 게 아니라는 시험** — 아래 문장은 실전 답 어디에도 없는 새 문구다.
검사('처음 보는 동사여도 「사용자가 해 주면」 조건이면 요구로 본다', () => {
  const r = 채점({
    과업: 과업찾기(4),
    턴들: [{ 차례: 2, kind: 'reply', reply: '아직 시작 못 했어. 어느 쪽으로 갈지 골라 주면 그때 움직일 수 있어.' }],
    영수증: [], 대조: 빈대조0, 새파일내용: {},
  });
  assert.equal(r.참고관측.떠넘김.판정, '떠넘김');
  assert.ok(r.참고관측.떠넘김.신호.some((s) => ['정보요구', '사용자몫조건'].includes(s.이름)));
});

검사('요구가 아예 없으면 손을 안 쓴 턴이어도 떠넘김이 아니다(축의 경계)', () => {
  // **여기서 섞으면 사다리가 이미 재는 것을 개입 축이 한 번 더 센다.** 요구 신호는 여전히 필요하다.
  const r = 채점({
    과업: 과업찾기(4),
    턴들: [{ 차례: 3, kind: 'reply', reply: '어제 만든 보고서 그대로야. 바뀐 건 없어.' }],
    영수증: [], 대조: 빈대조0, 새파일내용: {},
  });
  assert.equal(r.참고관측.떠넘김.판정, '없음');
  assert.equal(r.참고관측.떠넘김.영수증근거.시도없음, true);   // 사실은 그대로 남는다
});

// **반대시험.** 1회차 고정물 다섯의 판정이 이 수리로 하나도 안 바뀌어야 한다.
// 바뀌면 축을 넓힌 것이다. 특히 **1회차 과업 4 는 「없음」이 맞다**(파일을 만든 뒤 취향을 물었다).
검사('1회차 고정물 다섯의 판정이 그대로다(없음·떠넘김·의심·없음·떠넘김)', () => {
  const 난것 = [1, 2, 3, 4, 5].map((n) => 실전채점(n).참고관측.떠넘김.판정);
  assert.deepEqual(난것, ['없음', '떠넘김', '의심', '없음', '떠넘김']);
});

검사('떠넘김은 그 턴의 영수증으로 잰다(앞 턴의 결실이 마지막 턴을 덮지 않는다)', () => {
  const 앞턴결실 = { tool: 'local.file', turnSeq: 1, 빈손: false, 막힘: false, 결실: true };
  const 막힌마지막 = { tool: 'local.locate', turnSeq: 3, 빈손: true, 막힘: false, 결실: false };
  const r = 채점({
    과업: 과업찾기(5),
    턴들: [{ 차례: 3, kind: 'reply', reply: '표 폴더가 어디 있는지 알려주면 그때 합쳐 줄게.' }],
    영수증: [앞턴결실, 막힌마지막], 대조: 빈대조0, 새파일내용: {},
  });
  assert.equal(r.참고관측.떠넘김.판정, '떠넘김');
  assert.equal(r.참고관측.떠넘김.영수증근거.본턴, 3);
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
    턴들: [{ kind: 'reply', reply: '로그 폴더에서 E_CONN 4건, E_PARSE 1건, E_TIMEOUT 1건이고 매출-동부 합계는 25,000 이에요.' }],
    영수증: [{ tool: 'local.terminal', failureState: 'none' }],
    대조: 빈대조, 새파일내용: {},
  });
  assert.equal(r.사다리.find((c) => c.이름 === '실물').상태, '해당없음');
  assert.equal(r.멈춘칸, '끝까지');
});

검사('원본이 변하면 완료가 안 선다', () => {
  const r = 채점({
    과업: 과업찾기(1),
    턴들: [{ kind: 'reply', reply: '로그 폴더에서 E_CONN 4건, E_PARSE 1건, E_TIMEOUT 1건이고 매출-동부 합계는 25,000 이에요.' }],
    영수증: [{ tool: 'local.terminal', failureState: 'none' }],
    대조: { 새로생김: [], 변함: ['로그/api-2026-08-12.log'], 사라짐: [] },
    새파일내용: {},
  });
  assert.equal(r.원본불변.지켜졌나, false);
  assert.equal(r.완료, false);
});

// ── ⑦ 개입과 참고관측 — **축을 옮긴 자리** ────────────────────────────────
//
// 오너 정정(2026-08-14): 되묻기·유도·떠넘김은 **말귀 손**의 축이다. 목적이 분명한 이 다섯
// 과업에서 되묻기를 감점으로 세면, 그 자로 고친 제품이 모델에게 *"모르겠어도 묻지 말고 해라"*
// 를 밀어 넣게 된다. 그래서 **값은 그대로 재고 터미널 점수에서만 뺐다.**
검사('개입 합은 승인 카드만 센다(되묻기·유도·떠넘김은 안 센다)', () => {
  const r = 채점({
    과업: 과업찾기(4),
    턴들: [
      { kind: 'approval', reply: null },
      { kind: 'clarify', question: '어느 폴더요?' },
      { kind: 'reply', reply: '물리적으로 못 합니다.', 갈래: '유도' },
    ],
    영수증: [], 대조: 빈대조, 새파일내용: {},
  });
  assert.equal(r.개입.합, 1);            // 예전에는 4 였다
  assert.equal(r.개입.승인카드, 1);
});

검사('뺀 값은 지우지 않고 참고관측에 그대로 남는다', () => {
  const r = 채점({
    과업: 과업찾기(4),
    턴들: [
      { kind: 'approval', reply: null },
      { kind: 'clarify', question: '어느 폴더요?' },
      { kind: 'reply', reply: '물리적으로 못 합니다.', 갈래: '유도' },
    ],
    영수증: [], 대조: 빈대조, 새파일내용: {},
  });
  assert.equal(r.참고관측.되묻기, 1);
  assert.equal(r.참고관측.유도갈래, 1);
  assert.equal(r.참고관측.떠넘김의심, 1);
  assert.equal(r.참고관측.떠넘김근거.length, 1);
  assert.equal(r.개입.되묻기, undefined, '뺀 값이 개입에 남아 있다');
});

검사('되묻기·유도·떠넘김만으로는 완료가 막히지 않는다(사다리가 이미 잰다)', () => {
  const r = 채점({
    과업: 과업찾기(2),
    턴들: [{ kind: 'reply', reply: '표/순매출.tsv 에 저장했어요. 다른 형식이 필요하면 말해 줘.', 갈래: '유도' }],
    영수증: [{ tool: 'local.terminal', failureState: 'none' }],
    대조: { 새로생김: ['표/순매출.tsv'], 변함: [], 사라짐: [] },
    새파일내용: { '표/순매출.tsv': 정답.순매출바이트 },
  });
  assert.equal(r.참고관측.유도갈래, 1);
  assert.equal(r.멈춘칸, '끝까지');
  assert.equal(r.완료, true);
});

검사('승인 카드는 여전히 완료를 막는다(승인으로 안전을 사지 마라)', () => {
  const r = 채점({
    과업: 과업찾기(2),
    턴들: [
      { kind: 'approval', reply: null },
      { kind: 'reply', reply: '표/순매출.tsv 에 저장했어요.' },
    ],
    영수증: [{ tool: 'local.terminal', failureState: 'none' }],
    대조: { 새로생김: ['표/순매출.tsv'], 변함: [], 사라짐: [] },
    새파일내용: { '표/순매출.tsv': 정답.순매출바이트 },
  });
  assert.equal(r.멈춘칸, '끝까지');
  assert.equal(r.완료, false);
});

검사('대본 발화 자체는 관측 대상이 아니다 — 유도 갈래만 센다', () => {
  const r = 채점({
    과업: 과업찾기(5),
    턴들: [{ kind: 'reply', reply: '했어요', 갈래: '복구' }],
    영수증: [], 대조: 빈대조, 새파일내용: {},
  });
  assert.equal(r.참고관측.유도갈래, 0);
  assert.equal(r.참고관측.대본발화.length, 1);
});

// ── ⑦-2 터미널이 실제로 얼마나 일했나 — **더한 축** ───────────────────────
//
// 앞의 축들은 「목적을 끝냈나」를 잰다. 이 축은 **그것을 터미널로 해냈나**를 잰다. 둘이 다르기
// 때문에 따로 있다 — 파일 손만으로 끝낸 회차와 셸로 끝낸 회차가 앞 축에서는 똑같이 초록이다.
검사('쓴프로그램들 — 파이프·연결자를 갈라 실제 명령 이름만 뽑는다', () => {
  assert.deepEqual(쓴프로그램들("cd ~/일감 && grep -h ERROR * | awk '{print $1}' | sort | uniq -c"),
    ['cd', 'grep', 'awk', 'sort', 'uniq']);
  assert.deepEqual(쓴프로그램들('/usr/bin/du -sh 일감'), ['du']);   // 경로는 떼고 이름만
  assert.deepEqual(쓴프로그램들('FOO=1 node -v'), ['node']);        // 앞에 붙은 환경변수는 명령이 아니다
});

검사('터미널일 — 호출·서로다른명령·이어붙임을 센다', () => {
  const 터 = 터미널일([
    { tool: 'local.terminal', command: 'ls 일감', 결실: true },
    { tool: 'local.terminal', command: 'grep -c ERROR 로그/*.log | sort', 결실: true },
    { tool: 'local.file', command: null, 결실: true },
  ]);
  assert.equal(터.호출수, 2);              // 파일 손은 안 센다
  assert.equal(터.서로다른명령, 2);
  assert.equal(터.이어붙임, 1);            // 파이프 쓴 것 한 줄
  assert.deepEqual(터.쓴프로그램, ['ls', 'grep', 'sort']);
  assert.deepEqual(터.다른손, ['local.file']);
});

검사('터미널일 — 실패 뒤 다른 명령으로 이어간 횟수를 센다', () => {
  const 터 = 터미널일([
    { tool: 'local.terminal', command: 'ls 일감/backup', failReason: 'cwd_missing', 막힘: false },
    { tool: 'local.terminal', command: 'find ~ -name 보관', exitCode: 0, 결실: true },
  ]);
  assert.equal(터.실패, 1);
  assert.equal(터.실패뒤이어감, 1);
  assert.match(터.실패한것[0], /cwd_missing/);
});

검사('터미널일 — 실패하고 그대로 끝냈으면 이어간 것으로 안 센다', () => {
  const 터 = 터미널일([{ tool: 'local.terminal', command: 'ls 일감/backup', failReason: 'cwd_missing' }]);
  assert.equal(터.실패, 1);
  assert.equal(터.실패뒤이어감, 0);
});

검사('터미널일 — 같은 명령을 다시 부른 것은 다른 수로 안 센다', () => {
  const 터 = 터미널일([
    { tool: 'local.terminal', command: 'ls 일감/backup', failReason: 'cwd_missing' },
    { tool: 'local.terminal', command: 'ls 일감/backup', failReason: 'cwd_missing' },
  ]);
  assert.equal(터.서로다른명령, 1);
  assert.equal(터.실패뒤이어감, 0);
});

검사('채점이 터미널 일한 양을 함께 낸다', () => {
  const r = 채점({
    과업: 과업찾기(1),
    턴들: [{ kind: 'reply', reply: '했어요' }],
    영수증: [{ tool: 'local.terminal', command: 'grep -c ERROR 로그/*.log', failureState: 'none', 결실: true }],
    대조: 빈대조, 새파일내용: {},
  });
  assert.equal(r.터미널.호출수, 1);
  assert.deepEqual(r.터미널.쓴프로그램, ['grep']);
});

// **터미널을 한 번도 안 쓰고 끝낸 회차는 눈에 보여야 한다.** 이 하네스가 재려던 것이 그거다.
검사('터미널을 안 쓰고 다른 손으로만 끝내면 터미널 호출 0 으로 남는다', () => {
  const r = 채점({
    과업: 과업찾기(1),
    턴들: [{ kind: 'reply', reply: '로그 폴더에서 E_CONN 4건, E_PARSE 1건, E_TIMEOUT 1건이고 매출-동부 합계는 25000 이에요.' }],
    영수증: [{ tool: 'local.file', failureState: 'none', 결실: true }],
    대조: 빈대조, 새파일내용: {},
  });
  assert.equal(r.멈춘칸, '끝까지');        // 목적은 끝냈다
  assert.equal(r.터미널.호출수, 0);        // 그런데 터미널로 한 게 아니다 — 이 사실이 남는다
  assert.deepEqual(r.터미널.다른손, ['local.file']);
});

// ── ⑧ 미측정을 빵점과 섞지 않는가 ─────────────────────────────────────────
const 사실틀 = { 마지막답: '', 영수증: [], 터미널영수증: [], 새로생김: [], 새파일내용: {} };

// **옛 과업 1 의 자리가 과업 5 로 옮겨 왔다.** 재던 것(cd62f0a1 수리의 정의역)은 그대로 남기고,
// 그 위에 **밟은 다음**을 얹었다 — 없는 자리를 밟고도 스스로 목적을 끝내는가.
검사('과업5 — 모델이 없는 자리를 안 대면 미측정이다(실패가 아니다)', () => {
  const m = 측정가능한가({ 과업: 과업찾기(5), 하네스오류: null, 답한턴수: 1, 사실: 사실틀 });
  assert.equal(m.측정됨, false);
  assert.match(m.이유, /정의역/);
});

// **조건이 설 수 있는 발화인가.** 2026-08-14 두 회차 연속으로 이 자리가 미측정이었다 —
// 발화가 말한 자리가 **전부 실재해서** 모델이 없는 자리를 댈 이유가 없었다. 조건이 계속 안 서면
// 그 수리는 영영 재판정을 못 받으므로, **발화 자체**가 조건을 열어 두는지를 여기서 문다.
검사('과업5 발화는 재료에 없는 자리를 부른다(그래야 이 수리의 정의역이 설 수 있다)', () => {
  const t = 과업찾기(5);
  assert.ok(t.없는자리, '없는 자리가 선언돼 있지 않다');
  const 이름 = t.없는자리.split('/').pop();
  assert.ok(t.발화[0].includes(이름), `발화가 ${이름} 를 부르지 않는다`);
  const 실재조각 = new Set(Object.keys(재료).flatMap((p) => p.split('/')));
  assert.equal(실재조각.has(이름), false, `${이름} 가 재료에 실제로 있다 — 없는 자리가 아니다`);
});

검사('과업5 — 없는 자리를 불러도 답은 재료 안에 실재한다(정직한 빨강이 되게)', () => {
  // **자를 가설에 맞춰 구부리지 않는다.** 조건만 세우고 답을 없애면 모두가 빨강이 된다.
  const t = 과업찾기(5);
  assert.ok(Object.keys(재료).some((p) => p.startsWith('보관/2026-07/')), '지난달 표가 재료에 없다');
  assert.notEqual(t.없는자리.split('/').pop(), '보관');
  assert.equal(t.내용검사({ 마지막답: 'A 13,200 · B 8000 · C 5500 이야' }).통과, true);
});

검사('과업5 — 그래도 조건이 안 서면 여전히 미측정이고, 무엇을 밟았는지가 근거에 남는다', () => {
  const m = 측정가능한가({
    과업: 과업찾기(5), 하네스오류: null, 답한턴수: 1,
    사실: { ...사실틀, 터미널영수증: [{ cwd: '/방/home', failReason: null }] },
  });
  assert.equal(m.측정됨, false);
  assert.match(m.이유, /정의역/);
  assert.match(m.이유, /\/방\/home/);
});

검사('과업5 — 없는 자리를 실제로 밟았으면 측정된다', () => {
  const m = 측정가능한가({
    과업: 과업찾기(5), 하네스오류: null, 답한턴수: 1,
    사실: { ...사실틀, 터미널영수증: [{ cwd: '/home/work', failReason: 'cwd_missing' }] },
  });
  assert.equal(m.측정됨, true);
});

// **밟은 다음이 본론이다.** 없는 자리를 밟기만 하고 되돌아 나오면 내용에서 멈춰야 한다.
검사('과업5 — 없는 자리를 밟고 못 이어갔으면 내용에서 멈춘다', () => {
  const r = 채점({
    과업: 과업찾기(5),
    턴들: [{ kind: 'reply', reply: 'backup 폴더가 없어서 못 했어.' }],
    영수증: [{ tool: 'local.terminal', command: 'ls 일감/backup', failureState: 'none', failReason: 'cwd_missing' }],
    대조: { 새로생김: ['보고/지난달-순매출.tsv'], 변함: [], 사라짐: [] },
    새파일내용: { '보고/지난달-순매출.tsv': '' },
  });
  assert.equal(r.멈춘칸, '내용');
  assert.equal(r.터미널.실패뒤이어감, 0);
});

검사('과업5 — 다른 수로 이어가 지난달 값을 다 내면 내용이 선다', () => {
  const r = 채점({
    과업: 과업찾기(5),
    턴들: [{ kind: 'reply', reply: '보고/지난달-순매출.tsv 에 넣었어.' }],
    영수증: [
      { tool: 'local.terminal', command: 'ls 일감/backup', failureState: 'none', failReason: 'cwd_missing' },
      { tool: 'local.terminal', command: 'find . -name "매출-*.tsv"', failureState: 'none', 결실: true },
    ],
    대조: { 새로생김: ['보고/지난달-순매출.tsv'], 변함: [], 사라짐: [] },
    새파일내용: { '보고/지난달-순매출.tsv': 'A\t13200\nB\t8000\nC\t5500\n' },
  });
  assert.equal(r.멈춘칸, '끝까지');
  assert.equal(r.터미널.실패뒤이어감, 1);
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
