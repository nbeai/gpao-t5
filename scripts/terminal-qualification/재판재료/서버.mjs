// 완성 재판 방 재료 ⑧ — **실재 소형 서버** (§7-az-2 · 고정 포트 34117 · 하네스가 ps·curl 로 재고 끝에 죽인다)
import { createServer } from 'node:http';
const 포트 = 34117;
createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); res.end('재판 서버 살아 있음\n'); })
  .listen(포트, '127.0.0.1', () => console.log(`듣는 중: http://127.0.0.1:${포트}`));
