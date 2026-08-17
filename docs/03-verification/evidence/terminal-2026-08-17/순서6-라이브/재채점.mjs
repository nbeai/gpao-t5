// 순서 6 라이브 소검증 — 배관 정정 재채점(§7-cg-1 · 채점 전 검문 「조정 · 조건 4」 절차).
// 하는 것: 보존 원본(회차N.json + 회차N-덤프/ — a8a88639 정정 전 단독 커밋)의
// 마지막모델입력만 올바른 입력 규칙(prompt-dump.js 명명 규약 — 접미사 없는 파일이 입력)으로
// 재유도해 **커밋된 채점기의 채점() 그대로** 호출한다. 원본 JSON 덮어쓰기 금지 —
// 결과는 재채점.json 별도 파일. 축A·축D·계기 정의 0줄 접촉.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { 채점 } from './채점기.mjs';

const 여기 = dirname(fileURLToPath(import.meta.url));
const 결과 = { 자: '재채점(배관 정정 — 마지막모델입력 재유도)', 원본커밋: 'a8a88639', 회차들: [] };
for (const n of [1, 2, 3]) {
  const 회차 = JSON.parse(await readFile(join(여기, `회차${n}.json`), 'utf8'));
  const 덤프들 = (await readdir(join(여기, `회차${n}-덤프`))).sort();
  const 입력들 = 덤프들.filter((f) => !f.includes('-out-') && !f.includes('손제시'));
  const 마지막 = 입력들[입력들.length - 1];
  const 재유도 = 마지막 ? await readFile(join(여기, `회차${n}-덤프`, 마지막), 'utf8') : '';
  결과.회차들.push({
    ...채점({ ...회차, 마지막모델입력: 재유도 }),
    재유도출처: 마지막 ?? null, 원문채점의계기: '(원본 커밋 메시지 참조 — 1·3 빨강·무효)',
  });
}
await writeFile(join(여기, '재채점.json'), JSON.stringify(결과, null, 1));
console.log(JSON.stringify(결과, null, 1));
