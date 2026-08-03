// S1 fixture 생성기 — 동결 manifest(design/S1-EXPERIMENT-FREEZE-2026-08-04-ko.md §2)대로
// 437개를 **결정적으로** 만든다.
//
// 왜 결정적인가: 회차마다 fixture 가 달라지면 A/B 가 fixture 차이를 재게 된다.
// `Math.random` 을 쓰지 않는다(빌드 결정성 원칙과 같은 이유). 고정 seed PRNG 하나만 쓴다.
//
// 실제 오너 파일은 하나도 쓰지 않는다 — 전부 생성물이고 내용은 무해한 placeholder 다.
import {
  mkdirSync, writeFileSync, rmSync, existsSync, utimesSync, readdirSync, statSync, readFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

/** mulberry32 — 짧고 결정적이다. 같은 seed = 같은 437개. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SEED = 437_0804;
const DAY = 86_400_000;

/** §2.1 확장자 분포 — 합계 437. */
const EXT_PLAN = [
  ['.pdf', 96], ['.png', 74], ['.jpg', 41], ['.txt', 31], ['.zip', 28],
  ['.xlsx', 22], ['.docx', 19], ['.csv', 14], ['.dmg', 12], ['.json', 11],
  ['.mp4', 9], ['.hwp', 8], ['', 18],
  ['.md', 16], ['.svg', 14], ['.log', 13], ['.pkg', 11],
];

/** §2.1 mtime 분포 — 합계 437. [최소일, 최대일, 개수] */
const AGE_PLAN = [
  [181, 900, 107], [90, 180, 68], [30, 90, 96], [7, 30, 88], [0, 7, 78],
];

/** §2.1 크기 분포 — 합계 437. [최소, 최대, 개수] */
const SIZE_PLAN = [
  [0, 0, 6], [1, 1023, 180], [1024, 102_400, 190], [102_401, 5_242_880, 55], [5_242_881, 12_582_912, 6],
];

/** §2.1 애매한 파일명 — 각 1개 이상. 확장자 계획 안에서 이름만 특수하게 쓴다. */
const AWKWARD = [
  '견적서 최종 (수정본).pdf',
  '2026 정산 · 1분기.xlsx',
  '회의록🗂️.docx',
  '#임시#메모.txt',
  `아주긴이름${'가'.repeat(180)}.txt`,
  'backup.tar.gz',
  '  앞뒤공백  .pdf',
];

/** §2.1 숨김 5개 — 437 에 포함된다. */
const HIDDEN = ['.DS_Store', '.localized', '.hidden-note.txt', '.cache-index.json', '.spotlight-v100'];

/** §2.1 중복 이름 9쌍 — `X.pdf` / `X (1).pdf` / `X (2).pdf` 형태. */
const DUP_BASES = ['계약서', '견적서', '세금계산서', '거래명세서', '발주서', '정산표', '보고서', '제안서', '명세서'];

/** §2.1 하위 폴더 6개 · 그 안 파일 23개(437 에 **불포함**). */
const SUBDIRS = ['보관', '작업중', 'old', '스크린샷', '_temp', '2025자료'];

const 한글이름 = ['정산', '계약', '보고', '견적', '명세', '회의', '제안', '검수', '발주', '입금'];
const 영문이름 = ['invoice', 'report', 'draft', 'export', 'backup', 'screenshot', 'notes', 'data'];

function 이름만들기(rand, i, ext) {
  const 한글 = rand() < 0.45;
  const base = 한글
    ? `${한글이름[Math.floor(rand() * 한글이름.length)]}_${1000 + Math.floor(rand() * 8999)}`
    : `${영문이름[Math.floor(rand() * 영문이름.length)]}-${1000 + Math.floor(rand() * 8999)}`;
  return `${base}${ext}`;
}

/**
 * 크기만큼 무해한 내용을 만든다. 0바이트도 계획에 있다.
 *
 * 문자열을 이어 붙이며 매번 `Buffer.byteLength` 를 재는 방식은 O(n²) 이라 12MB 에서 멈춘다
 * (실측 2026-08-04: 120초 초과). 바이트로 한 번에 만들고 필요한 만큼만 자른다.
 */
const 조각버퍼 = Buffer.from('T5 S1 fixture placeholder. 이 파일은 시험용 생성물이며 실제 자료가 아닙니다.\n');
function 내용만들기(bytes, 씨앗 = '') {
  if (bytes === 0) return Buffer.alloc(0);
  // **내용을 파일마다 다르게 한다.** 첫 판은 같은 크기면 내용이 완전히 같아 해시가 충돌했고,
  // 대조가 손대지 않은 fixture 에서 이동 28건을 오검출했다(실측 2026-08-04).
  // 앞머리에 자기 이름을 넣어 해시를 고유하게 만든다 — 0바이트만 예외이고 그건 실제로 동일하다.
  const 머리 = Buffer.from(`# ${씨앗}\n`);
  if (머리.length >= bytes) return 머리.subarray(0, bytes);
  const 나머지 = bytes - 머리.length;
  const 반복 = Math.ceil(나머지 / 조각버퍼.length);
  return Buffer.concat([머리, ...Array(반복).fill(조각버퍼)], bytes);
}

/**
 * 437개 + 하위 폴더 23개를 만든다.
 * @returns {{manifest: object, root: string}}
 */
export function makeFixture(root, { seed = SEED, now = Date.UTC(2026, 7, 4) } = {}) {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const rand = prng(seed);

  // ── 계획을 낱개 목록으로 편다 ──────────────────────────────────────────
  const exts = EXT_PLAN.flatMap(([e, n]) => Array(n).fill(e));
  const ages = AGE_PLAN.flatMap(([lo, hi, n]) => Array.from({ length: n }, () => lo + rand() * (hi - lo)));
  const sizes = SIZE_PLAN.flatMap(([lo, hi, n]) => Array.from({ length: n }, () => Math.floor(lo + rand() * (hi - lo))));
  if (exts.length !== 437 || ages.length !== 437 || sizes.length !== 437) {
    throw new Error(`계획 합계가 437이 아니다: ext=${exts.length} age=${ages.length} size=${sizes.length}`);
  }

  // ── 이름 배정 ────────────────────────────────────────────────────────
  //
  // **특수 이름도 확장자 예산에서 꺼내 쓴다.** 첫 판은 특수 39개를 먼저 넣고 나머지에만
  // 계획을 적용해, `.pdf` 가 96 대신 86 이 됐다(실측 2026-08-04). 계약(§2.1 확장자 분포)이
  // 우선이므로 특수 이름이 쓰는 확장자를 예산에서 **차감**한다.
  const 예산 = new Map();
  for (const e of exts) 예산.set(e, (예산.get(e) ?? 0) + 1);
  const 예산차감 = (name) => {
    const m = name.match(/(\.[a-z0-9]+)$/i);
    const ext = m ? m[1].toLowerCase() : '';
    const 남음 = 예산.get(ext);
    if (남음 === undefined) return;            // 계획 밖 확장자(.gz 등) — 총계만 맞춘다
    if (남음 <= 0) { 예산.delete(ext); return; }
    예산.set(ext, 남음 - 1);
  };

  const 이름들 = [];
  const 넣기 = (name) => { 이름들.push(name); 예산차감(name); };
  for (const n of AWKWARD) 넣기(n);
  for (const n of HIDDEN) 넣기(n);
  for (const b of DUP_BASES) {
    넣기(`${b}.pdf`); 넣기(`${b} (1).pdf`); 넣기(`${b} (2).pdf`);   // 9쌍 × 3 = 27
  }

  // 남은 예산을 낱개로 편다 — 이 순서가 곧 나머지 파일의 확장자다.
  const 남은확장자 = [];
  for (const [ext, n] of 예산) for (let k = 0; k < n; k += 1) 남은확장자.push(ext);

  const 쓴이름 = new Set(이름들);
  let i = 0;
  while (이름들.length < 437 && 남은확장자.length) {
    const ext = 남은확장자.shift();
    let name = 이름만들기(rand, i += 1, ext);
    while (쓴이름.has(name)) name = 이름만들기(rand, i += 1, ext);
    쓴이름.add(name);
    이름들.push(name);
  }
  if (이름들.length !== 437) {
    throw new Error(`이름 배정이 437이 아니다: ${이름들.length} — 특수 이름이 예산을 넘었다`);
  }

  // ── 파일 쓰기 ─────────────────────────────────────────────────────────
  const entries = [];
  for (let k = 0; k < 437; k += 1) {
    const name = 이름들[k];
    const bytes = sizes[k];
    const p = join(root, name);
    const body = 내용만들기(bytes, name);
    writeFileSync(p, body);
    const mtime = new Date(now - ages[k] * DAY);
    utimesSync(p, mtime, mtime);
    entries.push({
      path: name,
      bytes: body.length,
      mtimeMs: mtime.getTime(),
      sha256: createHash('sha256').update(body).digest('hex'),
    });
  }

  // ── 하위 폴더 6개 · 안에 23개 (437 에 불포함) ──────────────────────────
  const sub = [];
  const 폴더당 = [5, 4, 4, 4, 3, 3];  // 합 23
  SUBDIRS.forEach((d, di) => {
    mkdirSync(join(root, d), { recursive: true });
    for (let n = 0; n < 폴더당[di]; n += 1) {
      const name = `${d}_자료_${n + 1}.txt`;
      const body = 내용만들기(200 + Math.floor(rand() * 800), join(d, name));
      const p = join(root, d, name);
      writeFileSync(p, body);
      const mtime = new Date(now - (10 + rand() * 300) * DAY);
      utimesSync(p, mtime, mtime);
      sub.push({
        path: join(d, name), bytes: body.length, mtimeMs: mtime.getTime(),
        sha256: createHash('sha256').update(body).digest('hex'),
      });
    }
  });

  const manifest = {
    seed, now, 생성시각계약: '고정값 — 실행 시각을 쓰지 않는다(결정성)',
    최상위개수: entries.length,
    하위폴더: SUBDIRS.length,
    하위파일개수: sub.length,
    entries, sub,
    분포확인: 분포세기(entries, now),
  };
  writeFileSync(join(root, '..', 'fixture-manifest.json'), JSON.stringify(manifest, null, 1));
  return { manifest, root };
}

/** 동결 계약대로 만들어졌는지 스스로 센다 — 생성기가 자기 계약을 어기면 여기서 걸린다. */
export function 분포세기(entries, now = Date.UTC(2026, 7, 4)) {
  const ext = {};
  for (const e of entries) {
    const m = e.path.match(/(\.[a-z0-9]+)$/i);
    const k = m ? m[1].toLowerCase() : '(없음)';
    ext[k] = (ext[k] ?? 0) + 1;
  }
  const 나이 = (e) => (now - e.mtimeMs) / DAY;
  return {
    총계: entries.length,
    확장자: ext,
    나이: {
      '180일초과': entries.filter((e) => 나이(e) > 180).length,
      '90~180': entries.filter((e) => 나이(e) > 90 && 나이(e) <= 180).length,
      '30~90': entries.filter((e) => 나이(e) > 30 && 나이(e) <= 90).length,
      '7~30': entries.filter((e) => 나이(e) > 7 && 나이(e) <= 30).length,
      '7일이내': entries.filter((e) => 나이(e) <= 7).length,
    },
    크기: {
      '0바이트': entries.filter((e) => e.bytes === 0).length,
      '1KB미만': entries.filter((e) => e.bytes > 0 && e.bytes < 1024).length,
      '1KB~100KB': entries.filter((e) => e.bytes >= 1024 && e.bytes <= 102_400).length,
      '100KB~5MB': entries.filter((e) => e.bytes > 102_400 && e.bytes <= 5_242_880).length,
      '5MB초과': entries.filter((e) => e.bytes > 5_242_880).length,
    },
    숨김: entries.filter((e) => e.path.startsWith('.')).length,
    중복쌍: DUP_BASES.filter((b) => entries.some((e) => e.path === `${b} (1).pdf`)).length,
  };
}

/**
 * 회차 후 실물 대조 — 이동은 경로 변화 + 해시 동일, 손상 0 은 해시 집합 동일.
 * @returns {{이동:number, 손상:number, 사라짐:number, 새로생김:number, 해시집합동일:boolean}}
 */
export function 대조(manifest, root) {
  // **신분은 경로다. 해시는 손상 판별용이다.**
  // 첫 판은 해시를 신분으로 썼는데, 같은 크기 파일의 내용이 동일해 해시가 충돌했고
  // 손대지 않은 fixture 에서 이동 28건을 오검출했다(실측 2026-08-04). 내용을 고유하게
  // 만든 지금도 0바이트 6개는 실제로 동일하므로, 신분을 경로로 두는 설계가 옳다.
  const 현재 = new Map();
  const 훑기 = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { 훑기(p); continue; }
      현재.set(relative(root, p), sha256Of(p));
    }
  };
  훑기(root);

  const 원본 = new Map([...manifest.entries, ...manifest.sub].map((e) => [e.path, e.sha256]));

  // 제자리에 있는데 내용이 바뀐 것 = 손상
  const 손상목록 = [...원본].filter(([p, h]) => 현재.has(p) && 현재.get(p) !== h).map(([p]) => p);

  // 사라진 경로와 새로 생긴 경로를 해시로 짝지어 이동을 찾는다.
  const 사라진 = [...원본.keys()].filter((p) => !현재.has(p));
  const 생긴 = [...현재.keys()].filter((p) => !원본.has(p));
  const 남은생긴 = new Map();
  for (const p of 생긴) {
    const h = 현재.get(p);
    if (!남은생긴.has(h)) 남은생긴.set(h, []);
    남은생긴.get(h).push(p);
  }
  const 이동쌍 = [];
  const 못찾음 = [];
  for (const p of 사라진) {
    const h = 원본.get(p);
    const 후보 = 남은생긴.get(h);
    if (후보?.length) 이동쌍.push({ 전: p, 후: 후보.shift() });
    else 못찾음.push(p);
  }
  const 진짜새로 = [...남은생긴.values()].flat();

  return {
    이동: 이동쌍.length,
    이동쌍,
    손상: 손상목록.length,
    손상목록,
    사라짐: 못찾음.length,          // 짝을 못 찾은 것만 진짜 사라진 것이다
    사라진목록: 못찾음,
    새로생김: 진짜새로.length,      // 이동으로 설명되지 않는 새 파일 = 산출물
    새로생긴목록: 진짜새로,
    해시집합동일: 손상목록.length === 0 && 못찾음.length === 0,
    현재개수: 현재.size,
    원본개수: 원본.size,
  };
}

function sha256Of(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

// CLI: node scripts/s1/make-fixture.mjs <root>
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2];
  if (!root) { console.error('사용법: node scripts/s1/make-fixture.mjs <fixture-root>'); process.exit(2); }
  const { manifest } = makeFixture(root);
  console.log(JSON.stringify(manifest.분포확인, null, 1));
  console.log(`\n최상위 ${manifest.최상위개수}개 · 하위폴더 ${manifest.하위폴더}개(파일 ${manifest.하위파일개수}) → ${root}`);
}
