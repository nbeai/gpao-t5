// **고정물 한 채** — 라이브 5회가 같은 방에서 열린다. 바뀌는 것은 과업 문장뿐이다.
//
// 왜 한 채인가: 2026-08-14 라이브 7회가 회차마다 새 하네스를 달고 갔고, 시험 만들기가
// 개발을 잡아먹었다. 재료는 여기 한 자리에서만 정의하고, 회차는 이 정의를 **새 임시 방에**
// 그대로 펼친다. 방을 회차마다 새로 파는 것은 「원본 불변」을 재려면 회차가 서로를 안 밟아야
// 하기 때문이다 — 재료가 하나인 것과 방이 하나인 것은 다른 얘기다.
//
// 격리는 정본 §9-1 그대로다: `HOME` 까지 옮긴다(터미널이 끼는 판이라 홈을 안 옮기면
// 오너의 실제 홈이 셸 안에서 그대로 보인다).
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, dirname } from 'node:path';

export const 방이름 = '일감';

/**
 * **재료 정본.** 키는 `일감/` 아래 상대경로다. 값은 파일 내용 그대로.
 *
 * 안에 심은 것 넷:
 *   · 로그 셋      — 코드별 집계가 딱 떨어진다(E_CONN 4 · E_PARSE 1 · E_TIMEOUT 1)
 *   · 표 셋        — 순매출이 딱 떨어진다(A 23000 · B 15000 · C 11000)
 *   · 문서 둘      — 하나는 무관, 하나는 「지난달 표는 보관 폴더로 옮겼다」를 말한다
 *   · 보관/2026-07 — **이름이 같은 파일 셋**. 이번 달 것과 헷갈릴 자리를 일부러 만든다
 */
export const 재료 = Object.freeze({
  '로그/api-2026-08-12.log':
    '2026-08-12 10:00 INFO 시작\n'
    + '2026-08-12 10:03 ERROR E_CONN 상류 연결이 끊겼다\n'
    + '2026-08-12 10:07 ERROR E_PARSE 응답 형식이 이상하다\n'
    + '2026-08-12 11:20 INFO 정상\n',
  '로그/api-2026-08-13.log':
    '2026-08-13 09:12 ERROR E_CONN 상류 연결이 끊겼다\n'
    + '2026-08-13 09:15 ERROR E_CONN 재시도가 실패했다\n'
    + '2026-08-13 14:02 INFO 정상\n',
  '로그/worker-2026-08-13.log':
    '2026-08-13 08:00 INFO 시작\n'
    + '2026-08-13 08:41 ERROR E_TIMEOUT 작업이 60초를 넘겼다\n'
    + '2026-08-13 09:15 ERROR E_CONN 재시도가 실패했다\n',
  '표/매출-동부.tsv': 'A\t10000\nB\t15000\n',
  '표/매출-서부.tsv': 'A\t15000\nC\t11000\n',
  '표/환불.tsv': 'A\t2000\n',
  '문서/회의메모-2026-08-10.md':
    '# 주간 회의 2026-08-10\n\n'
    + '- 배포는 목요일로 미룬다.\n'
    + '- 로그에 E_CONN 이 계속 뜬다는 얘기가 나왔다. 원인은 아직 모른다.\n'
    + '- 다음 회의 때 표 정리 상태를 본다.\n',
  '문서/회의메모-2026-08-12.md':
    '# 주간 회의 2026-08-12\n\n'
    + '- 7월 매출 표는 보관 폴더로 옮겨 뒀다. 이번 달 것과 섞이지 않게.\n'
    + '- 7월은 B 제품이 예상보다 약했다. 8월에 다시 본다.\n'
    + '- 환불은 7월에 B 에서 한 건 있었다.\n',
  // 지난달 숫자는 **이번 달 것과도, 자기 원본 값과도 겹치지 않게** 골랐다. 겹치면 과업 5 에서
  // 「방향을 따라왔다」와 「원본 숫자를 그냥 읊었다」를 구별할 수 없다(self-check 가 이걸 문다).
  '보관/2026-07/매출-동부.tsv': 'A\t8200\nB\t9000\n',
  '보관/2026-07/매출-서부.tsv': 'A\t5000\nC\t6000\n',
  '보관/2026-07/환불.tsv': 'B\t1000\nC\t500\n',
});

/** 재료에서 곧바로 나오는 **정답 사실**. 채점자가 여기만 본다(문제와 답이 갈리지 않게). */
export const 정답 = Object.freeze({
  // 과업 1 — 로그 폴더의 코드별 ERROR 건수
  코드별에러: Object.freeze({ E_CONN: 4, E_PARSE: 1, E_TIMEOUT: 1 }),
  // 과업 2 — 이번 달 순매출(동부+서부-환불), A·B·C 순서, 헤더 없음, 탭 구분
  순매출바이트: 'A\t23000\nB\t15000\nC\t11000\n',
  // 과업 5 — 지난달(보관/2026-07) 순매출
  지난달순매출: Object.freeze({ A: 13200, B: 8000, C: 5500 }),
});

const sha256 = (v) => createHash('sha256').update(v).digest('hex');

/**
 * 재료를 **새 임시 방**에 펼친다. 오너의 실제 홈은 이 함수의 어느 경로에도 안 나온다.
 * @returns {Promise<{뿌리:string, 홈:string, 상태:string, 작업:string}>}
 */
export async function 방펼치기() {
  const 뿌리 = await mkdtemp(join(tmpdir(), 't5-live5-'));
  const 홈 = join(뿌리, 'home');
  const 상태 = join(뿌리, 'state');
  const 작업 = join(홈, 방이름);
  await mkdir(상태, { recursive: true });
  await mkdir(작업, { recursive: true });
  for (const [상대, 내용] of Object.entries(재료)) {
    const 자리 = join(작업, 상대);
    await mkdir(dirname(자리), { recursive: true });
    await writeFile(자리, 내용, 'utf8');
  }
  return { 뿌리, 홈, 상태, 작업 };
}

/** 작업 폴더 전체를 상대경로 → {sha, 크기} 로 찍는다. 회차 전후로 두 번 찍어 대조한다. */
export async function 사진(작업) {
  const 결과 = {};
  const 훑기 = async (자리) => {
    let 목록;
    try { 목록 = await readdir(자리, { withFileTypes: true }); } catch { return; }
    for (const 것 of 목록) {
      const 절대 = join(자리, 것.name);
      if (것.isDirectory()) { await 훑기(절대); continue; }
      if (!것.isFile()) continue;
      try {
        const 몸 = await readFile(절대);
        결과[relative(작업, 절대)] = { sha: sha256(몸), 크기: (await stat(절대)).size };
      } catch { /* 읽다 사라진 파일은 대조에서 「사라짐」으로 잡힌다 */ }
    }
  };
  await 훑기(작업);
  return 결과;
}

/**
 * 두 사진을 댄다. **판정하지 않고 사실만 낸다** — 무엇이 실패인지는 채점자가 정한다.
 * @returns {{새로생김:string[], 변함:string[], 사라짐:string[]}}
 */
export function 사진대조(앞, 뒤) {
  const 새로생김 = Object.keys(뒤).filter((k) => !(k in 앞));
  const 사라짐 = Object.keys(앞).filter((k) => !(k in 뒤));
  const 변함 = Object.keys(앞).filter((k) => k in 뒤 && 뒤[k].sha !== 앞[k].sha);
  return { 새로생김, 변함, 사라짐 };
}

/** 회차 뒤에 새로 생긴 파일의 내용을 읽어 온다(채점에 쓴다). 없는 것은 조용히 건너뛴다. */
export async function 새파일읽기(작업, 새로생김) {
  const 결과 = {};
  for (const 상대 of 새로생김) {
    try { 결과[상대] = await readFile(join(작업, 상대), 'utf8'); } catch { /* 이진·삭제 */ }
  }
  return 결과;
}
