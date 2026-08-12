#!/usr/bin/env python3
"""제품 세션의 닫힌 수명주기. 홈당 살아있는 프로세스는 **항상 정확히 1개**다.

지난 두 판이 같은 결함으로 무효가 됐다: 세션을 분기 끝에서야 닫아 같은 홈에 s1·s2 가 동시에
살아 있었다. 눈으로 지키는 규칙은 또 깨진다. 그래서 규칙을 자료구조에 넣는다 —
``SessionHost`` 는 한 홈에 두 번째 세션을 **열 수 없다**(예외를 던진다).

감사 요구 대응:
  ① 홈별 제품 프로세스 정확히 1개  → SessionHost.open() 이 위반 시 RuntimeError
  ② 기존 세션 종료 확인 뒤 새 세션  → open() 이 이전 세션의 종료 증명을 요구
  ③ 정상 종료 → 강제 종료 → 종료 확인 → close() 가 3단계를 거치고 어느 단계에서 끝났는지 기록
  ④ session ID·resume 검증 실패 시 즉시 중단 → resume() 이 검증 실패 시 예외
  ⑤ 실제 입력 가능 상태 확인 → wait_ready() 가 입력 프롬프트 표식을 본 뒤에만 성공
  ⑥ 무과금 전실행 증명 → 이 파일만으로 프로세스 수·홈·세션 ID·종료 상태를 찍을 수 있다
"""
from __future__ import annotations

import os
import pty
import re
import select
import signal
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path

USER_HOME = Path(os.environ.get("T5_COMPARE_USER_HOME") or Path.home()).resolve()
HERMES_REPO = Path("/Users/jyp/Developer/lab_un/hermes-agent")
HERMES_BIN = HERMES_REPO / ".venv/bin/hermes"
VISIBLE_DIRS = ("Downloads", "Developer")


def prepare_user_view(home: Path) -> dict[str, dict[str, str]]:
    """격리 HOME 안에서 사용자 파일 폴더 두 개만 실제 대상으로 연결한다."""
    home.mkdir(parents=True, exist_ok=True)
    links: dict[str, dict[str, str]] = {}
    for name in VISIBLE_DIRS:
        target = (USER_HOME / name).resolve(strict=True)
        link = home / name
        if os.path.lexists(link):
            if not link.is_symlink() or link.resolve() != target:
                raise RuntimeError(f"격리 홈의 사용자 시야 경로가 다른 대상을 가리킨다: {link}")
        else:
            link.symlink_to(target, target_is_directory=True)
        links[name] = {"link": str(link), "target": str(target)}
    return links

_ANSI = re.compile(rb"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]|\x1b\[[0-?]*[ -/]*[@-~]")
# 입력 가능 표식: TUI 의 입력 프롬프트. 이게 보이기 전에는 프롬프트를 넣지 않는다.
_READY = re.compile(r"❯|Type your message")
_TURN_WORKING = "msg=interrupt"
_TURN_IDLE = re.compile(r"(?:^|\n)❯(?:\n|$)")
_SESSION_ID = re.compile(r"Session:\s*(\S+)|--resume\s+(\S+)")
# 재개 실패 마커(실측 2026-07-30): 없는 ID 로 --resume 하면 제품이 이 줄을 찍고 **조용히 새
# 대화를 시작한다.** 배너는 요청한 ID 를 그대로 에코하므로 "ID 가 화면에 있는가"는 판별력이
# 없다. 판별자는 이 마커의 부재다. 프롬프트 0건 세션은 저장되지 않아 재개가 항상 실패한다.
_RESUME_FAILED = re.compile(r"Session not found")
# 세션 ID 의 디스크 진실: <home>/sessions/request_dump_<sid>_<ts>.json
_DUMP_NAME = re.compile(r"^request_dump_(\d{8}_\d{6}_[0-9a-f]+)_\d{8}_\d{6}_\d+\.json$")


_SID_TOKEN = re.compile(r"\b(\d{8}_\d{6}_[0-9a-f]+)\b")


def disk_session_ids(home: Path) -> list[str]:
    """디스크가 기억하는 세션 ID(최근 활동순). 진실 원천은 제품 CLI(state.db)다.

    실측(2026-07-30 유료 회차 1): 실제 키 성공 경로의 세션은 `state.db`에만 남고
    `sessions/` 요청 덤프는 **오류 경로(가짜 키 401)에서만** 생긴다. 덤프 파일명 스캔은
    무과금 관측 체계에서만 유효했고 유료 경로에서 빈 목록을 돌려줘 B8이 두 번 중단됐다.
    `hermes sessions list`는 두 체계 모두에서 세션을 보여준다. 덤프 스캔은 fallback."""
    out: list[str] = []
    try:
        r = subprocess.run(
            [str(HERMES_BIN), "sessions", "list"],
            capture_output=True, text=True, timeout=30,
            env=sanitized_env(home), cwd=str(home),
        )
        for line in r.stdout.splitlines():
            hits = _SID_TOKEN.findall(line)
            if hits and hits[-1] not in out:
                out.append(hits[-1])
    except (subprocess.SubprocessError, OSError):
        pass
    if out:
        return out
    sess = home / "sessions"
    if not sess.is_dir():
        return []
    found: list[tuple[float, str]] = []
    for p in sess.iterdir():
        m = _DUMP_NAME.match(p.name)
        if m:
            try:
                found.append((p.stat().st_mtime, m.group(1)))
            except OSError:
                continue
    for _, sid in sorted(found, reverse=True):
        if sid not in out:
            out.append(sid)
    return out


def sanitized_env(home: Path) -> dict[str, str]:
    """제품 자식 프로세스의 환경을 명시적으로 만들되 사용자 파일 시야는 보존한다.

    이유(실측 2026-07-30): 오너의 실제 `~/.hermes` 자격 풀에 openai-api 키가 있다.
    HOME·HERMES_HOME은 함께 격리한다. Downloads·Developer만 prepare_user_view()가 실제 사용자
    폴더로 연결한다. 따라서 제품 자격은 보지 못하지만 사용자 작업 현실은 본다."""
    return {
        "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
        "HOME": str(home),
        "HERMES_HOME": str(home),
        "TERM": "xterm-256color",
        "LANG": "en_US.UTF-8",
        "LC_ALL": "en_US.UTF-8",
    }

READY_TIMEOUT_S = 90.0
EXIT_GRACE_S = 15.0
TERM_GRACE_S = 5.0


def strip_ansi(raw: bytes) -> str:
    text = _ANSI.sub(b"", raw).decode("utf-8", "replace").replace("\r", "\n")
    return "\n".join(ln.rstrip() for ln in text.split("\n") if ln.strip())


def count_product_processes(home: Path) -> int:
    """이 홈을 쓰는 제품 프로세스 수를 OS 에게 직접 묻는다. 내 장부를 믿지 않는다."""
    try:
        out = subprocess.run(
            ["ps", "-eo", "pid=,command="], capture_output=True, text=True, timeout=20,
        ).stdout
    except (subprocess.SubprocessError, OSError):
        return -1
    n = 0
    for line in out.splitlines():
        if "hermes" not in line or "--cli" not in line:
            continue
        pid = line.strip().split(None, 1)[0]
        try:
            env = subprocess.run(
                ["ps", "-p", pid, "-wwE", "-o", "command="],
                capture_output=True, text=True, timeout=10,
            ).stdout
        except (subprocess.SubprocessError, OSError):
            env = ""
        if f"HERMES_HOME={home}" in env:
            n += 1
    return n


@dataclass
class CloseReport:
    stage: str            # graceful | sigterm | sigkill | already_dead
    verified_dead: bool
    session_id: str | None
    waited_s: float
    tail: str = field(repr=False, default="")


class Session:
    """PTY 하나 = 제품 프로세스 하나 = 대화 하나."""

    def __init__(self, home: Path, model: str, secret: Path | None,
                 resume: str | None = None) -> None:
        self.home = home
        self.resume_of = resume
        prepare_user_view(home)
        base = f"'{HERMES_BIN}' --cli -m {model} --provider openai-api"
        if resume:
            base += f" --resume {resume} --no-restore-cwd"
        inner = ("set -a; "
                 + (f". '{secret}'; " if secret and secret.exists() else "")
                 + f"export HERMES_HOME='{home}'; exec {base}")
        self.master, slave = pty.openpty()
        os.set_blocking(self.master, False)
        self.proc = subprocess.Popen(
            ["bash", "-c", inner], cwd=str(home),
            stdin=slave, stdout=slave, stderr=slave, start_new_session=True,
            env=sanitized_env(home),
        )
        os.close(slave)
        self.buf = bytearray()
        self.session_id: str | None = resume
        self.ready = False

    # ── 읽기 ────────────────────────────────────────────────────────────────
    def drain(self) -> int:
        got = 0
        while True:
            r, _, _ = select.select([self.master], [], [], 0)
            if not r:
                return got
            try:
                chunk = os.read(self.master, 65536)
            except (BlockingIOError, OSError):
                return got
            if not chunk:
                return got
            self.buf.extend(chunk)
            got += len(chunk)

    def text(self, since: int = 0) -> str:
        return strip_ansi(bytes(self.buf[since:]))

    # ── ⑤ 실제 입력 가능 상태 ────────────────────────────────────────────────
    def wait_ready(self) -> bool:
        t0 = time.monotonic()
        while time.monotonic() - t0 < READY_TIMEOUT_S:
            self.drain()
            if self.proc.poll() is not None:
                return False
            if _READY.search(self.text()):
                # 표식이 보인 뒤 화면이 안정될 때까지 조금 더.
                time.sleep(1.0)
                self.drain()
                self.ready = True
                return True
            time.sleep(0.2)
        return False

    def write(self, line: str) -> None:
        if not self.ready:
            raise RuntimeError("입력 가능 상태가 아니다 — wait_ready() 를 먼저 통과해야 한다")
        self.ready = False
        os.write(self.master, (line + "\n").encode())

    def turn_completion_observed(self, since: int) -> bool:
        """작업 프롬프트를 거쳐 정상 입력 프롬프트로 돌아온 사실을 확인한다.

        무출력 시간은 완료 신호가 아니다. 다만 prompt_toolkit은 화면을 여러 번 다시 그리므로,
        호출자는 이 전이 뒤 출력 안정 시간도 함께 확인해야 한다.
        """
        text = self.text(since)
        working_at = text.rfind(_TURN_WORKING)
        if working_at < 0:
            return False
        idle = list(_TURN_IDLE.finditer(text))
        return bool(idle and idle[-1].start() > working_at)

    # ── ③ 정상 종료 → 강제 종료 → 종료 확인 ─────────────────────────────────
    def close(self) -> CloseReport:
        mark = len(self.buf)
        t0 = time.monotonic()

        if self.proc.poll() is not None:
            self.drain()
            return CloseReport("already_dead", True, self._read_id(mark), 0.0, self.text(mark))

        stage = "graceful"
        try:
            os.write(self.master, b"/exit\n")
        except OSError:
            pass
        while time.monotonic() - t0 < EXIT_GRACE_S:
            self.drain()
            if self.proc.poll() is not None:
                break
            time.sleep(0.2)

        if self.proc.poll() is None:
            stage = "sigterm"
            try:
                os.killpg(os.getpgid(self.proc.pid), signal.SIGTERM)
            except (ProcessLookupError, PermissionError):
                pass
            t1 = time.monotonic()
            while time.monotonic() - t1 < TERM_GRACE_S:
                self.drain()
                if self.proc.poll() is not None:
                    break
                time.sleep(0.2)

        if self.proc.poll() is None:
            stage = "sigkill"
            try:
                os.killpg(os.getpgid(self.proc.pid), signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pass

        self.drain()
        sid = self._read_id(mark)
        try:
            os.close(self.master)
        except OSError:
            pass
        dead = self.proc.poll() is not None
        return CloseReport(stage, dead, sid, round(time.monotonic() - t0, 2), self.text(mark))

    def _read_id(self, mark: int) -> str | None:
        m = _SESSION_ID.search(self.text(mark)) or _SESSION_ID.search(self.text())
        if not m:
            return self.session_id
        return m.group(1) or m.group(2) or self.session_id


class SessionHost:
    """홈 하나를 지키는 문. 살아있는 세션은 최대 하나다 — 규칙이 아니라 구조다."""

    def __init__(self, home: Path, model: str, secret: Path | None) -> None:
        self.home = home
        self.model = model
        self.secret = secret
        self.live: Session | None = None
        self.history: list[dict] = []

    def open(self, label: str, resume: str | None = None) -> Session:
        # ② 이전 세션이 살아 있으면 새로 열지 않는다.
        if self.live is not None and self.live.proc.poll() is None:
            raise RuntimeError(
                f"{self.home.name}: 이전 세션이 아직 살아 있다 — 먼저 close() 로 종료를 증명하라")
        # ① OS 에게 직접 물어 홈당 프로세스가 0 인지 확인한다.
        #    계측 실패(-1)는 안전한 0 이 아니다 — 잴 수 없으면 열지 않는다(fail-closed).
        n = count_product_processes(self.home)
        if n != 0:
            reason = "프로세스 계측 불능(ps 실패)" if n < 0 else f"제품 프로세스가 {n}개 살아 있다"
            raise RuntimeError(f"{self.home.name}: {reason}")

        # ④-a 재개 대상은 디스크에 실존해야 한다. 프롬프트 0건 세션은 저장되지 않고,
        #     배너는 요청 ID 를 그대로 에코하므로 화면이 아니라 디스크를 먼저 본다.
        if resume and resume not in disk_session_ids(self.home):
            raise RuntimeError(
                f"{self.home.name}/{label}: --resume {resume} — 디스크에 그 세션이 없다")

        s = Session(self.home, self.model, self.secret, resume=resume)
        if not s.wait_ready():
            rep = s.close()
            raise RuntimeError(
                f"{self.home.name}/{label}: 입력 가능 상태에 도달하지 못했다 "
                f"(종료단계={rep.stage}, 확인={rep.verified_dead})")
        # ④-b 제품이 재개 실패를 알리면 조용한 새 대화를 재개로 인정하지 않는다.
        if resume and _RESUME_FAILED.search(s.text()):
            rep = s.close()
            raise RuntimeError(
                f"{self.home.name}/{label}: --resume {resume} — 제품이 세션을 찾지 못했다"
                f"(Session not found)")
        self.live = s
        self.history.append({"label": label, "resumeOf": resume, "opened": True,
                             "processes": count_product_processes(self.home)})
        return s

    def close(self, label: str) -> CloseReport:
        if self.live is None:
            return CloseReport("already_dead", True, None, 0.0)
        rep = self.live.close()
        after = count_product_processes(self.home)
        self.history.append({
            "label": label, "closeStage": rep.stage, "verifiedDead": rep.verified_dead,
            "sessionId": rep.session_id, "waitedS": rep.waited_s, "processesAfter": after,
        })
        self.live = None
        if not rep.verified_dead or after != 0:
            raise RuntimeError(
                f"{self.home.name}/{label}: 종료를 증명하지 못했다 "
                f"(단계={rep.stage}, 확인={rep.verified_dead}, 남은 프로세스={after})")
        return rep
