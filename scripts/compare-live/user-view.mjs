import {
  lstatSync, mkdirSync, realpathSync, readlinkSync, symlinkSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

const VISIBLE_DIRS = ['Downloads', 'Developer'];

export const prepareUserView = (isolatedHome, userHome) => {
  mkdirSync(isolatedHome, { recursive: true });
  const links = {};
  for (const name of VISIBLE_DIRS) {
    const target = realpathSync(join(userHome, name));
    const link = join(isolatedHome, name);
    let existing = null;
    try {
      existing = lstatSync(link);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (existing) {
      if (!existing.isSymbolicLink()
          || resolve(isolatedHome, readlinkSync(link)) !== target) {
        throw new Error(`격리 홈의 사용자 시야 경로가 다른 대상을 가리킨다: ${link}`);
      }
    } else {
      symlinkSync(target, link, 'dir');
    }
    links[name] = { link, target };
  }
  return links;
};
