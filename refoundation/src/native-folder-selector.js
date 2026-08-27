import { execFile } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const MACOS_SCRIPT = `ObjC.import('AppKit');
const panel = $.NSOpenPanel.openPanel;
panel.setCanChooseDirectories(true);
panel.setCanChooseFiles(false);
panel.setAllowsMultipleSelection(false);
panel.setCanCreateDirectories(false);
panel.setPrompt('선택');
panel.setMessage('파일 활동을 기록할 폴더를 하나 선택하세요. 파일 내용은 기록하지 않습니다.');
const accepted = panel.runModal === $.NSModalResponseOK;
JSON.stringify(accepted ? { selected: true, path: ObjC.unwrap(panel.URL.path) } : { selected: false });`;

export function makeNativeFolderSelector({ platform = process.platform, run = execute } = {}) {
  if (platform !== 'darwin') return null;
  return async function selectFolder() {
    const { stdout } = await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MACOS_SCRIPT], {
      timeout: 5 * 60_000, maxBuffer: 16 * 1024, encoding: 'utf8',
    });
    const result = JSON.parse(String(stdout).trim()); if (result?.selected !== true) return null;
    if (Object.keys(result).length !== 2) throw new Error('selected activity folder is invalid');
    const path = String(result.path).replace(/\/$/u, '');
    if (!isAbsolute(path) || path.length > 4096 || /[\u0000-\u001f\u007f]/u.test(path)) {
      throw new Error('selected activity folder is invalid');
    }
    return path;
  };
}
