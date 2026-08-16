#!/usr/bin/env node
// 세션 시작 점검 — 정본 `design/T5-FINAL-ASSEMBLY-ko.md` §4-c 의 집행부.
//
// 왜 있나(§4-c 본문 그대로):
//   세션을 네 번 루프에 태운 범인은 결함이 아니라 **잘못된 지도**였다. 인계서가 이미 끝났거나
//   반박된 일을 「다음 걸음」으로 가리켰고, 낡은 로컬 기준점 하나가 66배 오차(1,292 vs 실측 20)를
//   만들었다. 그 병을 진단한 감사 문서 자신도 39커밋 만에 같은 병을 앓았다.
//
//   §4-c 는 「숫자는 베끼지 말고 재라 · 낡음은 읽는 네가 처음 발견한다」로 답했다. 그런데 재는 일을
//   사람에게 시키면 언젠가 잊는다 — 잊은 그 한 번이 다음 세션을 늪으로 보낸다. 그래서 세션이
//   열릴 때 **기계가 대신 잰다**. §4-c ④ 가 지목한 「세션 시작 점검」이 이 파일이다.
//
// 이 점검은 경고하지 않는다 — **사실만 적는다.** 판단은 읽는 세션이 한다.
//   (오너 원칙: 강제가 아니라 유도. 규칙을 박으면 모델이 판단을 안 한다.)
//
// 계약: 무슨 일이 있어도 세션을 막지 않는다. 모든 실패는 삼키고 조용히 끝낸다.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// 도장이 있어야 할 지도들 — §4-c ① 의 정의역(정본·인계서·지도).
// 늘릴 때는 여기에. 날짜가 박힌 증거 문서는 스스로 낡는 것이 정상이므로 넣지 않는다.
const 지도들 = [
  ['design/NEXT-SESSION.md', '인계서'],
  ['design/T5-FINAL-ASSEMBLY-ko.md', '정본'],
  ['design/T5-STATE-MAP-ko.md', '지도'],
];

function git(...인자) {
  try {
    return execFileSync('git', 인자, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

// 문서 머리에서 기준 시점 도장을 읽는다. 형식이 통일돼 있지 않으므로 쓰이는 표현을 모두 받는다.
function 도장읽기(경로) {
  let 본문;
  try {
    본문 = readFileSync(경로, 'utf8');
  } catch {
    return { 상태: '문서없음' };
  }
  const 머리 = 본문.split('\n').slice(0, 12).join('\n');
  const m = 머리.match(/(?:기준 커밋|기준 시점|기준 해시|HEAD)\s*[:：]?\s*([0-9a-f]{7,40})/);
  if (!m) return { 상태: '도장없음' };
  const 해시 = m[1];
  if (git('cat-file', '-e', `${해시}^{commit}`) === null) return { 상태: '모르는해시', 해시 };
  const 차이 = git('rev-list', '--count', `${해시}..HEAD`);
  if (차이 === null) return { 상태: '모르는해시', 해시 };
  return { 상태: '있음', 해시, 차이: Number(차이) };
}

function 본문만들기() {
  if (git('rev-parse', '--git-dir') === null) return null;   // 저장소가 아니면 조용히 끝낸다

  const head = git('rev-parse', '--short', 'HEAD') ?? '?';
  const 가지 = git('rev-parse', '--abbrev-ref', 'HEAD') ?? '?';

  const 줄 = [];
  줄.push(`[세션 시작 점검 · 정본 §4-c]  지금 HEAD ${head} (${가지})`);
  줄.push('');
  줄.push('지도의 나이 — 도장을 찍은 뒤 저장소가 얼마나 움직였나 (이 점검이 방금 잰 값)');

  let 낡음있음 = false;
  let 도장빔 = false;

  for (const [경로, 이름] of 지도들) {
    const 짧은이름 = 경로.split('/').pop();
    const r = 도장읽기(경로);
    if (r.상태 === '문서없음') continue;
    if (r.상태 === '도장없음') {
      도장빔 = true;
      줄.push(`  ${이름.padEnd(4)} ${짧은이름.padEnd(26)} 도장 없음 — §4-c ① 미이행`);
    } else if (r.상태 === '모르는해시') {
      줄.push(`  ${이름.padEnd(4)} ${짧은이름.padEnd(26)} 도장 ${r.해시} 를 이 저장소가 모른다`);
    } else if (r.차이 === 0) {
      줄.push(`  ${이름.padEnd(4)} ${짧은이름.padEnd(26)} ${r.해시} — HEAD 와 같다`);
    } else {
      낡음있음 = true;
      줄.push(`  ${이름.padEnd(4)} ${짧은이름.padEnd(26)} ${r.해시} 이후 ${r.차이} 커밋`);
    }
  }

  // §4-c ④ — 로컬 참조는 origin 과 대조한다. (fetch 는 하지 않는다: 느리고 부작용이 있다)
  const 뒤처짐 = git('rev-list', '--count', 'main..origin/main');
  if (뒤처짐 !== null) {
    const n = Number(뒤처짐);
    줄.push('');
    줄.push(n === 0
      ? '로컬 참조   main = origin/main'
      : `로컬 참조   main 이 origin/main 보다 ${n} 커밋 뒤 — 「main..브랜치」로 세면 거짓값이 나온다`);
    if (n > 0) 줄.push('            고치기: git fetch origin && git update-ref refs/heads/main origin/main');
  }

  줄.push('');
  if (낡음있음) {
    줄.push('낡은 지도가 있다. 「다음 걸음」·「남은 것」류 지시는 정본과 대조하고 출발하라 —');
    줄.push('이미 끝났거나 반박된 자리를 가리키고 있을 수 있다(§4-c 가 기록한 네 번 루프의 범인).');
  }
  if (도장빔) {
    줄.push('도장이 빈 문서는 나이를 잴 수 없다. 그 문서를 고치는 세션이 그 자리에서 도장을 찍는다(§4-c ③).');
  }
  줄.push('문서에 적힌 숫자(검사 수·커밋 수·게이트 값)는 베끼지 말고 직접 재라(§4-c ②).');

  return 줄.join('\n');
}

try {
  const 본문 = 본문만들기();
  if (본문) process.stdout.write(`${본문}\n`);
} catch {
  // 점검이 세션을 막는 일은 없다.
}
