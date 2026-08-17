// 순서 7 · 축1 정정 후 **보존 덤프 재채점**(회차 재실행 0 — 순서 6 재채점 판례 동형).
// 원본 JSON 은 덮어쓰지 않는다. 결과는 재채점.json 별도 파일.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { 기억발화, 표정규식, 답쓴호출입력 } from './order7-memory-conflict.mjs';

const 자리 = join(dirname(fileURLToPath(import.meta.url)),
  '../../docs/03-verification/evidence/terminal-2026-08-17/순서7-라이브');
const 결과 = { 자: '축1 정정 후 재채점(보존 덤프 · 회차 재실행 0)', 정정근거: 'model-provider.js:409', 판: [] };
for (const 이름 of ['극A', '극B', '기저1', '기저2']) {
  let 원본;
  try { 원본 = JSON.parse(await readFile(join(자리, `${이름}.json`), 'utf8')); } catch { continue; }
  const 덤프 = join(자리, `${이름}-덤프`);
  let 축1 = '덤프 미보존 — 되짚을 수 없음';
  let 실린블록 = '덤프 미보존';
  let 답호출 = null;
  try {
    await readdir(덤프);
    const h = await 답쓴호출입력(덤프);
    답호출 = { 입력파일: h.파일, out파일: h.out파일 };
    const 문장 = 기억발화.replace(/\.$/, '');
    const 블록몸 = (n) => {
      const i = h.글.indexOf(n);
      if (i < 0) return null;
      const 다음 = h.글.indexOf('\n[', i + 1);
      return h.글.slice(i, 다음 < 0 ? undefined : 다음);
    };
    실린블록 = 블록몸('[저장된 기본값')?.includes(문장) ? '지시 블록(저장된 기본값)'
      : 블록몸('[사용자에 대해 알고 있는 것')?.includes(문장) ? '사실 블록(알고 있는 것)'
        : h.글.includes(문장) ? '블록 밖' : '미실림';
    축1 = !원본.기억심기 ? '해당없음(기억 없는 판)'
      : h.글.includes(문장) ? '측정 성립' : '측정 불성립(기억 미실림)';
  } catch { /* 덤프 없음 — 위 기본값 유지 */ }
  결과.판.push({
    이름, 원문축1: 원본.축1 ?? null, 재채점축1: 축1, 실린블록, 답호출,
    축2: 표정규식.test(String(원본.reply ?? '')) ? '표' : '표 아님',
    개입: 원본.개입, kind: 원본.kind,
  });
}
await writeFile(join(자리, '재채점.json'), JSON.stringify(결과, null, 1));
console.log(JSON.stringify(결과, null, 1));
