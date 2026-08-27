import { makeCapabilityUseReceipt } from './capability-use-receipt.js';

function platformLabel(platform) {
  if (platform === 'darwin') return 'Finder';
  if (platform === 'win32') return 'File Explorer';
  return '파일 관리자';
}

export function makeNativeComputerInspector({ platform = process.platform, revealAvailable = true } = {}) {
  const label = platformLabel(platform);
  return {
    id: 'native-file-manager', label, category: 'os_native',
    async inspect() {
      return {
        state: revealAvailable ? 'ready' : 'unavailable',
        reason: revealAvailable ? 'native_file_manager_ready' : 'native_file_manager_unavailable',
        userSafeSummary: revealAvailable
          ? `결과 파일과 폴더를 ${label}에서 바로 보여줄 수 있어요.`
          : '이 컴퓨터의 파일 관리자를 지금 사용할 수 없어요.',
        capabilities: { reveal: revealAvailable }, routes: [],
        identity: {
          ownerApplication: label, transport: 'os_native_direct_argv',
          permissions: revealAvailable ? ['reveal'] : [], resources: [], observed: revealAvailable,
        },
      };
    },
  };
}

export function makeNativeComputerTool({ revealPath, platform = process.platform } = {}) {
  if (typeof revealPath !== 'function') return null;
  const label = platformLabel(platform);
  return {
    name: 'native_computer',
    description: `Show one exact existing local file or folder in ${label}. Use only when the user asks to open, show, locate, or reveal a local result. This is a fixed OS action, not a shell command, and it does not read file content.`,
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['reveal'] },
        path: { type: 'string', minLength: 1, maxLength: 4096 },
      },
      required: ['action', 'path'],
    },
    async execute({ action, path }) {
      if (action !== 'reveal') throw new TypeError('native computer action is invalid');
      const result = await revealPath(path);
      const receipt = makeCapabilityUseReceipt({
        kind: 'os_native', capabilityId: 'native-file-manager', action: 'reveal',
        credential: { owner: 'none', storage: 'not_applicable' },
        authority: { state: 'observed', permissions: ['reveal'] },
        execution: { state: 'succeeded', adapter: `os-file-manager:${platform}` },
        effect: { state: 'observed', kind: 'observe' },
      });
      return {
        state: 'revealed', targetType: result.targetType,
        capabilitiesUsed: [{ kind: 'os_native', id: 'native-file-manager', action: 'reveal' }],
        capabilityReceipts: [receipt],
        userSafeSummary: `${label}에서 위치를 보여줬어요.`,
      };
    },
  };
}
