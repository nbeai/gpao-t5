import os
import runpy
import sys


def inside(path, root):
    try:
        return os.path.commonpath([os.path.realpath(path), root]) == root
    except (OSError, TypeError, ValueError):
        return False


if len(sys.argv) != 3:
    raise SystemExit(64)

scratch = os.path.realpath(sys.argv[1])
source = os.path.realpath(sys.argv[2])
if not inside(source, scratch):
    raise SystemExit(65)

runtime_roots = tuple(dict.fromkeys(
    os.path.realpath(value)
    for value in (sys.prefix, sys.base_prefix, os.path.dirname(os.__file__))
    if value
))
blocked_imports = {'ctypes', 'multiprocessing', 'socket', 'subprocess'}


def readable(path):
    return inside(path, scratch) or any(inside(path, root) for root in runtime_roots)


def audit(event, args):
    if event == 'import' and args and str(args[0]).split('.', 1)[0] in blocked_imports:
        raise PermissionError('module unavailable in the ephemeral program boundary')
    if event == 'open' and args and isinstance(args[0], (str, bytes, os.PathLike)):
        if not readable(os.fsdecode(args[0])):
            raise PermissionError('read outside the ephemeral program boundary')
    if event in {'os.chdir', 'os.listdir', 'os.scandir'} and args and args[0] is not None:
        if not readable(os.fsdecode(args[0])):
            raise PermissionError('directory observation outside the ephemeral program boundary')
    if event in {'os.system', 'os.posix_spawn', 'os.posix_spawnp', 'pty.spawn', 'subprocess.Popen'}:
        raise PermissionError('child process unavailable in the ephemeral program boundary')
    if event.startswith('socket.'):
        raise PermissionError('network unavailable in the ephemeral program boundary')


sys.addaudithook(audit)
os.chdir(scratch)
sys.argv = [source]
try:
    runpy.run_path(source, run_name='__main__')
except SystemExit as error:
    code = error.code if isinstance(error.code, int) else 1
    raise SystemExit(code)
except PermissionError:
    print('T5_PYTHON_CAPSULE_BOUNDARY_DENIED', file=sys.stderr)
    raise SystemExit(77)
except BaseException as error:
    print(f'T5_PYTHON_CAPSULE_PROGRAM_ERROR:{type(error).__name__}', file=sys.stderr)
    raise SystemExit(70)
