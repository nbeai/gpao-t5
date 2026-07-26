// L3 · 작업 범위 도구 (P6-L2) — **사용자가 폴더를 여는 길.**
//
// 이 도구가 없어서 오늘 이런 일이 났다(실측): 사용자가 "디벨로퍼 폴더 봐줘"라고 하자 T5 가
// "터미널에서 `ls` 결과를 붙여 주세요"라고 답했다. 헌장에 금지를 넣어도 그대로였다 —
// **모델이 옳았다.** 폴더를 넓히는 길이 없으니 실제로 되는 유일한 방법을 제안한 것이다.
//
// 그래서 규칙 대신 길을 만든다. 모델은 이 도구를 **고르기만** 하고, 실제로 여는 것은
// 기존 경로를 그대로 탄다: 계획 → 승인(A3, 안전 바닥) → 실행 → 원장.
// 폴더를 여는 것은 사용자의 결정이지 모델의 결정이 아니다.
//
// 보호 영역은 이것과 무관하다 — 홈을 열어도 `~/.ssh` 는 안 열린다(1단계에서 세운 안전막).
import { wellKnownFor, WELL_KNOWN } from '../surface/local-roots-store.js';
import { protectionFor } from './local-protection.js';

/**
 * @param {{store:import('../surface/local-roots-store.js').LocalRootsStore}} deps
 */
export function makeLocalScopeTool(deps = {}) {
  const store = deps.store;
  return {
    async handler(args = {}) {
      if (!store) {
        return { blocked: true, userSafeSummary: '지금은 폴더를 여는 기능이 준비되지 않았어요.' };
      }
      const action = args.action ?? 'list';

      if (action === 'list') {
        const opened = await store.opened();
        return {
          result: { opened, wellKnown: WELL_KNOWN.map((w) => ({ key: w.key, label: w.label, path: w.path })) },
          userSafeSummary: opened.length
            ? `지금 다룰 수 있는 폴더: ${opened.map((r) => r.label).join(', ')}.`
            : '아직 따로 연 폴더는 없어요.',
        };
      }

      if (action === 'close') {
        const done = await store.close(args.path ?? '');
        return {
          result: { closed: done, path: args.path },
          userSafeSummary: done ? '그 폴더는 이제 안 봐요.' : '그 폴더는 열려 있지 않았어요.',
        };
      }

      // open — 이름("데스크탑")으로도, 경로로도 연다. 경로를 외우게 하지 않는다.
      const known = args.path ? undefined : wellKnownFor(args.name ?? args.request ?? '');
      const target = args.path ?? known?.path;
      if (!target) {
        return {
          blocked: true,
          userSafeSummary: '어느 폴더를 열지 알아듣지 못했어요.',
          nextSafeAction: `데스크탑·문서·다운로드처럼 이름으로 말해 주셔도 되고, 폴더를 끌어다 놓으셔도 돼요.`,
        };
      }
      // 보호 영역은 열지 않는다 — 열어 달라고 해도.
      const prot = protectionFor(target);
      if (prot?.kind === 'secret') {
        return {
          blocked: true,
          userSafeSummary: `그 자리는 열지 않아요 — ${prot.why}.`,
          nextSafeAction: '필요한 파일만 작업 폴더로 옮겨 주시면 거기서 다룰게요.',
        };
      }
      const r = await store.open(target, known?.label);
      if (!r.ok) {
        return {
          blocked: true,
          userSafeSummary: '그 폴더를 찾지 못했어요.',
          nextSafeAction: '이름이 정확한지 한 번만 확인해 주시겠어요?',
        };
      }
      return {
        result: { opened: r.root.path, label: r.root.label },
        userSafeSummary: `${r.root.label} 폴더를 열었어요. 이제 그 안을 볼 수 있어요.`,
        // 되돌릴 수 있다고 말하려면 실제 경로가 있어야 한다 — `close` 가 그 경로다.
        undoable: true,
      };
    },
  };
}
