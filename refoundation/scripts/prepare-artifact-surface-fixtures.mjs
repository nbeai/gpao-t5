#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

import { strToU8, zipSync } from 'fflate';
import { makeBarChart, makeBarSeries, makeChartSpace } from '@office-kit/xlsx/chart';
import { addChartAt } from '@office-kit/xlsx/drawing';
import { loadWorkbook, workbookToBytes } from '@office-kit/xlsx/io';
import { fromBuffer } from '@office-kit/xlsx/node';

import { createWorkbookFromSpec } from '../src/document-data-inspector.js';

function makePdf(text) {
  const escaped = text.replace(/[()\\]/g, '\\$&');
  const stream = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n'; const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

const output = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new TypeError('output directory is required');
await mkdir(output, { recursive: true, mode: 0o700 });

const files = {
  html: join(output, '스피치강사_홈페이지.html'),
  svg: join(output, '브랜드_시안.svg'),
  image: join(output, '브랜드_색상.png'),
  pdf: join(output, '상담_요약.pdf'),
  docx: join(output, '상담_제안서.docx'),
  xlsx: join(output, '월간_매출.xlsx'),
  csv: join(output, '고객_목록.csv'),
  webApp: join(output, '예약_대시보드.zip'),
};

await writeFile(files.html, `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>말의 힘</title><style>*{box-sizing:border-box}body{margin:0;font-family:-apple-system,sans-serif;color:#172b3b;background:#faf7f0}.hero{min-height:78vh;display:grid;grid-template-columns:1.2fr 1fr;align-items:center;padding:8vw}.eyebrow{color:#a66a1f;font-weight:700;letter-spacing:.14em}h1{font-size:clamp(48px,8vw,96px);line-height:.98;margin:.25em 0}.portrait{height:480px;border-radius:180px 180px 24px 24px;background:#e6b27f;display:grid;place-items:center;font-size:100px}.cta{display:inline-block;padding:14px 22px;border:0;border-radius:28px;background:#172b3b;color:white;font-weight:700}</style></head><body><main class="hero"><section><div class="eyebrow">SPEECH COACH · COMMUNICATION</div><h1>말의 힘을<br>당신의 경쟁력으로.</h1><p>발표, 면접, 리더 커뮤니케이션까지 당신만의 목소리를 함께 만듭니다.</p><button class="cta" onclick="console.log('상담 버튼을 눌렀어요')">1:1 상담 신청하기 →</button></section><div class="portrait">🎙️</div></main></body></html>`, { mode: 0o600 });

await writeFile(files.svg, `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560" viewBox="0 0 900 560"><rect width="900" height="560" fill="#f7f3ea"/><circle cx="665" cy="245" r="150" fill="#e3ad78"/><rect x="80" y="95" width="460" height="370" rx="32" fill="#fff"/><text x="125" y="190" font-family="sans-serif" font-size="26" fill="#a66a1f">VOICE &amp; SPEECH</text><text x="125" y="275" font-family="sans-serif" font-weight="700" font-size="55" fill="#172b3b">말의 힘을</text><text x="125" y="345" font-family="sans-serif" font-weight="700" font-size="55" fill="#172b3b">경쟁력으로.</text></svg>`, { mode: 0o600 });

await writeFile(files.image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAC0lEQVR42u3PAQ0AAAgDINc/9K3hHFQgE1vOOblcLpdL5XK5XC6Xy+VyuVwul8vlcrlcLpfL5XK5XC6Xy+VyuVwu12sBBNzcvb4AAAAASUVORK5CYII=', 'base64'), { mode: 0o600 });
await writeFile(files.pdf, makePdf('T5 client consultation summary - verified preview'), { mode: 0o600 });

await writeFile(files.docx, Buffer.from(zipSync({
  '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
  'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>스피치 코칭 제안서</w:t></w:r></w:p><w:p><w:r><w:t>목표: 발표 구조와 전달력을 함께 개선합니다.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>프로그램</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>기간</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>1:1 코칭</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>4주</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`),
})), { mode: 0o600 });

await createWorkbookFromSpec({
  output: files.xlsx,
  replace: true,
  spec: { sheets: [{
    name: '8월 매출', title: '8월 고객별 매출',
    columns: [
      { key: 'customer', header: '고객', width: 24 },
      { key: 'service', header: '서비스', width: 24 },
      { key: 'amount', header: '금액', width: 14, numberFormat: '#,##0' },
    ],
    rows: [
      { customer: '한빛상회', service: '브랜딩 코칭', amount: 330000 },
      { customer: '새봄상사', service: '발표 코칭', amount: 220000 },
    ],
    formulas: [{ cell: 'C5', formula: 'SUM(C3:C4)', result: 550000, numberFormat: '#,##0' }],
  }] },
});
const chartWorkbook = await loadWorkbook(fromBuffer(await readFile(files.xlsx)));
const chartSheet = chartWorkbook.sheets.find((sheet) => sheet.kind === 'worksheet')?.sheet;
if (chartSheet) {
  const series = makeBarSeries({
    idx: 0, val: { ref: "'8월 매출'!$C$3:$C$4", cache: [330000, 220000] },
    cat: { ref: "'8월 매출'!$A$3:$A$4", cacheKind: 'str', cache: ['한빛상회', '새봄상사'] },
    tx: { kind: 'literal', value: '고객별 매출' },
  });
  addChartAt(chartSheet, 'E2', { space: makeChartSpace({
    title: '고객별 매출 차트', plotArea: { chart: makeBarChart({ series: [series] }) },
  }) });
  await writeFile(files.xlsx, await workbookToBytes(chartWorkbook), { mode: 0o600 });
}
await writeFile(files.csv, '고객,서비스,금액\n한빛상회,브랜딩 코칭,330000\n새봄상사,발표 코칭,220000\n', { mode: 0o600 });

await writeFile(files.webApp, Buffer.from(zipSync({
  'index.html': strToU8('<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="assets/app.css"><title>예약 대시보드</title></head><body><main><h1>예약 대시보드</h1><div id="stats"></div><button id="refresh">현황 새로 보기</button></main><script src="assets/app.js"></script></body></html>'),
  'assets/app.css': strToU8('body{margin:0;padding:8vw;font-family:-apple-system,sans-serif;background:#f4f0e7;color:#172b3b}main{max-width:800px;margin:auto;background:white;padding:48px;border-radius:28px;box-shadow:0 16px 50px #0002}#stats{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:30px 0}.stat{padding:24px;border-radius:18px;background:#e8efe9;font-size:28px;font-weight:700}button{padding:12px 18px;border:0;border-radius:20px;background:#172b3b;color:white}'),
  'assets/app.js': strToU8("const stats=[['오늘 예약',4],['확인 필요',1],['이번 주',17]];document.querySelector('#stats').innerHTML=stats.map(([k,v])=>`<div class=\"stat\"><small>${k}</small><br>${v}</div>`).join('');document.querySelector('#refresh').onclick=()=>console.log('예약 현황을 다시 확인했어요');console.log('예약 대시보드 준비 완료');"),
})), { mode: 0o600 });

process.stdout.write(`${JSON.stringify({ output, files }, null, 2)}\n`);
