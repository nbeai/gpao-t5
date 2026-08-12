// F-82 · 「펜션/리조트.pdf 읽어 요약해봐」가 살았던 두 자리를 봉인한다 (2026-08-12).
//
// 오너 라이브 실측: 2.1MB · 28쪽 · 압축 스트림 PDF 를 T5 가 두 겹으로 못 읽었다.
//   ① 원시 1MB 상한이 추출보다 먼저 서서 "너무 커서 못 읽어요" — 원시 바이트는
//      프롬프트에 실리지 않는데 그 크기로 문서를 거부했다.
//   ② 상한을 지나도 추출문이 0자 — **JXA 의 console.log 는 stderr 로 나간다.**
//      command() 는 stdout 만 받아 추출문 전체가 조용히 버려졌고(같은 PDF 실측:
//      stdout 0자 · stderr 23,512자), 압축 PDF 는 비압축 폴백도 못 읽는다.
//      즉 실세계 PDF 읽기가 통째로 죽어 있었는데, 비압축 고정물만 있는 검사는 초록이었다.
// 그 접힌 실패를 모델이 "권한 차단"으로 지어내 사용자에게 파일을 직접 열라고 했다 —
// 거짓 무능의 재료가 이 두 겹이다.
//
// 이 검사는 **압축 스트림 PDF 를 실행 중에 만들어**(cupsfilter — 의존성 0 · 죽은 가설
// 「문서 생성은 라이브러리가 필요하다」에서 실측된 길) PDFKit 경로가 stdout 으로
// 본문을 실어 오는 것까지 문다. cupsfilter 가 없는 환경(리눅스 CI)은 건너뛴다 —
// 이 결함의 정의역이 macOS PDFKit 경로라서다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm, stat, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractDocument } from '../src/runtime/document-intake.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

const exec = promisify(execFile);
const 쿱스 = '/usr/sbin/cupsfilter';
const 있음 = existsSync(쿱스) && existsSync('/usr/bin/osascript');

async function 압축PDF만들기(방, 글자수목표 = 0) {
  const 원문 = join(방, '원문.txt');
  const 본문 = `펜션 리조트 월별 운영 기준서 시험 본문\n${'운영 점검 문장입니다. '.repeat(Math.max(40, 글자수목표 / 12))}`;
  await writeFile(원문, 본문, 'utf8');
  const pdf = join(방, '펜션:리조트-시험.pdf');
  const { stdout } = await exec(쿱스, [원문], { encoding: 'buffer', maxBuffer: 64_000_000 });
  await writeFile(pdf, stdout);
  return pdf;
}

test('F-82 ②: 압축 스트림 PDF 의 본문이 stdout 으로 실려 온다 — console.log 는 stderr 다', { skip: !있음 }, async () => {
  const 방 = await mkdtemp(join(tmpdir(), 'f82-'));
  try {
    const pdf = await 압축PDF만들기(방);
    // 전제 확인: 이 고정물이 정말 압축 스트림인가(아니면 폴백이 통과시켜 검사가 헐거워진다)
    const bytes = await readFile(pdf);
    assert.ok(bytes.includes(Buffer.from('FlateDecode')), '고정물이 압축 PDF 가 아니다 — 검사 전제 미성립');
    const doc = await extractDocument(pdf, bytes);
    assert.equal(doc?.format, 'pdf');
    assert.ok((doc?.text?.length ?? 0) > 200,
      `**압축 PDF 추출문이 비었다** — JXA stdout 자리가 다시 죽었다 (textLen=${doc?.text?.length ?? 0})`);
    assert.match(doc.text, /펜션 리조트 월별 운영 기준서/);
  } finally { await rm(방, { recursive: true, force: true }); }
});

test('F-82 ①: 1MB 를 넘는 문서 형식은 원시 상한이 아니라 문서 상한을 탄다', { skip: !있음 }, async () => {
  const 방 = await mkdtemp(join(tmpdir(), 'f82-'));
  try {
    // 1MB 를 넘기게 본문을 키운다 — cupsfilter 산출이 1MB 를 넘도록 넉넉히.
    let pdf = await 압축PDF만들기(방, 900_000);
    if ((await stat(pdf)).size <= 1_000_000) {
      // 압축이 좋아 1MB 가 안 되면 바이트를 덧붙여 원시 크기만 키운다 — PDF 는 앞에서
      // 읽히므로 뒤에 붙은 여백은 추출에 영향이 없다(원시 상한 게이트만 겨눈다).
      const bytes = await readFile(pdf);
      await writeFile(pdf, Buffer.concat([bytes, Buffer.alloc(1_100_000 - Math.min(bytes.length, 1_000_000), 0x20)]));
    }
    assert.ok((await stat(pdf)).size > 1_000_000, '고정물이 1MB 를 안 넘는다 — 검사 전제 미성립');
    // macOS tmpdir 는 /var → /private/var 심링크다 — 범위 대조가 실경로로 서게 맞춘다.
    const 실방 = await realpath(방);
    const 손 = makeLocalFileTool({ roots: [실방], dataDir: 실방 });
    const r = await 손.handler({ action: 'read', path: join(실방, '펜션:리조트-시험.pdf') });
    assert.notEqual(r?.blocked, true,
      `**1MB 원시 상한이 문서를 다시 거부한다**: ${r?.userSafeSummary ?? ''}`);
    assert.match(String(r?.result?.text ?? ''), /펜션 리조트 월별 운영 기준서/,
      '문서 상한은 지났는데 본문이 안 실렸다');
  } finally { await rm(방, { recursive: true, force: true }); }
});

test('F-82 반례: 문서 형식이 아닌 큰 파일은 여전히 원시 상한이 문다', async () => {
  const 방 = await mkdtemp(join(tmpdir(), 'f82-'));
  try {
    const 실방 = await realpath(방);
    const big = join(실방, '큰것.bin');
    await writeFile(big, Buffer.alloc(1_500_000, 0x41));
    const 손 = makeLocalFileTool({ roots: [실방], dataDir: 실방 });
    const r = await 손.handler({ action: 'read', path: big });
    assert.equal(r?.blocked, true, '**문서 아닌 1.5MB 가 통째로 읽혔다** — 프롬프트 보호 상한이 죽었다');
    // 사유까지 문다 — 범위 밖 차단으로 초록이 나면 이 반례는 아무것도 안 잰 것이다.
    assert.match(String(r?.userSafeSummary ?? ''), /너무 커서/, `막힌 사유가 크기가 아니다: ${r?.userSafeSummary}`);
  } finally { await rm(방, { recursive: true, force: true }); }
});
