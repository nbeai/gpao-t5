// 완성 재판 방 재료 ⑤ — **실재 실행물** (§7-az-2 · 결정적 · 오프라인 · 방 재료를 스스로 다룬다)
// 이 방의 md 문서를 세고 바이트 합계를 집계결과.txt 로 남긴다. 지어낸 퍼즐이 아니라
// 이 저장소가 회차마다 하는 그 일(재료실측)의 방 안 판이다.
import { readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const 뿌리 = process.cwd();
const 줄들 = [];
let 합 = 0; let 수 = 0;
async function 걷기(d) {
  for (const e of (await readdir(d, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') await 걷기(p); continue; }
    if (!e.name.endsWith('.md')) continue;
    const s = await stat(p); 수 += 1; 합 += s.size;
    줄들.push(`${s.size}\t${p.slice(뿌리.length + 1)}`);
  }
}
await 걷기(뿌리);
const 본문 = `md ${수}개 · 합계 ${합}바이트\n${줄들.join('\n')}\n`;
await writeFile(join(뿌리, '집계결과.txt'), 본문);
console.log(본문);
