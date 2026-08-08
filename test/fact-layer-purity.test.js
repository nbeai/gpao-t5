// **§1-B 게이트 불변식의 반대시험** — 「손이 세는 사실은 도메인 낱말 없이 참이어야 한다」
// (오너 지시 2026-08-09 · 규격 4: 사실 층에 도메인 낱말 분기를 심으면 게이트가 빨개져야 한다).
//
// 게이트와 같은 기계(fact-purity.mjs 한 벌)를 심은 소스로 불러 무는 것을 확인한다 —
// 반대시험 없는 불변식은 장식이다(봉인 계약과 같은 이유).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { 사실층정의역, 업종어휘위반, 미등록사실층 } from '../scripts/checks/fact-purity.mjs';

test('현재 사실 층 코드에 업종 어휘 0건 — 기준선 0 하드 · 상향 금지', async () => {
  const 파일들 = await Promise.all(사실층정의역.map(async (path) => ({
    path, src: await readFile(new URL(`../${path}`, import.meta.url), 'utf8'),
  })));
  const 위반 = 업종어휘위반(파일들);
  assert.deepEqual(위반.map((x) => x.줄), [], '사실 층에 업종 어휘가 스몄다 — §1-B 위반');
});

test('반대시험: 사실 층에 도메인 낱말 분기를 심으면 게이트가 빨개진다', () => {
  const 심은것 = [
    { path: 'src/runtime/local-file.js', src: 'if (이름.includes("정산")) 합 += 값;' },   // 분기
    { path: 'src/runtime/local-file.js', src: 'const 라벨 = "매출 합계";' },              // 사실 층의 라벨
    { path: 'src/kernel/l2-plan/exit-verification.js', src: 'if (/정산내역/.test(t)) return;' }, // 한글 합성어 — 경계 검사는 이걸 놓친다
  ];
  for (const p of 심은것) {
    assert.ok(업종어휘위반([p]).length >= 1, `심은 도메인 분기가 안 잡혔다: ${p.src}`);
  }
});

test('경계: 총·전체·합계(일반 수량어)와 실측 인용 주석은 대상이 아니다', () => {
  const 정상 = [
    { path: 'x.js', src: 'if (/총|전체|합계/.test(reply)) return 사실되부름();' },        // 규격 5 — 세 성질 관할
    { path: 'x.js', src: '// 실측(2026-08-08): 모델이 "정산 합계"를 지어냈다 — 근거 인용\nconst n = 1;' },
    { path: 'x.js', src: 'const kinds = [/글|원고|메모/i, "notes"];' },                    // 내용 종류 낱말 — 포괄 분류
  ];
  assert.deepEqual(업종어휘위반(정상), [], '경계 낱말·주석 인용이 걸렸다 — 과잉 금지는 정상 코드를 막는다');
});

test('등록 없는 사실 층 추가는 잡힌다 — 표지가 코드에 있는데 정의역에 없다', () => {
  const 파일들 = [
    { path: 'src/kernel/new-net.js', src: 'const f = r.result.같은자리표;' },
    { path: 'src/kernel/clean.js', src: 'const x = 1; // 표맥락 이야기는 주석뿐' },
  ];
  assert.deepEqual(미등록사실층(파일들), ['src/kernel/new-net.js'],
    '표지가 코드에 있는 미등록 파일이 안 잡히거나, 주석만 있는 파일이 잡혔다');
});

test('실제 src 전체에서 미등록 사실 층 0 — 표지는 정의역 다섯 파일에만 산다', async () => {
  const 훑기 = async (dir) => {
    const out = [];
    for (const e of await readdir(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })) {
      if (e.isDirectory()) out.push(...await 훑기(`${dir}/${e.name}`));
      else if (e.name.endsWith('.js')) out.push(`${dir}/${e.name}`);
    }
    return out;
  };
  const 전체 = await Promise.all((await 훑기('src')).map(async (path) => ({
    path, src: await readFile(new URL(`../${path}`, import.meta.url), 'utf8'),
  })));
  assert.deepEqual(미등록사실층(전체), [], '등록 없는 사실 층이 실제 소스에 있다 — 정의역 목록에 등록하라(§1-B 규격 1)');
});
