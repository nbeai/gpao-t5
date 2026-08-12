import { randomUUID } from 'node:crypto';
import { resolveInScope } from './file-scope.js';
import { protectionBlocks } from './local-protection.js';
import { containsSensitiveValue } from '../kernel/l0-evidence/sensitive-text.js';

function blocked(userSafeSummary, nextSafeAction) {
  return { blocked: true, userSafeSummary, nextSafeAction };
}

export function makeAgentDelegateTool({ runtime, localFile }) {
  return {
    toolKind: 'read',
    async handler(args = {}, executionContext = {}) {
      const partitions = Array.isArray(args.partitions) ? args.partitions : [];
      if (partitions.length < 2 || partitions.length > 3) {
        return blocked('이 작업은 두세 갈래로 나눌 범위가 필요해요.', '조사할 폴더를 두세 개로 정해 주세요.');
      }
      const roots = [...new Set([
        ...(localFile?.scopeRoots ?? []),
        ...(executionContext.readScopeRoots ?? []),
      ])];
      if (!roots.length) {
        return blocked('에이전트가 안전하게 볼 수 있는 파일 범위를 확인하지 못했어요.', '먼저 작업 폴더를 찾아볼게요.');
      }
      const normalized = [];
      try {
        for (const [index, partition] of partitions.entries()) {
          const folder = await resolveInScope(partition?.folder ?? '', { roots });
          if (protectionBlocks(folder, { write: false })) throw new Error('protected_read_scope');
          normalized.push({
            label: String(partition?.label ?? `갈래 ${index + 1}`).slice(0, 80),
            folder,
          });
        }
      } catch {
        return blocked('제가 볼 수 있는 폴더 밖의 범위가 섞여 있어 위임하지 않았어요.', '작업 폴더 안에서 다시 나눌게요.');
      }

      const goal = String(args.goal ?? '').trim();
      if (!goal) return blocked('나눠 맡길 목표가 비어 있어 실행하지 않았어요.', '완성할 결과를 한 문장으로 알려 주세요.');
      if (containsSensitiveValue(goal)
        || normalized.some((entry) => containsSensitiveValue(entry.label))) {
        return blocked(
          '민감한 값이 섞인 요청은 에이전트 실행 기록으로 남기지 않았어요.',
          '민감한 값을 빼고 조사 목표와 폴더만 알려 주세요.',
        );
      }
      const count = normalized.length;
      const delegated = await runtime().delegateUserRequest({
        requestId: `turn-${randomUUID()}`,
        text: goal,
        partitions: normalized,
        authorityEnvelope: {
          ceiling: 'A1',
          allowedKinds: ['read', 'summarize'],
          allowedTools: ['local.file'],
          allowedTargets: [],
          workspaceRoots: normalized.map((entry) => entry.folder),
          expiresAt: null,
          maxRuns: count,
          maxCost: count,
          requiresFreshApprovalFor: [],
        },
        budgets: {
          maxToolCalls: count * 4,
          timeoutMs: 180_000,
          maxCost: count,
          maxConcurrency: count,
        },
      });
      const integrated = await runtime().executeDelegation(delegated);
      const results = integrated.results.map((run, index) => ({
        label: normalized[index]?.label,
        status: run.status,
        reply: run.result?.reply ?? run.result?.answer ?? run.result ?? null,
        receipts: (run.receipts ?? []).length,
      }));
      return {
        result: { completed: integrated.status === 'succeeded', results },
        userSafeSummary: integrated.status === 'succeeded'
          ? `${count}개 갈래의 조사를 끝내고 결과를 모았어요.`
          : '갈래별 결과를 모았지만 끝나지 않은 작업이 있어 성공으로 보고하지 않았어요.',
      };
    },
  };
}
