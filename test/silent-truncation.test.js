// **조용히 자르지 않는다** — 모델 앞 현실을 런타임이 대신 줄이고 그 사실을 숨기지 않는다.
//
// 오너 라이브 실측(2026-08-03, 실모델 gpt-5.1). "내 다운로드 폴더 정리하자" 한 마디에
// T5 는 다섯 턴 내내 같은 계획만 되풀이하고 아무 것도 하지 않았다. 원인은 모델이 아니었다:
//
//   폴더에 있던 것            437개
//   `compactResult` 가 고른 것  40개  (`slice(0, 40)`)
//   1200자에서 다시 잘려        23개  ← 모델이 실제로 받은 것 (5%)
//   요약은                     "437개를 찾았어요"
//   잘렸다는 말은               마침표 세 개(…)가 전부
//
// 나머지를 가져올 인자(offset·limit)도 없다. 모델은 "437개가 있다"는 말과 23개의 이름을 받은
// 채, 같은 프롬프트의 다른 블록에서 "확인이나 예고만으로 한 턴을 소비하지 말라"는 요구까지
// 받았다. **불가능한 자리다.** 되풀이는 모델의 고집이 아니라 런타임이 대신 판단하고 그 사실을
// 숨긴 결과였다(오너 기준 위반: 「모델 앞 현실을 정확히 주는가, 아니면 Runtime이 판단을
// 대신하는가」).
//
// 이 검사가 지키는 것은 문구가 아니라 **두 사실**이다: 얼마나 뺐는가 · 전체가 몇인가.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactResult } from '../src/kernel/l1-intent/task-context.js';

const 파일들 = (n, 접두 = 'f') => Array.from({ length: n }, (_, i) => ({
  name: `${접두}${String(i).padStart(3, '0')}-이름이-제법-긴-파일.pdf`,
  kind: 'file',
  modifiedAt: new Date(Date.now() - (i + 1) * 86_400_000).toISOString(),
}));

test('다 실을 수 있으면 군더더기 없이 다 준다', () => {
  const out = compactResult({ path: '/집/다운로드', items: 파일들(5) });
  for (const f of 파일들(5)) assert.ok(out.includes(f.name), `${f.name} 이 빠졌다`);
  assert.ok(!/싣지 못했다/.test(out), '다 실었는데 못 실었다고 말한다');
});

// ── 여기가 이 검사의 핵심 ────────────────────────────────────────────────
test('다 못 실으면 **몇 개를 뺐는지와 전체가 몇인지**를 말한다', () => {
  const out = compactResult({ path: '/집/다운로드', items: 파일들(437) });
  const 실은수 = (out.match(/^- /gm) ?? []).length;
  assert.ok(실은수 < 437, '전제: 437개는 다 안 실린다');

  const 뺀것 = out.match(/나머지 (\d+)개는 이 답에 이름을 싣지 못했다/);
  assert.ok(뺀것, `무엇을 뺐는지 말하지 않았다 — 모델은 5%를 전부로 믿는다:\n${out.slice(-300)}`);
  assert.equal(Number(뺀것[1]), 437 - 실은수, '뺀 개수가 실제와 다르다');
  assert.match(out, /전체 437개/, '전체가 몇인지 말하지 않았다');
});

test('뺀 부분을 판단할 재료를 준다 — 이름이 아니라 분포다', () => {
  const 섞인것 = [
    ...파일들(300, 'a'),
    ...Array.from({ length: 60 }, (_, i) => ({
      name: `설치본${i}.dmg`, kind: 'file', modifiedAt: new Date(Date.now() - 400 * 86_400_000).toISOString(),
    })),
  ];
  const out = compactResult({ path: '/집/다운로드', items: 섞인것 });
  assert.match(out, /확장자:/, '못 실은 것의 확장자 분포가 없다 — "오래된 설치파일 정리"를 판단할 수 없다');
  assert.match(out, /\.dmg \d+개/, 'dmg 가 몇 개인지 모른 채 정리하라고 시킨 셈이다');
  assert.match(out, /고친 때:/, '못 실은 것의 나이 분포가 없다 — "6개월 지난 것"을 판단할 수 없다');
  assert.match(out, /180일 넘음 \d+개/, '오래된 것이 몇 개인지 말하지 않았다');
});

test('이름이 더 필요할 때 갈 길을 알려 준다(막다른 길로 두지 않는다)', () => {
  const out = compactResult({ path: '/집/다운로드', items: 파일들(437) });
  assert.match(out, /더 좁은 폴더|명령을 쓴다/, '나머지를 가져올 길이 없다고 모델이 결론 내리면 그 턴은 계획으로 끝난다');
});

// ── 같은 계열이 옆에서 새지 않게 ─────────────────────────────────────────
test('링크도 조용히 자르지 않는다', () => {
  const out = compactResult({
    markdown: '본문', links: Array.from({ length: 20 }, (_, i) => `https://ex.com/${i}`),
  });
  assert.match(out, /전체 20개 중 6개만 실음/, `링크를 말없이 6개로 줄였다: ${out}`);
});

test('비교 후보도 조용히 자르지 않는다', () => {
  const out = compactResult({
    markdown: '본문',
    comparisonCandidates: Array.from({ length: 9 }, (_, i) => ({ rank: i + 1, title: `t${i}`, url: `u${i}` })),
  });
  assert.match(out, /비교 후보 9개 중 위 3개만 싣는다/, `후보를 말없이 3개로 줄였다: ${out}`);
});
