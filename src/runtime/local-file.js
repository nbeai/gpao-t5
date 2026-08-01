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
import { readFile, writeFile, readdir, stat, mkdir, rename, rm, copyFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolveInScope, ensureRoot, outOfScopeMessage, defaultFileRoots, previewPathOf } from './file-scope.js';
import { protectionBlocks, protectionMessage } from './local-protection.js';

const MAX_READ_BYTES = 1_000_000; // 너무 큰 파일은 통째로 읽지 않는다(메모리·프롬프트 보호)

/** 되돌리기 표 한 줄. 휴지통 경로와 원래 자리를 함께 남긴다. */
function undoEntry(op, from, to) {
  return { id: randomUUID(), op, from, to, at: new Date().toISOString() };
}

/**
 * @param {{roots?:string[], trashDir?:string, dataDir?:string}} [deps]
 */
export function makeLocalFileTool(deps = {}) {
  const roots = deps.roots ?? defaultFileRoots();
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
  const fail = (userSafeSummary, nextSafeAction) => ({ blocked: true, userSafeSummary, nextSafeAction });

  /** 실패를 종류별로 사용자 언어로. 진단 원문은 화면에 내보내지 않는다. */
  function failureOf(e, path) {
    // 범위 밖은 **되는 방법을 제안할 수 있는 실패**다(§22). 사다리가 알아볼 표식을 단다.
    if (e?.isScopeError) return { blocked: true, scopeState: 'out_of_scope', ...outOfScopeMessage(e) };
    // **어디에서** 찾았는지 말한다. 이게 없으면 모델은 자기가 어디를 보고 있는지 몰라서
    // "접근이 막힌 것 같다"고 추측하고 터미널 명령을 시킨다(라이브 실측 — 개발자 떠넘김).
    if (e?.code === 'ENOENT') {
      return fail(
        `제가 다루는 폴더(${roots[0]}) 안에서 ${path} 을(를) 찾지 못했어요.`,
        '다른 폴더에 있다면 그 폴더를 열어 주시면 바로 볼게요.',
      );
    }
    if (e?.code === 'EACCES' || e?.code === 'EPERM') return fail('그 파일에 접근할 권한이 없어요.', '다른 파일로 해볼까요?');
    if (e?.code === 'EISDIR') return fail('그건 파일이 아니라 폴더예요.', '폴더 안을 보여드릴까요?');
    if (e?.code === 'ENOSPC') return fail('저장 공간이 부족해요.', '공간을 확보한 뒤 다시 할까요?');
    return fail('파일 작업 중 문제가 있었어요.', '다시 시도해 볼까요?');
  }

  return {
    toolKind: 'organize',
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
        return {
          impact: '방금 한 파일 작업을 되돌려요',
          scope: `${roots[0]} 안`,
          duration: '이번 한 번',
          cancel: '되돌리기를 되돌릴 수는 없어요 — 다시 하면 됩니다',
        };
      }
      const abs = previewPathOf(args.path, roots);
      const 이름 = basename(abs);
      const impact = action === 'delete' ? `${이름} 을(를) 지워요`
        : action === 'write' && typeof args.source === 'string' && args.source.trim()
          ? `${이름} 에 저장해요(원본은 그대로 두어요)`
        : action === 'write' ? `${이름} 에 저장해요`
          : action === 'move' ? `${이름} 을(를) ${previewPathOf(args.to, roots)} 로 옮겨요`
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
        scope: abs,
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
    async handler(args = {}) {
      const action = args.action ?? (args.path ? 'read' : 'list');
      const target = args.path ?? '.';
      try {
        await ensureRoot(roots);

        if (action === 'undo') {
          const list = await loadUndo();
          const last = list.pop();
          if (!last) return fail('되돌릴 작업이 없어요.');
          // **만든 것을 되돌리는 길.** 되살릴 원본이 없으므로 복원이 아니라 치우는 것이다.
          // 이 갈래가 없으면 새로 만든 파일은 영영 못 되돌린다(승인 카드는 된다고 말하는데).
          if (!last.to) {
            const 치움 = await toTrash(last.from);
            await saveUndo(list);
            return ok(
              치움 ? `${basename(last.from)} 을(를) 되돌렸어요 — 만든 파일은 휴지통에 있어요.`
                : `${basename(last.from)} 은(는) 이미 없어요.`,
              { undone: last.op, path: last.from, trashed: Boolean(치움) },
            );
          }
          await mkdir(dirname(last.from), { recursive: true });
          // **되돌리는 자리에 지금 다른 파일이 있으면 그것부터 휴지통으로.** rename 은 말없이 덮어쓴다 —
          // move 의 copyFile 은 막아 놓고 undo 의 rename 을 열어 두면 같은 손실이 그대로 난다:
          // 옮기고 → 사용자가 그 이름으로 새로 쓰고 → 되돌리면 새 내용이 영영 사라졌다(감사에서 실증).
          const parked = await toTrash(last.from);
          await rename(last.to, last.from);
          await saveUndo(list); // 성공한 뒤에 표에서 지운다(중간에 실패하면 되돌릴 기회가 남아야 한다)
          return ok(
            parked
              ? `${basename(last.from)} 을(를) 되돌렸어요(그 자리에 있던 파일은 휴지통에 있어요).`
              : `${basename(last.from)} 을(를) 되돌렸어요.`,
            { undone: last.op, path: last.from, parked: Boolean(parked) },
          );
        }

        const abs = await resolveInScope(target, { roots });
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
          const items = entries
            .filter((e) => !e.name.startsWith('.'))
            .map((e) => ({ name: e.name, kind: e.isDirectory() ? 'folder' : 'file' }));
          return ok(
            items.length ? `${items.length}개를 찾았어요.` : '그 폴더는 비어 있어요.',
            { path: abs, items },
          );
        }

        if (action === 'read') {
          const info = await stat(abs);
          if (info.size > MAX_READ_BYTES) {
            return fail('파일이 너무 커서 통째로 읽지 못했어요.', '필요한 부분을 알려주시면 그 부분만 볼게요.');
          }
          const text = await readFile(abs, 'utf8');
          return ok(`${basename(abs)} 을(를) 읽었어요.`, { path: abs, text, bytes: info.size });
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
              try { 한판.hash = createHash('sha256').update(await readFile(full)).digest('hex'); }
              catch { 한판.contentUnread = true; }
            } else 한판.contentUnread = true;
            식구.push(한판);
          }
          if (식구.length === 0) {
            return fail(`${basename(폴더)} 안에서 "${이름낱말}" 이름의 파일을 찾지 못했어요.`, '이름이나 폴더를 다시 알려주시겠어요?');
          }
          식구.sort((a, b) => b.mtimeMs - a.mtimeMs);
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
          const files = 식구.map(({ mtimeMs, hash, ...공개 }) => 공개);
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
            try { 원본 = await resolveInScope(args.source, { roots }); }
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
          return ok(
            parked ? `${basename(abs)} 을(를) 새 내용으로 저장했어요(이전 내용은 되돌릴 수 있어요).`
              : `${basename(abs)} 을(를) 만들었어요.`,
            {
              path: abs, bytes: Buffer.byteLength(text), overwritten: Boolean(parked),
              // 원본을 안 건드렸다는 건 **말할 수 있는 사실**이어야 한다 — 결과에 남긴다.
              ...(원본 ? { originalUntouched: true, source: 원본 } : {}),
            },
          );
        }

        if (action === 'move') {
          const dest = await resolveInScope(args.to ?? '', { roots });
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
          await mkdir(dirname(dest), { recursive: true });
          await copyFile(abs, dest);
          await rm(abs);
          await pushUndo(undoEntry('move', abs, dest));
          return ok(`${basename(abs)} 을(를) ${basename(dest)} 로 옮겼어요.`, { from: abs, to: dest });
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
