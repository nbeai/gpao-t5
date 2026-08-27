import { execFile } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_HELPER = resolve(dirname(fileURLToPath(import.meta.url)), '../../../runtime/bin/t5-docx-page-renderer');

function validReceipt(value) {
  return value?.schema === 't5.local-image-ocr.v1' && Number.isInteger(value.width) && value.width > 0
    && Number.isInteger(value.height) && value.height > 0 && Array.isArray(value.observations)
    && value.observations.length <= 200 && value.observations.every((item) => typeof item?.text === 'string'
      && item.text.length <= 1_000 && Number.isFinite(item.confidence) && item.confidence >= 0 && item.confidence <= 1
      && item.box && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(item.box[key])));
}

export function makeLocalImageOcr({ platform = process.platform, helper = DEFAULT_HELPER, runCommand = execFileAsync } = {}) {
  return async function recognize(path, { timeoutMs = 20_000 } = {}) {
    if (platform !== 'darwin') return { state: 'unavailable', reason: 'local_image_ocr_not_qualified' };
    const exact = await realpath(path); const stat = await lstat(exact);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 20 * 1024 * 1024) {
      return { state: 'unavailable', reason: 'local_image_ocr_input_boundary' };
    }
    try {
      const { stdout } = await runCommand(helper, ['--ocr-image', exact], {
        timeout: timeoutMs, maxBuffer: 512 * 1024,
        env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'ko_KR.UTF-8' },
      });
      const receipt = JSON.parse(String(stdout)); if (!validReceipt(receipt)) throw new Error('OCR receipt is malformed');
      return { state: 'observed', width: receipt.width, height: receipt.height,
        observations: receipt.observations, truncated: receipt.truncated === true,
        text: receipt.observations.map((item) => item.text).join('\n').slice(0, 32_000), engine: 'macos-vision-local' };
    } catch (error) {
      return { state: 'unavailable', reason: error?.code === 'ETIMEDOUT' ? 'local_image_ocr_timeout' : 'local_image_ocr_failed' };
    }
  };
}
