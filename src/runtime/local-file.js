// L3 · 로컬 파일 손발 (Phase 0-1) — 스텁이었던 `local.file` 을 실제로 만든다.
//
// 이전 상태: 핸들러가 `{ scanned: true }` 만 반환하는 스텁인데 레지스트리에 등록돼 있어서
// CAPABILITIES.md 가 "읽고 정리한다"고 적고 T5 가 사용자에게 그렇게 말했다 — 자기 자신에 대한 거짓말.
//
// 계약:
//   · 모든 경로는 범위(scope) 안에서만(file-scope.js). 링크 탈출도 막는다.
//   · 덮어쓰기·삭제는 **되돌릴 수 있다** — 원본을 휴지통으로 옮기고 되돌리기 표를 남긴다.
//   · 승인 등급은 기존 계약 그대로: write·delete 는 SAFETY_FLOOR 라 항상 승인(A2+)을 받는다.
//   · 실패는 종류별로 사용자 언어. 못 한 것을 한 척하지 않는다.
import { readFile as nodeReadFile, writeFile, readdir, stat, mkdir, rename, rm, copyFile } from 'node:fs/promises';
import { join, dirname, basename, relative, isAbsolute, extname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolveInScope, ensureRoot, outOfScopeMessage, defaultFileRoots, previewPathOf, 부르는이름들 } from './file-scope.js';
import { protectionBlocks, protectionMessage } from './local-protection.js';
import { extractDocument } from './document-intake.js';

const MAX_READ_BYTES = 1_000_000; // 너무 큰 파일은 통째로 읽지 않는다(메모리·프롬프트 보호)
const VERSION_PREVIEW_FILES = 6;
const VERSION_PREVIEW_CHARS = 1200;

function userVisiblePath(abs, roots) {
  const root = [...roots]
    .sort((a, b) => b.length - a.length)
    .find((candidate) => {
      const rel = relative(candidate, abs);
      return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
    });
  if (!root) return basename(abs);
  const rel = relative(root, abs);
  return rel ? join(basename(root), rel) : basename(root);
}

/** 되돌리기 표 한 줄. 휴지통 경로와 원래 자리를 함께 남긴다. */
function undoEntry(op, from, to) {
  return { id: randomUUID(), op, from, to, at: new Date().toISOString() };
}

/**
 * CSV 의 표 사실 — 행수·열 이름·숫자 열 합계. **손이 이미 읽은 내용에서 세는 기계 사실**이다
 * (매듭 ① 회차 G 실측 2026-08-08 · 구조 층). ⑤⑫⑬ 이 전부 "여러 값의 합"인데 합산이 모델
 * 암산으로 남아 회차마다 흔들렸다 — 회차 E 는 어느 파일 조합도 아닌 2,270,000 을 지어냈고,
 * 회차 G R1·R3 은 부분합에 "총" 을 명명했다. 합산을 캡슐로 보내라고 말로 가르치는 길은 같은
 * 방법 다섯 번째라 막혔고(F-12 계열), 재료를 바꾼다 — 읽기가 합계를 사실로 동봉해 말이
 * 기계 사실에서 나오게 한다(매듭 ② 의 열린 길 · locate 의 자료기간·counts 와 같은 계약).
 *
 * 지어내지 않는다: 따옴표 필드·열 수 불일치·숫자 아닌 열은 세지 않고, 표가 애매하면 아예
 * 안 낸다 — 틀린 합계는 없는 합계보다 나쁘다(거짓 성공 제조).
 */
function 표사실(전문) {
  const 줄들 = String(전문 ?? '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (줄들.length < 2 || 줄들.length > 5000) return null;
  if (줄들.some((l) => l.includes('"'))) return null;     // 따옴표 CSV 는 이 단순한 자의 밖이다
  const 머리 = 줄들[0].split(',').map((s) => s.trim());
  if (머리.length < 2 || 머리.some((h) => !h || /^-?\d/.test(h))) return null; // 머리줄이 숫자면 표가 아니다
  if (new Set(머리).size !== 머리.length) return null; // 같은 이름 열 둘 — 뒤가 앞을 조용히 덮는다(공정감시 지적)
  const 행들 = 줄들.slice(1).map((l) => l.split(',').map((s) => s.trim()));
  if (행들.some((r) => r.length !== 머리.length)) return null;
  const sums = {};
  머리.forEach((h, i) => {
    let 합 = 0; let 숫자열 = true; let 값있음 = false;
    for (const r of 행들) {
      const v = r[i];
      if (v === '') continue;
      if (!/^-?\d+(\.\d+)?$/.test(v)) { 숫자열 = false; break; }
      합 += Number(v); 값있음 = true;
    }
    if (숫자열 && 값있음) sums[h] = 합;
  });
  return Object.keys(sums).length ? { rows: 행들.length, columns: 머리, sums } : null;
}

/**
 * **이번 턴의 표 맥락** — 읽은 CSV 의 합·이웃 합·폴더 명부를 폴더 단위로 모은다
 * (⑫ 접근 전환 · PM 승인 2026-08-08 · "말과 실물 모두 기계 합에서 나온다").
 *
 * 안 읽은 CSV 가 남은 폴더만 낸다 — 다 읽은 폴더는 대조할 공백이 없다. 폴더의 모든 CSV
 * 합을 알 때만 열별 전체 합을 낸다(하나라도 모르면 전체 합을 지어내지 않는다 — 그때는
 * 빠진 파일의 개별 합 사실만 남는다). 판단은 없다 — 원장 영수증의 기계 사실 재배열이다.
 * 커널(턴)과 캡슐이 **같은 한 벌**을 쓴다 — 회차 K 실측: 캡슐 내부 쓰기를 대조에서 빼는
 * 관할 빗장이 설계 오류였다(캡슐 스크립트도 반만 합산한 실물을 낸다 · R1).
 */
export function 표맥락에서(receipts) {
  const 폴더들 = new Map();
  // 캡슐 경유 읽기도 같은 원장이다(회차 J R1 실측) — innerReceipts 를 한 겹 펴서 같은 자로.
  for (const r of (receipts ?? []).flatMap((x) => [x, ...(x?.result?.innerReceipts ?? [])])) {
    if ((r?.failureState ?? 'none') !== 'none') continue;
    const ac = r?.actualCall;
    if (ac?.tool !== 'local.file' || ac?.args?.action !== 'read') continue;
    const res = r?.result ?? {};
    if (!res.table?.sums || !res.path) continue;
    const 마디 = String(res.path).split('/');
    const 폴더 = 마디.slice(0, -1).join('/');
    const f = 폴더들.get(폴더) ?? { 읽은합: {}, 이웃합: {}, 명부: new Set() };
    f.읽은합[마디.at(-1)] = res.table.sums;
    for (const n of res.같은자리파일 ?? []) f.명부.add(n);
    for (const [n, t] of Object.entries(res.같은자리표 ?? {})) if (t?.sums) f.이웃합[n] = t.sums;
    폴더들.set(폴더, f);
  }
  const 맥락 = [...폴더들.entries()].map(([폴더, f]) => {
    const 안읽은 = [...f.명부].filter((n) => n.normalize('NFC').toLowerCase().endsWith('.csv') && !(n in f.읽은합));
    const 빠진합 = Object.fromEntries(안읽은.filter((n) => f.이웃합[n]).map((n) => [n, f.이웃합[n]]));
    let 전체합 = null;
    if (안읽은.length && 안읽은.every((n) => 빠진합[n])) {
      전체합 = {};
      for (const sums of [...Object.values(f.읽은합), ...Object.values(빠진합)]) {
        for (const [열, 값] of Object.entries(sums ?? {})) 전체합[열] = (전체합[열] ?? 0) + 값;
      }
      if (!Object.keys(전체합).length) 전체합 = null;
    }
    return { 폴더, 안읽은, 빠진합, 전체합, 부분합: f.읽은합 };
  }).filter((x) => x.안읽은.length);
  return 맥락.length ? 맥락 : undefined;
}

/**
 * **쓴 실물의 숫자를 기계 합과 대조한다** (⑫ 접근 전환 · PM 승인 2026-08-08 · 회차 I 실증).
 * 출구 되부름은 손이 없어 실물을 못 고친다 — 실물이 생기는 바로 그 영수증에 대조 사실을
 * 실으면, 모델은 손을 쥔 채(루프 안) 받아서 파일을 다시 쓸 수 있다. 차단이 아니다(쓰기는
 * 이미 됐다) · 문구 가르침이 아니다(기계 대조) · 트리거는 원장 사실이다(세 성질 유지).
 *
 * 붙는 조건 전부: 이번 턴 표 맥락이 있고(안 읽은 CSV 가 남은 폴더) · 쓴 글에 숫자와
 * 총·전체·합계 명명이 있고 · 그 글이 빠진 파일을 이름으로 부르지 않았고 · 글의 숫자에
 * 부분합은 있는데 전체 합은 없다. 전체 합을 모르면 주장하지 않는다 — 빠진 파일의 개별
 * 합 사실만 남긴다(지어내지 않는다).
 */
function 쓴숫자대조(text, 표맥락) {
  if (!Array.isArray(표맥락) || !표맥락.length) return null;
  const 글 = String(text ?? '');
  if (!/\d/.test(글) || !/총|전체|합계/.test(글)) return null;
  const 숫자들 = new Set([...글.matchAll(/\d[\d,]*/g)].map((m) => Number(m[0].replace(/,/g, ''))));
  const 조각 = [];
  for (const f of 표맥락) {
    const 미지명 = (f.안읽은 ?? []).filter((n) => !글.includes(n));
    if (!미지명.length) continue;                      // 실물이 빠진 파일을 지명했다 — 범위를 밝힌 것
    const 부분값들 = Object.values(f.부분합 ?? {}).flatMap((s) => Object.values(s ?? {}));
    if (!부분값들.some((v) => 숫자들.has(v))) continue; // 글의 숫자가 이 폴더의 합이 아니다 — 소음 금지
    const 폴더이름 = String(f.폴더).split('/').pop();
    const 어긋난열 = Object.entries(f.전체합 ?? {}).filter(([, v]) => !숫자들.has(v));
    const 빠짐말 = 미지명.map((n) => (f.빠진합?.[n]
      ? `${n}(${Object.entries(f.빠진합[n]).slice(0, 2).map(([열, v]) => `${열} ${v.toLocaleString('ko-KR')}`).join(' · ')})`
      : n)).slice(0, 3).join(' · ');
    if (어긋난열.length) {
      조각.push(`${폴더이름}의 ${어긋난열.slice(0, 2).map(([열, v]) => `${열} 전체 합 ${v.toLocaleString('ko-KR')}`).join(' · ')}이 쓴 숫자에 없음 · 빠짐: ${빠짐말}`);
    } else if (!f.전체합) {
      조각.push(`${폴더이름}에서 안 읽은 파일이 쓴 숫자에 빠짐: ${빠짐말}`);
    }
  }
  return 조각.length ? ` (숫자 대조: ${조각.slice(0, 2).join(' / ')})` : null;
}

/**
 * @param {{roots?:string[], trashDir?:string, dataDir?:string, readFile?:Function}} [deps]
 */
export function makeLocalFileTool(deps = {}) {
  const readFile = deps.readFile ?? nodeReadFile; // 실패 주입도 실제 파일 손 경계를 타게 한다.
  const roots = deps.roots ?? defaultFileRoots();
  const home = deps.homeDir; // 검사 주입용 — 미지정이면 file-scope 가 실제 홈을 쓴다
  const trashDir = deps.trashDir ?? join(deps.dataDir ?? roots[0], '.trash');
  // 되돌리기 표는 **파일에 남긴다**. 메모리에만 두면 재시작 뒤 휴지통 파일은 있는데 되돌릴 방법이
  // 없어진다 — "되돌릴 수 있어요"라고 말해놓고 다음 날 못 되돌리는 거짓말이 된다(§18 지속성 계약).
  const undoFile = join(trashDir, 'undo-log.json');

  async function loadUndo() {
    try { return JSON.parse(await readFile(undoFile, 'utf8')); } catch { return []; }
  }
  async function saveUndo(list) {
    await mkdir(trashDir, { recursive: true });
    const tmp = `${undoFile}.tmp`;
    await writeFile(tmp, JSON.stringify(list.slice(-50)), 'utf8'); // 최근 50건만(무한 성장 금지)
    await rename(tmp, undoFile);
  }
  async function pushUndo(entry) {
    const list = await loadUndo();
    list.push(entry);
    await saveUndo(list);
  }

  /**
   * 원본을 휴지통으로 옮긴다(덮어쓰기·삭제 전 필수). 없으면 아무 것도 안 한다.
   * 이름에 시각만 쓰면 **같은 밀리초에 두 번 담글 때 겹친다** — 덮어쓰기 직후의 undo 가
   * 정확히 그랬다: 새 내용을 담그는 이름이 방금 담근 원본과 겹쳐 원본이 조용히 사라졌고,
   * "되돌렸어요"가 새 내용을 되돌려 놓았다(집중 검사에서 실측). 겹치지 않는 조각을 붙인다.
   */
  async function toTrash(abs) {
    try { await stat(abs); } catch { return null; }
    await mkdir(trashDir, { recursive: true });
    const parked = join(trashDir, `${Date.now()}-${randomUUID().slice(0, 8)}-${basename(abs)}`);
    await rename(abs, parked);
    return parked;
  }

  const ok = (userSafeSummary, result) => ({ result, userSafeSummary });
  // **말과 길은 소비자가 다르다.** `nextSafeAction` 은 표면이 사용자에게 보여 주는 한 문장이고,
  // `다음수단` 은 모델이 그대로 부를 수 있는 값이다(`tool-receipt.js` 계약).
  // 한 문장으로 둘을 다 하려다 *"그 폴더를 열어 주시면"* 이 모델의 다음 행동이 됐다(판 ⑫ 0/3).
  const fail = (userSafeSummary, nextSafeAction, diagnosticTrace, 다음수단) => ({
    blocked: true, userSafeSummary, nextSafeAction,
    ...(다음수단?.length ? { 다음수단 } : {}),
    ...(diagnosticTrace ? { diagnosticTrace } : {}),
  });

  function bulkMatch(match = {}) {
    const extensions = Array.isArray(match.extensions)
      ? match.extensions.map((v) => String(v).trim().toLowerCase()).filter(Boolean)
        .map((v) => (v.startsWith('.') ? v : `.${v}`))
      : [];
    const nameIncludes = Array.isArray(match.nameIncludes)
      ? match.nameIncludes.map((v) => String(v).trim().toLowerCase()).filter(Boolean)
      : [];
    const namePrefix = typeof match.namePrefix === 'string' ? match.namePrefix.trim().toLowerCase() : '';
    const nameSuffix = typeof match.nameSuffix === 'string' ? match.nameSuffix.trim().toLowerCase() : '';
    const olderThanDays = Number(match.olderThanDays);
    const newerThanDays = Number(match.newerThanDays);
    const hasOlder = Number.isFinite(olderThanDays) && olderThanDays > 0;
    const hasNewer = Number.isFinite(newerThanDays) && newerThanDays > 0;
    const hasAny = extensions.length || nameIncludes.length || namePrefix || nameSuffix || hasOlder || hasNewer;
    // 어떤 조건이 걸려 있는지 — 0개일 때 **왜 0인지**를 말하기 위해 그대로 들고 있는다.
    const 조건들 = [
      extensions.length ? { 이름: `확장자 ${extensions.join('·')}`, 통과: (n) => extensions.includes(extname(n)) } : null,
      nameIncludes.length ? { 이름: `이름에 ${nameIncludes.join('·')} 포함`, 통과: (n) => nameIncludes.some((x) => n.includes(x)) } : null,
      namePrefix ? { 이름: `이름이 ${namePrefix} 로 시작`, 통과: (n) => n.startsWith(namePrefix) } : null,
      nameSuffix ? { 이름: `이름이 ${nameSuffix} 로 끝남`, 통과: (n) => n.endsWith(nameSuffix) } : null,
    ].filter(Boolean);
    return {
      hasAny,
      조건들,
      test(name, info) {
        const n = String(name ?? '').toLowerCase();
        if (extensions.length && !extensions.includes(extname(n))) return false;
        if (nameIncludes.length && !nameIncludes.some((needle) => n.includes(needle))) return false;
        if (namePrefix && !n.startsWith(namePrefix)) return false;
        if (nameSuffix && !n.endsWith(nameSuffix)) return false;
        if (hasOlder || hasNewer) {
          const mtimeMs = Number(info?.mtimeMs);
          if (!Number.isFinite(mtimeMs)) return false;
          const ageDays = (Date.now() - mtimeMs) / 86_400_000;
          if (hasOlder && ageDays < olderThanDays) return false;
          if (hasNewer && ageDays > newerThanDays) return false;
        }
        return true;
      },
    };
  }

  /**
   * **문(offset·limit)** — 정본 §S3.
   *
   * 사고 원문(2026-08-03): 다운로드 437개 목록이 잘려 **23개(5%)만** 모델에게 갔다. 요약은
   * "437개를 찾았어요"였고 잘렸다는 말은 마침표 세 개가 전부였다. **나머지를 가져올 인자가
   * 없었다.** 모델은 그 자리에서 실행을 요구받았고 다섯 턴 내내 계획만 반복했다.
   *
   * 잘림 자체를 없애는 게 답이 아니다 — 437개를 다 실으면 프롬프트가 폭주한다.
   * 답은 **문**이다: 전체가 몇 개이고, 어디까지 줬고, 나머지를 어떻게 가져오는가.
   * 인자를 안 주면 예전과 똑같이 동작한다(기본값이 행동을 바꾸지 않는다).
   */
  function 문(총, args) {
    const 시작 = Number.isInteger(Number(args?.offset)) && Number(args.offset) > 0 ? Number(args.offset) : 0;
    const 몇개 = Number.isInteger(Number(args?.limit)) && Number(args.limit) > 0 ? Number(args.limit) : null;
    const 끝 = 몇개 === null ? 총 : Math.min(시작 + 몇개, 총);
    return { 시작, 끝, 다음: 끝 < 총 ? 끝 : undefined, 총 };
  }

  /** 문을 쓴 결과를 **사람 말**로. 얼마나 있고 어디까지 줬고 끝났는지. */
  function 문말(문값, 단위) {
    if (문값.시작 === 0 && 문값.다음 === undefined) return null;
    return 문값.다음 === undefined
      ? `${문값.시작 + 1}-${문값.끝} / 전체 ${문값.총}${단위} — 여기가 마지막이에요.`
      : `${문값.시작 + 1}-${문값.끝} / 전체 ${문값.총}${단위} (다음은 offset=${문값.다음})`;
  }

  async function remainingSummary(abs) {
    const entries = await readdir(abs, { withFileTypes: true });
    const extensionCounts = new Map();
    let files = 0;
    let folders = 0;
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) { folders += 1; continue; }
      if (!e.isFile()) continue;
      files += 1;
      const ext = extname(e.name).toLowerCase() || '[no-ext]';
      extensionCounts.set(ext, (extensionCounts.get(ext) ?? 0) + 1);
    }
    return {
      path: abs,
      items: files + folders,
      files,
      folders,
      topExtensions: [...extensionCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 12)
        .map(([ext, count]) => ({ ext, count })),
    };
  }

  /** 실패를 종류별로 사용자 언어로. 진단 원문은 화면에 내보내지 않는다. */
  function failureOf(e, path) {
    // 범위 밖은 **되는 방법을 제안할 수 있는 실패**다(§22). 사다리가 알아볼 표식을 단다.
    if (e?.isScopeError) return { blocked: true, scopeState: 'out_of_scope', ...outOfScopeMessage(e) };
    // **어디에서** 찾았는지 말한다. 이게 없으면 모델은 자기가 어디를 보고 있는지 몰라서
    // "접근이 막힌 것 같다"고 추측하고 터미널 명령을 시킨다(라이브 실측 — 개발자 떠넘김).
    if (e?.code === 'ENOENT') {
      return fail(
        `제가 다루는 폴더(${부르는이름들(roots)}) 안에서 ${path} 을(를) 찾지 못했어요.`,
        '다른 폴더에 있다면 그 폴더를 열어 주시면 바로 볼게요.',
        undefined,
        // **못 찾은 것은 없는 것이 아니다.** 짚은 자리에 없었을 뿐이고, 찾는 손이 있다.
        // 판 ⑫에서 모델은 `~/Desktop/지난달 정산 파일` 을 짚어 실패했는데, 같은 회차 ②가
        // `~/GPAO-T5/지난달 정산 파일` 을 실제로 읽었다 — **찾을 수 있었다.**
        [{ 방법: 'local.locate', what: path, 왜: `\`${path}\` 가 어느 자리에 있는지 찾는다(그 자리에 없었을 뿐 없다는 뜻이 아니다)` }],
      );
    }
    if (e?.code === 'EACCES' || e?.code === 'EPERM') return fail('그 파일에 접근할 권한이 없어요.', '다른 파일로 해볼까요?');
    if (e?.code === 'EISDIR') return fail('그건 파일이 아니라 폴더예요.', '폴더 안을 보여드릴까요?');
    if (e?.code === 'ENOSPC') return fail('저장 공간이 부족해요.', '공간을 확보한 뒤 다시 할까요?');
    return fail('파일 작업 중 문제가 있었어요.', '다시 시도해 볼까요?');
  }

  return {
    toolKind: 'organize',
    scopeRoots: [...roots],
    /**
     * C 감사 F5.3 · **승인은 성공할 수 있는 일에만 청한다.** 범위 밖·보호 영역을 향한
     * 쓰기/옮기기/지우기는 승인 뒤 반드시 실패한다 — 누를 수 있지만 성공 불가능한 카드는
     * 카드가 아니라 함정이다. 읽기 계열은 카드가 없으므로 여기서 판정하지 않는다(존재 검사도
     * 하지 않는다 — ENOENT 는 실행 경로의 정직한 실패·사다리가 다룬다).
     */
    async approvalEligibility(args = {}) {
      const action = args.action ?? (args.path ? 'read' : 'list');
      if (action === 'list' || action === 'read' || action === 'versions') return { allowed: true };
      // undo 는 여기서 막지 않는다 — "되돌릴 것 없음"은 승인 뒤의 정직한 결과이고, 카드는
      // F5.2 미리보기가 이미 실제 대상(또는 없음)을 말한다. 승인 불변식(모델이 고른 되돌리기는
      // 승인 대기로 멈춘다)은 동결 계약이라 여기서 갈래를 만들지 않는다.
      if (action === 'undo') return { allowed: true };
      try {
        // **자격도 실행과 같은 선을 본다.** 여기만 좁으면 실행은 되는데 카드 앞에서 막혀
        // "그 자리는 못 해요"가 나간다 — 판정과 실행이 다른 것을 보는 자리다(두 진실 금지).
        const abs = await resolveInScope(args.path ?? '', { roots: [...roots, home ?? homedir()], home });
        const prot = protectionBlocks(abs, { write: true });
        if (prot) return { allowed: false, ...protectionMessage(prot, { write: true }) };
        if (action === 'move') {
          // **목적지도 원본과 같은 자를 본다**(2026-08-08 · ⑫ 회차 E 실측 · F-46 프랙탈).
          // write 는 홈 전체가 열리는데 move 의 to 만 좁은 자라서, "만들고 바탕화면으로
          // 옮기기"가 두 번 거절됐고 모델은 "권한이 없다"고 알렸다 — 행동이 다르다고 자가
          // 다르면 사용자에겐 "파일마다 되다 안 되다"로 보인다. 보호(protectionBlocks)는
          // 자와 독립이라 그대로 선다.
          const dest = await resolveInScope(args.to ?? '', { roots: [...roots, home ?? homedir()], home });
          const destProt = protectionBlocks(dest, { write: true });
          if (destProt) return { allowed: false, ...protectionMessage(destProt, { write: true }) };
        }
        if (action === 'bulk_move') {
          const dest = await resolveInScope(args.to ?? '', { roots: [...roots, home ?? homedir()], home });
          const destProt = protectionBlocks(dest, { write: true });
          if (destProt) return { allowed: false, ...protectionMessage(destProt, { write: true }) };
        }
        return { allowed: true };
      } catch (e) {
        if (e?.isScopeError) return { allowed: false, ...outOfScopeMessage(e) };
        return { allowed: true }; // 판정 불능은 실행 경로가 정직하게 실패하게 둔다(여기서 추측 금지)
      }
    },
    /**
     * @param {{action?:string, path?:string, text?:string, to?:string, name?:string, source?:string}} args
     *   action: list | read | write | move | delete | undo | versions (기본: path 있으면 read, 없으면 list)
     *   versions: path(폴더나 파일) 안에서 name 이 들어간 파일들의 최종본을 시각·내용으로 판별한다.
     *   write 의 source: 이 결과물의 원본 — 그 자리로는 저장하지 않는다(원본 보호, H08).
     */
    /** 방금 다룬 파일이 다음 턴의 대상이다("그거 정리해줘"가 이어진다). */
    subjectOf(rec) {
      const path = rec?.result?.path ?? rec?.actualCall?.args?.path;
      return path ? { key: `file:${path}`, kind: 'file', label: String(path) } : null;
    },
    /**
     * 승인 카드에 실릴 사실. **모델이 보낸 인자가 아니라 해석된 결과를 보여준다.**
     *
     * 예전엔 커널의 `describeAction` 이 `args.path` 를 그대로 실었다. 그래서 모델이
     * `path: 'GPAO-T5/메모4.md'` 를 보내면 카드에도 그렇게 보였고, 실제로는 작업 루트 기준으로
     * 풀려 `~/GPAO-T5/GPAO-T5/메모4.md` 에 생겼다 — 루트 이름이 두 번 들어간 것을 사용자가
     * 승인 시점에 알 길이 없었다(2026-07-27 실측). 인자를 보여주는 승인은 승인이 아니다.
     *
     * 읽기(list·read)는 승인 카드가 없으므로 미리보기도 내지 않는다.
     */
    previewOf(args = {}) {
      const action = args.action ?? (args.path ? 'read' : 'list');
      // versions 도 읽기다 — 비교만 하고 아무것도 바꾸지 않는다.
      if (action === 'list' || action === 'read' || action === 'versions') return undefined;
      if (action === 'undo') {
        // C 감사 F5.2 · 카드는 **강제되지 않는 범위를 단언하지 않는다.** "roots[0] 안"이라고
        // 말해 놓고 로그의 실제 대상은 안 보여줬다 — 인자가 아니라 결과를 보여줘야 승인이
        // 승인이 된다(write/move/delete 카드와 같은 계약). 미리보기는 표시용이라 동기로 읽는다.
        let 마지막;
        try { 마지막 = JSON.parse(readFileSync(undoFile, 'utf8')).at(-1); } catch { /* 기록 없음 */ }
        return {
          impact: 마지막
            ? `${basename(마지막.from)} 을(를) 이전 상태로 되돌려요`
            : '되돌릴 파일 작업이 없어요',
          scope: 마지막 ? userVisiblePath(String(마지막.from), roots) : `${basename(roots[0])} 안`,
          duration: '이번 한 번',
          cancel: '되돌리기를 되돌릴 수는 없어요 — 다시 하면 됩니다',
        };
      }
      // 카드도 실행과 같은 자를 본다 — 홈을 빼면 표준 폴더 상대 경로(`Desktop/…`)가 카드에서만
      // 다른 자리(또는 이름 없는 자리)로 보인다(두 진실 금지 · ⑫ 회차 F R1).
      const 카드루트 = [...roots, home ?? homedir()];
      const abs = previewPathOf(args.path, roots, home);
      const 이름 = basename(abs);
      const impact = action === 'delete' ? `${이름} 을(를) 지워요`
        : action === 'write' && typeof args.source === 'string' && args.source.trim()
          ? `${이름} 에 저장해요(원본은 그대로 두어요)`
        : action === 'write' ? `${이름} 에 저장해요`
        : action === 'move' ? `${이름} 을(를) ${userVisiblePath(previewPathOf(args.to, roots, home), 카드루트)} 로 옮겨요`
            : `${이름} 을(를) ${action} 해요`;
      // **무엇이 적히는가.** 자리만 보여주면 사용자는 "무엇을 허락하는지" 절반만 안다 —
      // 실측(2026-07-27): 오너가 "뭘 적을지도 같이 알려줘"라고 물었는데 카드에는 파일 이름과
      // 자리만 있었고, 내용은 **승인한 뒤에야** 나왔다. 무엇이 적힐지 모르고 누른 것이다.
      // 요약하지 않는다(승인한 것과 적힌 것이 갈라진다). 길면 뒤를 접되 접었다고 말한다.
      const 적을것 = action === 'write' && typeof args.text === 'string' && args.text.trim()
        ? (args.text.length > 400 ? `${args.text.slice(0, 400)}\n… (${args.text.length}자 중 앞부분)` : args.text)
        : undefined;
      return {
        impact,
        ...(적을것 ? { what: 적을것 } : {}),
        // **실제로 어디에 생기는가.** 인자가 아니라 이 줄이 사용자가 확인할 사실이다.
        scope: userVisiblePath(abs, 카드루트),
        duration: '이번 한 번',
        // 되돌릴 수 있는지는 **이 작업에 대해** 말한다. 도구 전체 라벨로는 알 수 없다.
        // 그리고 **같은 write 라도 되돌리는 방식이 다르다** — 덮어쓰기는 원본을 되살리는 것이고
        // 새로 만들기는 만든 것을 치우는 것이다. 실측(오너 라이브 2026-07-28): 새 파일에도
        // "원본은 휴지통에 남아요"라고 말했는데 원본이 없었다. 카드가 못 지킬 약속을 했다.
        cancel: action === 'delete' || (action === 'write' && existsSync(abs))
          ? '원본은 휴지통에 남아요 — "되돌려줘"로 되살릴 수 있어요'
          : action === 'write'
            ? '새로 만드는 거예요 — "되돌려줘"라고 하시면 만든 파일을 휴지통으로 보내요'
            : '"되돌려줘"로 되살릴 수 있어요',
      };
    },
    async handler(args = {}, executionContext = {}) {
      const action = args.action ?? (args.path ? 'read' : 'list');
      const target = args.path ?? '.';
      const readOnly = action === 'list' || action === 'read' || action === 'versions';
      // **"내 컴퓨터"는 내 컴퓨터다**(2026-08-05 오너 지적).
      //
      // 네 폴더 울타리 때문에 `~/Developer`·`~/Music` 은 사용자가 시켜도 못 읽었다.
      // 그런데 **같은 파일이 `local.terminal` 로는 읽혔다** — 우회되는 울타리는 위험을 못 막고
      // 사용자가 시킨 일만 막는다. **안전 장치가 아니라 능력 손실이다.**
      //
      // 파괴도 같은 선이다. 오너 지시: *"쓰기/이동/삭제는 사용자 지시에 그렇게 하라는 내용이
      // 있으면 하면 되는 거고, 다른 지시를 수행하다 그게 필수적으로 필요해지면 승인을 요청하면
      // 되는 거고, 반복되면 학습으로 올리면 되는 거다."* **그 기계는 이미 다 있다** —
      // 시킨 파괴는 발화 안이라 돌고(휴지통), 안 시킨 파괴는 `발화밖파괴` 가 카드로 올리며
      // (S6-c 6번), 반복은 `허락한손`·자동화 제안이 받는다. 울타리는 그 위에 덧댄 중복이었다.
      //
      // 남는 절대선은 하나다 — 이 파일 아래가 이미 그렇게 적어 뒀다:
      //   *"범위 안이어도 보호 영역은 막는다. 루트를 넓혀도 여기는 안 열린다 —
      //     안전이 '좁은 루트'에서 나오던 구조를 대체하는 자리다."*
      // 터미널은 이미 그 규칙 하나로 돈다. **두 손을 같은 선에 세운다.**
      // 홈을 안 주면 실제 홈이다 — `resolveInScope` 의 기본과 같은 규칙(두 진실 금지).
      // 여기서 `undefined` 를 그대로 넣으면 루트 목록이 오염돼 **모든 경로가 막힌다**(밟음).
      const 홈자리 = home ?? homedir();
      const activeRoots = [...new Set([
        ...roots, 홈자리,
        // locate 가 이번 요청에서 연 자리는 읽기 계열에만 합친다(탐색 성공이 권한이 되지 않게).
        ...(readOnly ? (executionContext.readScopeRoots ?? []) : []),
      ])];
      try {
        await ensureRoot(roots);

        if (action === 'undo') {
          const list = await loadUndo();
          const last = list.pop();
          if (!last) return fail('되돌릴 작업이 없어요.');
          // C 감사 F5.1★ · **저장된 경로도 지금의 범위·보호를 지나야 실행된다.** 예전엔 이 블록이
          // resolveInScope·protectionBlocks 보다 앞에 있어, undo-log.json 에 적힌 절대 경로가
          // 검사 없이 mkdir·rename 됐다 — 로그 파일 자체가 범위 안(.trash)이라 write/move 로
          // 변조 가능했고, 재시작 뒤 낡은 기록·바뀐 범위·심볼릭 링크가 전부 열린 문이었다.
          // "모든 경로는 범위 안에서만"(위 계약 §)에 undo 만 예외일 이유가 없다.
          // resolveInScope 는 realpath 로 판정하므로 링크 탈출도 여기서 잡힌다.
          let 되돌릴곳; let 담긴곳;
          try {
            되돌릴곳 = await resolveInScope(last.from, { roots, home });
            // 사본(to)도 경계를 지난다 — from 만 검사하면 로그 변조로 임의 경로의 파일(비밀 포함)을
            // 범위 안으로 "되돌려" 끌어올 수 있다. 정당한 to 는 두 곳뿐이다: 휴지통(쓰기·삭제가
            // 담근 자리 — 라이브 GPAO_T5_DATA_DIR 격리에서는 파일 루트 밖일 수 있다)과
            // 범위 안(move 의 목적지). 같은 realpath 판정이라 링크 탈출도 막힌다.
            담긴곳 = last.to
              ? await resolveInScope(last.to, { roots, home }).catch((e) => {
                if (!e?.isScopeError) throw e;
                return resolveInScope(last.to, { roots: [trashDir], home });
              })
              : null;
          } catch (e) {
            if (e?.isScopeError) {
              return fail('그 되돌리기 기록은 지금 작업 범위 밖을 가리키고 있어서 실행하지 않았어요.', '되돌릴 파일이 범위 안에 있으면 이름을 알려 주세요.');
            }
            throw e;
          }
          const 되돌림보호 = protectionBlocks(되돌릴곳, { write: true });
          if (되돌림보호) {
            const msg = protectionMessage(되돌림보호, { write: true });
            return { blocked: true, scopeState: 'protected', ...msg };
          }
          // **만든 것을 되돌리는 길.** 되살릴 원본이 없으므로 복원이 아니라 치우는 것이다.
          // 이 갈래가 없으면 새로 만든 파일은 영영 못 되돌린다(승인 카드는 된다고 말하는데).
          if (!담긴곳) {
            const 치움 = await toTrash(되돌릴곳);
            await saveUndo(list);
            return ok(
              치움 ? `${basename(되돌릴곳)} 을(를) 되돌렸어요 — 만든 파일은 휴지통에 있어요.`
                : `${basename(되돌릴곳)} 은(는) 이미 없어요.`,
              { undone: last.op, path:되돌릴곳, trashed: Boolean(치움) },
            );
          }
          // 되살릴 사본이 실제로 있는지 먼저 본다 — 없는 사본을 "되돌렸어요"라고 말하면 거짓 성공이고,
          // 지금 자리의 파일을 먼저 치웠다면 실패가 사용자 파일 손실이 된다(실패 시 모두 보존).
          try { await stat(담긴곳); }
          catch { return fail('되돌릴 사본이 휴지통에 남아 있지 않아요.', '지금 파일은 그대로 두었어요.'); }
          await mkdir(dirname(되돌릴곳), { recursive: true });
          // **되돌리는 자리에 지금 다른 파일이 있으면 그것부터 휴지통으로.** rename 은 말없이 덮어쓴다 —
          // move 의 copyFile 은 막아 놓고 undo 의 rename 을 열어 두면 같은 손실이 그대로 난다:
          // 옮기고 → 사용자가 그 이름으로 새로 쓰고 → 되돌리면 새 내용이 영영 사라졌다(감사에서 실증).
          const parked = await toTrash(되돌릴곳);
          try {
            await rename(담긴곳, 되돌릴곳);
          } catch (e) {
            // 실패하면 방금 치운 지금 파일을 제자리로 — 원본도 지금 파일도 잃지 않는다.
            if (parked) { try { await rename(parked, 되돌릴곳); } catch { /* 사본은 휴지통에 남아 있다 */ } }
            throw e;
          }
          await saveUndo(list); // 성공한 뒤에 표에서 지운다(중간에 실패하면 되돌릴 기회가 남아야 한다)
          return ok(
            parked
              ? `${basename(되돌릴곳)} 을(를) 되돌렸어요(그 자리에 있던 파일은 휴지통에 있어요).`
              : `${basename(되돌릴곳)} 을(를) 되돌렸어요.`,
            { undone: last.op, path: 되돌릴곳, parked: Boolean(parked) },
          );
        }

        const abs = await resolveInScope(target, { roots: activeRoots, home });
        // P6-L1: **범위 안이어도 보호 영역은 막는다.** 루트를 넓혀도 여기는 안 열린다 —
        // 안전이 "좁은 루트"에서 나오던 구조를 대체하는 자리다(게이트가 불변식으로 검사한다).
        // secret 은 읽기까지, system 은 변경만 막는다(뭉뚱그리면 아무것도 못 하는 도구가 된다).
        const writes = action !== 'list' && action !== 'read' && action !== 'versions';
        const prot = protectionBlocks(abs, { write: writes });
        if (prot) {
          const msg = protectionMessage(prot, { write: writes });
          return { blocked: true, scopeState: 'protected', ...msg };
        }

        if (action === 'list') {
          const entries = await readdir(abs, { withFileTypes: true });
          const items = [];
          for (const e of entries) {
            if (e.name.startsWith('.')) continue;
            // C 감사 F2.3 · 수정 시각도 사실이다 — 이게 없으면 "어느 게 최신이야"에 런타임이
            // 줄 수 있는 것이 이름뿐이라, 이름의 '최종' 문자열이 판단을 대신하게 된다(H08 실측).
            let modifiedAt;
            try { modifiedAt = new Date((await stat(join(abs, e.name))).mtimeMs).toISOString(); } catch { /* 못 보면 안 쓴다 */ }
            items.push({ name: e.name, kind: e.isDirectory() ? 'folder' : 'file', ...(modifiedAt ? { modifiedAt } : {}) });
          }
          const 문값 = 문(items.length, args);
          const 쪽 = items.slice(문값.시작, 문값.끝);
          const 안내 = 문말(문값, '개');
          // **목록의 CSV 에도 표 합계를 동봉한다**(⑬ 진단·표적 수리 1회 · PM 한도 내 · 2026-08-09).
          // 진단: E4-R3 과 X1 세 판이 같은 후보·같은 재료에서 갈렸고, 갈린 지점은 목록 뒤
          // 읽으러 들어가느냐였다 — 멈춘 자리(목록)에 이름·시각뿐이라 일반론이 쉬웠다.
          // 레버 ① 의 목록판: 이 쪽의 CSV 앞 5개만 · 256KB 상한 · 애매하면 안 낸다.
          {
            let 셈 = 0;
            for (const it of 쪽) {
              if (it.kind !== 'file' || !it.name.normalize('NFC').toLowerCase().endsWith('.csv') || 셈 >= 5) continue;
              try {
                const p = join(abs, it.name);
                const st = await stat(p);
                if (st.size > 262_144) continue;
                const t = 표사실((await readFile(p)).toString('utf8'));
                if (t) { it.table = t; 셈 += 1; }
              } catch { /* 이웃을 못 읽어도 목록은 이미 됐다 */ }
            }
          }
          return ok(
            items.length
              ? (안내 ? `${items.length}개 중 ${안내}` : `${items.length}개를 찾았어요.`)
              : '그 폴더는 비어 있어요.',
            {
              path: abs, items: 쪽, total: items.length, offset: 문값.시작,
              ...(문값.다음 !== undefined ? { nextOffset: 문값.다음 } : {}),
            },
          );
        }

        if (action === 'read') {
          const info = await stat(abs);
          if (info.size > MAX_READ_BYTES) {
            return fail('파일이 너무 커서 통째로 읽지 못했어요.', '필요한 부분을 알려주시면 그 부분만 볼게요.');
          }
          const bytes = await readFile(abs);
          const document = await extractDocument(abs, bytes);
          if (document && !document.text) {
            return fail(
              `${basename(abs)} 형식은 확인했지만 본문을 안전하게 꺼내지 못했어요.`,
              '원본은 그대로 두었어요. 다른 형식으로 내보낸 사본이 있으면 바로 읽을게요.',
            );
          }
          const 전문 = document?.text ?? bytes.toString('utf8');
          const 문값 = 문(전문.length, args);
          const text = 전문.slice(문값.시작, 문값.끝);
          const 안내 = 문말(문값, '자');
          // **같은 자리에 무엇이 더 있는지는 손이 이미 아는 사실이다**(3단계 매듭 ① · 2026-08-08).
          // ⑤ 실측 2/3: 한 폴더의 두 자료 중 하나만 읽고 부분합(2,120,000)을 전체처럼 말했다 —
          // 확신 있는 부분합은 빈손 되묻기보다 나쁘다(사용자를 속인다). 판단하지 않는다:
          // 목록만 준다. 더 읽을지는 모델이 정한다. 자료기간과 같은 병(아는 것을 안 줌)의 이웃 칸.
          const 같은자리 = [];
          try {
            for (const e of await readdir(dirname(abs), { withFileTypes: true })) {
              if (!e.isFile() || e.name.startsWith('.')) continue;
              const full = join(dirname(abs), e.name);
              if (full === abs || protectionBlocks(full, { write: false })) continue;
              같은자리.push(e.name);
              if (같은자리.length >= 8) break;
            }
          } catch { /* 이웃을 못 세도 읽기는 이미 됐다 — 빈 채로 간다 */ }
          // 이웃 사실은 **요약줄에도** 싣는다(감사 승인 레버 ① · 2026-08-08). data 깊숙이만 넣으니
          // 모델이 지나쳤다 — 요약줄은 원장·모델·사용자가 다 보는 가장 강한 지면이다.
          // 표 사실도 요약줄에 싣는다(레버 ① 과 같은 지면) — 합계가 data 깊숙이만 있으면
          // 모델이 지나치고 암산으로 돌아간다(이웃 사실에서 이미 밟은 병).
          const 표 = extname(abs).toLowerCase() === '.csv' && !document ? 표사실(전문) : null;
          // **이웃의 합계도 손이 아는 사실이다**(레버 ① 연장 · 회차 H 실측 2026-08-08).
          // 이름만 주니 모델이 안 읽은 채 부분합에 "총" 을 명명했다(⑤ H R1·R2 · ⑫ H R3 —
          // 그물이 사실을 되돌려도 answerOnly 되돌림에는 손이 없어 마저 읽을 수 없다).
          // CSV 를 읽는 맥락에서만, 보이는 이웃(앞 3개)의 CSV 표 합계를 같은 지면에 동봉한다 —
          // 첫 답을 짓는 순간 모든 숫자가 기계 사실로 손에 있게. 못 읽거나 애매하면 이름만 남는다.
          const 이웃표 = {};
          if (표) {
            for (const n of 같은자리.slice(0, 3)) {
              if (!n.normalize('NFC').toLowerCase().endsWith('.csv')) continue;
              try {
                const p = join(dirname(abs), n);
                const st = await stat(p);
                if (st.size > 262_144) continue;
                const t = 표사실((await readFile(p)).toString('utf8'));
                if (t) 이웃표[n] = t;
              } catch { /* 이웃을 못 읽어도 본 읽기는 이미 됐다 */ }
            }
          }
          // ⚠ `같은자리파일` 은 **순수 이름 배열로 동결** — 출구 그물이 이름 일치로 잰다.
          const 이웃이름 = (n) => (이웃표[n]
            ? `${n}(표 ${이웃표[n].rows}행 · 합계 ${Object.entries(이웃표[n].sums).slice(0, 2)
              .map(([열, 값]) => `${열} ${값.toLocaleString('ko-KR')}`).join(' · ')})`
            : n);
          const 이웃말 = 같은자리.length
            ? ` (같은 자리에 ${같은자리.length}개 더: ${같은자리.slice(0, 3).map(이웃이름).join(' · ')}${같은자리.length > 3 ? ' …' : ''})`
            : '';
          // X1(4단계 의미 계열 · PM 승인 2026-08-09): **열 목록을 함께 싣는다** — 부재를 낱말로
          // 선언하지 않고 있는 것의 전부를 보여줘서 없는 것이 드러나게 한다. E4 실측: 자료가
          // 두 열뿐인데 모델이 자료에 없는 구분(수입/지출류)을 지어 분류하고 한쪽을 0 으로
          // 뭉갰다. 열 이름은 자료에서 온 데이터라 §1-B 순수성과 충돌하지 않는다.
          const 표말 = 표
            ? ` (표 ${표.rows}행 · 열: ${표.columns.slice(0, 5).join('·')} · 합계 ${Object.entries(표.sums).slice(0, 3)
              .map(([열, 값]) => `${열} ${값.toLocaleString('ko-KR')}`).join(' · ')})`
            : '';
          return ok((안내 ? `${basename(abs)} 의 ${안내}` : `${basename(abs)} 을(를) 읽었어요.`) + 표말 + 이웃말, {
            path: abs, text, bytes: info.size,
            totalChars: 전문.length, offset: 문값.시작,
            ...(문값.다음 !== undefined ? { nextOffset: 문값.다음 } : {}),
            ...(document ? { document } : {}),
            ...(표 ? { table: 표 } : {}),
            ...(같은자리.length ? { 같은자리파일: 같은자리 } : {}),
            ...(Object.keys(이웃표).length ? { 같은자리표: 이웃표 } : {}),
            modifiedAt: new Date(info.mtimeMs).toISOString(), // F2.3 — stat 을 이미 했으면 버리지 않는다
          });
        }

        // H08 · **최종본 판별.** "견적서 최종본만 정리해줘" — 이름의 "최종/final"은 판별 근거가
        // 못 된다(사람들은 최종을 만들고 나서도 v2 를 또 만든다). **수정 시각과 실제 내용**으로
        // 판별하고, 시각과 이름이 갈리는데 내용도 다르면 추측하지 않는다 — 그때가 최소 질문의 자리다.
        if (action === 'versions') {
          const info = await stat(abs);
          const 폴더 = info.isDirectory() ? abs : dirname(abs);
          // 이름 낱말: 인자로 받거나, 파일을 짚어 줬으면 그 이름의 머리로 삼는다.
          let 이름낱말 = String(args.name ?? '').trim().normalize('NFC').toLowerCase();
          if (!이름낱말 && !info.isDirectory()) {
            이름낱말 = basename(abs).replace(/\.[^.]*$/, '').split(/[-_\s(]/)[0].normalize('NFC').toLowerCase();
          }
          if (!이름낱말) return fail('어떤 이름의 파일들을 비교할지 알려주시면 최종본을 찾아볼게요.');

          const 식구 = [];
          for (const e of await readdir(폴더, { withFileTypes: true })) {
            if (!e.isFile() || e.name.startsWith('.')) continue;
            if (!e.name.normalize('NFC').toLowerCase().includes(이름낱말)) continue;
            const full = join(폴더, e.name);
            if (protectionBlocks(full, { write: false })) continue; // 비밀 이름은 비교 대상에도 안 올린다
            const s = await stat(full);
            const 한판 = {
              name: e.name, path: full, bytes: s.size,
              modifiedAt: new Date(s.mtimeMs).toISOString(), mtimeMs: s.mtimeMs,
              nameSaysFinal: /최종|final/i.test(e.name),
            };
            // 내용은 같음/다름을 가리는 데만 쓴다(해시). 못 읽으면 **못 읽었다고 남긴다** —
            // 안 읽고 같다/다르다를 말하면 그게 추측이다(모름을 사실로 전달).
            if (s.size <= MAX_READ_BYTES) {
              try {
                const 내용 = await readFile(full, 'utf8');
                한판.hash = createHash('sha256').update(내용).digest('hex');
                한판.내용 = 내용;
              }
              catch { 한판.contentUnread = true; }
            } else 한판.contentUnread = true;
            식구.push(한판);
          }
          if (식구.length === 0) {
            return fail(`${basename(폴더)} 안에서 "${이름낱말}" 이름의 파일을 찾지 못했어요.`, '이름이나 폴더를 다시 알려주시겠어요?');
          }
          식구.sort((a, b) => b.mtimeMs - a.mtimeMs);
          // 모델이 "내용이 다르다"는 해시 사실만 보고 내용을 상상하지 않게, 최신 후보 몇 개의
          // 실제 내용을 제한해서 함께 준다. 이미 허용 범위 안에서 읽은 파일이고, 파일 수·글자 수
          // 상한으로 프롬프트 폭주를 막는다.
          for (const f of 식구.slice(0, VERSION_PREVIEW_FILES)) {
            if (typeof f.내용 !== 'string') continue;
            f.contentPreview = f.내용.slice(0, VERSION_PREVIEW_CHARS);
            if (f.내용.length > VERSION_PREVIEW_CHARS) f.contentPreviewTruncated = true;
          }
          // 같은 내용은 같은 판이다 — 최신 쪽을 대표로 두고, 나머지에 "누구와 같은지"를 남긴다.
          const 본해시 = new Map();
          for (const f of 식구) {
            if (!f.hash) continue;
            const 먼저 = 본해시.get(f.hash);
            if (먼저) f.sameContentAs = 먼저; else 본해시.set(f.hash, f.name);
          }

          const 최신 = 식구[0];
          const 이름최종 = 식구.find((f) => f.nameSaysFinal); // 최신순이라 첫 것이 가장 최근의 "최종"
          let 최종본 = null; let 왜 = '';
          if (식구.length === 1) { 최종본 = 최신; 왜 = '이 이름으로는 이 파일 하나예요'; }
          else if (!이름최종) { 최종본 = 최신; 왜 = '가장 최근에 고친 파일이에요'; }
          else if (이름최종 === 최신) { 최종본 = 최신; 왜 = '이름에 최종 표시가 있고, 가장 최근에 고친 파일이기도 해요'; }
          else if (이름최종.hash && 최신.hash && 이름최종.hash === 최신.hash) {
            최종본 = 최신; 왜 = `최종 표시가 붙은 ${이름최종.name} 과 내용이 같고 더 최근이에요`;
          }
          // 그 밖(이름은 최종인데 더 최근 파일이 있고, 내용이 다르거나 못 읽었다)은 고르지 않는다.

          const 못읽음 = 식구.filter((f) => f.contentUnread).length;
          const files = 식구.map(({ mtimeMs, hash, 내용, ...공개 }) => 공개);
          if (최종본) {
            return ok(
              `최종본은 ${최종본.name} 으로 보여요 — ${왜}.`,
              {
                path: 폴더, name: 이름낱말, files,
                final: { name: 최종본.name, path: 최종본.path, why: 왜 },
                ...(못읽음 ? { unreadCount: 못읽음 } : {}),
              },
            );
          }
          return {
            result: { path: 폴더, name: 이름낱말, files, final: null, ambiguous: true, ...(못읽음 ? { unreadCount: 못읽음 } : {}) },
            userSafeSummary: (이름최종.contentUnread || 최신.contentUnread)
              ? `이름은 ${이름최종.name} 이 최종이라는데 ${최신.name} 이 더 최근이에요. 내용은 읽지 못해 비교하지 못했어요.`
              : `이름은 ${이름최종.name} 이 최종이라는데, ${최신.name} 이 더 최근이고 내용도 달라요.`,
            nextSafeAction: '어느 쪽을 최종본으로 볼지 알려주시면 그것만 정리할게요.',
          };
        }

        if (action === 'write') {
          const text = String(args.text ?? '');
          // H08 · **원본 보호.** "정리해줘, 원본은 건드리지 마" — 결과물은 별도 파일이어야 한다.
          // 휴지통 백업이 있어도 원본 자리를 덮으면 원본을 건드린 것이다. 모델이 `source` 로
          // 원본을 밝히면(어디서 만든 결과물인지), 그 자리로는 저장하지 않는다.
          let 원본;
          if (typeof args.source === 'string' && args.source.trim()) {
            // 원본도 대상(abs)과 **같은 자**를 봐야 같은 자리인지 알 수 있다 — 여기만 홈 없는 자를
            // 보면 좁힌 구성에서 `source:'Desktop/…'` 가 ScopeError 로 삼켜져 원본 보호가 조용히
            // 꺼진다(공정감시 지적 2026-08-08 · ⑫ 앵커 통일이 만든 새 갈래).
            try { 원본 = await resolveInScope(args.source, { roots: [...roots, home ?? homedir()], home }); }
            catch { /* 원본 표시가 틀렸다고 저장까지 막지는 않는다 — 같은 자리일 수 없으면 지킬 것도 없다 */ }
          }
          if (원본 && 원본 === abs) {
            return fail(
              `${basename(abs)} 은(는) 원본이라 덮어쓰지 않았어요.`,
              `정리 결과는 다른 이름(예: ${basename(abs).replace(/\.[^.]*$/, '')}-정리본)으로 저장할까요?`,
            );
          }
          await mkdir(dirname(abs), { recursive: true });
          const parked = await toTrash(abs); // 덮어쓰기면 원본을 휴지통으로(되돌릴 수 있게)
          await writeFile(abs, text, 'utf8');
          // **새로 만든 것도 되돌릴 수 있어야 한다.** 예전엔 덮어쓰기만 표에 남겼다 —
          // 실측(오너 라이브 2026-07-28): 승인 카드가 "되돌려줘로 되살릴 수 있어요"라고 약속하고
          // 저장했는데 "되돌릴 작업이 없다"가 나왔다. 카드가 못 지킬 약속을 한 것이다.
          // 만들기의 되돌리기는 복원이 아니라 **만든 것을 치우는 것**이라 되살릴 원본(`to`)이 없다.
          await pushUndo(parked ? undoEntry('write', abs, parked) : undoEntry('create', abs, null));
          // 실물의 숫자 대조 사실 — 루프 안에서 모델이 손을 쥔 채 받는 되부름(위 쓴숫자대조 주석).
          const 대조말 = 쓴숫자대조(text, executionContext?.표맥락) ?? '';
          return ok(
            (parked ? `${basename(abs)} 을(를) 새 내용으로 저장했어요(이전 내용은 되돌릴 수 있어요).`
              : `${basename(abs)} 을(를) 만들었어요.`) + 대조말,
            {
              path: abs, bytes: Buffer.byteLength(text), overwritten: Boolean(parked),
              // C 감사 F2.1 · **산출물의 내용 신분.** lane 은 digest 가 있으면 그것을 신분으로
              // 쓰는데 생산자가 없어 항상 경로+턴 폴백이었다 — 같은 경로가 나중에 바뀌어도
              // "같은 산출물"로 이어지는 병. 쓰기가 자기 내용의 digest 를 낸다.
              digest: createHash('sha256').update(text).digest('hex'),
              // 원본을 안 건드렸다는 건 **말할 수 있는 사실**이어야 한다 — 결과에 남긴다.
              ...(원본 ? { originalUntouched: true, source: 원본 } : {}),
            },
          );
        }

        if (action === 'move') {
          const dest = await resolveInScope(args.to ?? '', { roots: [...roots, home ?? homedir()], home });
          // 목적지도 본다 — 보호 영역으로 **옮겨 넣는 것**도 변경이다.
          const destProt = protectionBlocks(dest, { write: true });
          if (destProt) {
            const msg = protectionMessage(destProt, { write: true });
            return { blocked: true, scopeState: 'protected', ...msg };
          }
          // **조용한 덮어쓰기 금지**(P0-1b): 대상이 이미 있으면 막고 확인을 요구한다.
          // copyFile 은 대상을 말없이 덮어쓰는데, 그러면 undo(대상→원본)로도 대상의 원래 내용은
          // 영영 사라진다 — 되돌릴 수 없는 손실이다. write 는 휴지통 백업이 있는데 move 만 빠져 있었다.
          let destExists = false;
          try { await stat(dest); destExists = true; } catch { /* 없으면 진행 */ }
          if (destExists) {
            return fail(
              `${basename(dest)} 이(가) 이미 있어서 옮기지 않았어요(덮어쓰면 되돌릴 수 없어요).`,
              '다른 이름으로 옮기거나, 기존 파일을 먼저 지울까요?',
            );
          }
          const moveInfo = await stat(abs);
          await mkdir(dirname(dest), { recursive: true });
          if (moveInfo.isDirectory()) {
            await rename(abs, dest);
            await pushUndo(undoEntry('move', abs, dest));
            return ok(`${basename(abs)} 폴더를 ${basename(dest)} 로 옮겼어요.`, { from: abs, to: dest });
          }
          await copyFile(abs, dest);
          // C 감사 F5.4 · **부분 실패는 사본을 남기지 않는다.** copyFile 뒤 rm 이 실패하면
          // 예전엔 dest 사본이 조용히 남고("문제가 있었어요"만 나감) 재시도는 destExists 에
          // 영영 막혔다 — 막다른 자리. 사본을 되물려 원래 상태로 돌리고 정직하게 말한다.
          try {
            await rm(abs);
          } catch (e) {
            let 사본정리 = true;
            try { await rm(dest); } catch { 사본정리 = false; }
            return fail(
              사본정리
                ? `${basename(abs)} 을(를) 옮기지 못했어요 — 원본은 그대로 있어요.`
                : `${basename(abs)} 을(를) 옮기다 멈췄어요 — 원본은 그대로 있고, ${basename(dest)} 자리에 사본이 남았어요.`,
              '원본이 있는 폴더의 권한을 확인한 뒤 다시 할까요?',
            );
          }
          await pushUndo(undoEntry('move', abs, dest));
          return ok(`${basename(abs)} 을(를) ${basename(dest)} 로 옮겼어요.`, { from: abs, to: dest });
        }

        if (action === 'bulk_move') {
          const info = await stat(abs);
          if (!info.isDirectory()) return fail('여러 파일을 옮기려면 폴더를 대상으로 해야 해요.', '폴더를 알려주시면 조건에 맞는 파일만 옮길게요.');
          const matcher = bulkMatch(args.match);
          if (!matcher.hasAny) {
            return fail('옮길 조건이 없어서 아무 파일도 옮기지 않았어요.', '확장자나 이름 조건을 알려주시면 그 조건에 맞는 것만 옮길게요.');
          }
          const destDir = await resolveInScope(args.to ?? '', { roots: [...roots, home ?? homedir()], home });
          const destProt = protectionBlocks(destDir, { write: true });
          if (destProt) {
            const msg = protectionMessage(destProt, { write: true });
            return { blocked: true, scopeState: 'protected', ...msg };
          }
          const entries = await readdir(abs, { withFileTypes: true });
          const candidates = [];
          const 전체이름들 = [];
          for (const e of entries) {
            if (!e.isFile() || e.name.startsWith('.')) continue;
            const full = join(abs, e.name);
            let info;
            try { info = await stat(full); } catch { continue; }
            전체이름들.push(e.name);
            if (matcher.test(e.name, info)) candidates.push(e.name);
          }
          candidates.sort();
          if (!candidates.length) {
            // **왜 0인지를 말한다.** 조건들은 서로 **AND** 로 걸린다 — `namePrefix` 와
            // `nameIncludes` 를 함께 주면 "그 접두어로 시작하면서 그 낱말도 든" 파일만이다.
            //
            // 실측(S1 라이브 2026-08-04): 모델이 "backup- 로 시작하는 것들"과 "이름에 임시·temp
            // 가 든 것들"을 **둘 다 모으려고**(OR 의도) 한 호출에 넣었다. AND 라서 0개가 나왔고,
            // 결과는 "조건에 맞는 파일이 없어서 옮기지 않았어요"뿐이었다. 모델은 원인을
            // **경로 문제로 잘못 짚고** 사용자에게 그렇게 말했다 — 조용한 0 이 거짓 진단을 낳았다.
            //
            // 그래서 조건 하나하나가 **각각 몇 개를 잡는지** 돌려준다. 모델이 스스로 나눠 부른다.
            const 각각 = matcher.조건들.map((c) => ({
              조건: c.이름,
              잡히는수: 전체이름들.filter((n) => c.통과(n.toLowerCase())).length,
            }));
            const 낱개 = 각각.map((x) => `${x.조건} ${x.잡히는수}개`).join(' · ');
            const 여럿 = 각각.length > 1;
            return fail(
              `조건에 맞는 파일이 없어서 옮기지 않았어요.${낱개 ? ` 조건별로는 ${낱개} 인데, 조건은 모두 만족해야 해요.` : ''}`,
              여럿 ? '조건을 하나씩 나눠서 부르면 각각 옮길 수 있어요.' : '다른 조건으로 다시 찾아볼까요?',
              { 조건별: 각각, 모두만족해야함: true, 훑은수: 전체이름들.length },
            );
          }
          await mkdir(destDir, { recursive: true });

          const moved = [];
          const skipped = [];
          for (const name of candidates) {
            const from = join(abs, name);
            const to = join(destDir, name);
            let exists = false;
            try { await stat(to); exists = true; } catch { /* 없으면 진행 */ }
            if (exists) {
              skipped.push({ name, reason: 'destination_exists' });
              continue;
            }
            await copyFile(from, to);
            try {
              await rm(from);
            } catch (e) {
              try { await rm(to); } catch { /* 사본 정리 실패는 아래에서 실패로 보고 */ }
              return fail(`${name} 을(를) 옮기다 멈췄어요 — 원본은 그대로 있어요.`, '원본 폴더의 권한을 확인한 뒤 다시 할까요?');
            }
            await pushUndo(undoEntry('move', from, to));
            moved.push({ from, to });
          }
          if (!moved.length) {
            return fail('조건에 맞는 파일은 있었지만 대상에 같은 이름이 있어서 옮기지 않았어요.', '다른 폴더나 다른 이름 규칙으로 옮길까요?');
          }
          return ok(
            skipped.length
              ? `${moved.length}개를 옮겼고, 같은 이름 ${skipped.length}개는 그대로 두었어요.`
              : `${moved.length}개를 옮겼어요.`,
            { from: abs, to: destDir, moved, skipped, remainingSource: await remainingSummary(abs) },
          );
        }

        if (action === 'delete') {
          const parked = await toTrash(abs);
          if (!parked) return fail(`${basename(abs)} 을(를) 찾지 못했어요.`);
          await pushUndo(undoEntry('delete', abs, parked));
          return ok(`${basename(abs)} 을(를) 지웠어요(되돌릴 수 있어요).`, { path: abs, recoverable: true });
        }

        return fail(`'${action}' 은(는) 제가 할 수 있는 파일 작업이 아니에요.`, '보기·읽기·저장·옮기기·지우기·되돌리기·최종본 확인(versions)이 가능해요.');
      } catch (e) {
        return failureOf(e, target);
      }
    },
  };
}
