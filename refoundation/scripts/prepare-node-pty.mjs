#!/usr/bin/env node
import { chmod, stat } from 'node:fs/promises';
import { arch } from 'node:os';
import { resolve } from 'node:path';

if (process.platform === 'darwin') {
  const candidates = [
    resolve('node_modules', 'node-pty', 'prebuilds', `darwin-${arch()}`, 'spawn-helper'),
    resolve('node_modules', 'node-pty', 'build', 'Release', 'spawn-helper'),
  ];
  for (const path of candidates) {
    try {
      const info = await stat(path);
      await chmod(path, info.mode | 0o100);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}
