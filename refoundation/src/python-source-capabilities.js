import { spawnSync } from 'node:child_process';

const PROBE = String.raw`
import ast, json, sys
source = sys.stdin.read()
try:
    tree = ast.parse(source)
except SyntaxError:
    print(json.dumps({"state":"syntax_error","childProcessRequired":False,"networkRequired":False}))
    raise SystemExit(0)

imports = set()
calls = set()
for node in ast.walk(tree):
    if isinstance(node, ast.Import):
        imports.update(alias.name.split('.')[0] for alias in node.names)
    elif isinstance(node, ast.ImportFrom) and node.module:
        imports.add(node.module.split('.')[0])
    elif isinstance(node, ast.Call):
        parts = []
        value = node.func
        while isinstance(value, ast.Attribute):
            parts.append(value.attr)
            value = value.value
        if isinstance(value, ast.Name):
            parts.append(value.id)
            calls.add('.'.join(reversed(parts)))

child_modules = {"subprocess", "multiprocessing", "ctypes", "pty"}
network_modules = {"socket", "urllib", "http", "ftplib", "smtplib", "requests", "aiohttp"}
child_calls = {"os.system", "os.popen", "os.spawnl", "os.spawnle", "os.spawnlp", "os.spawnlpe",
               "os.spawnv", "os.spawnve", "os.spawnvp", "os.spawnvpe", "os.posix_spawn", "os.posix_spawnp"}
print(json.dumps({
    "state":"observed",
    "childProcessRequired": bool(imports & child_modules) or any(c.startswith("subprocess.") or c in child_calls for c in calls),
    "networkRequired": bool(imports & network_modules),
}, separators=(",", ":")))
`;

export function observePythonSourceCapabilities({ interpreter, source, run = spawnSync } = {}) {
  if (!interpreter?.path || typeof source !== 'string' || !source.trim()) {
    return { state: 'unknown', childProcessRequired: false, networkRequired: false };
  }
  const result = run(interpreter.path, ['-I', '-S', '-c', PROBE], {
    input: source, encoding: 'utf8', timeout: 2_000, maxBuffer: 16 * 1024,
    env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
  });
  if (result.error || result.status !== 0 || result.signal || String(result.stderr ?? '').trim()) {
    return { state: 'unknown', childProcessRequired: false, networkRequired: false };
  }
  try {
    const value = JSON.parse(String(result.stdout ?? ''));
    if (!['observed', 'syntax_error'].includes(value.state)
      || typeof value.childProcessRequired !== 'boolean' || typeof value.networkRequired !== 'boolean') {
      throw new Error('invalid capability observation');
    }
    return value;
  } catch {
    return { state: 'unknown', childProcessRequired: false, networkRequired: false };
  }
}
