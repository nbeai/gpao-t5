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

_ANSI = re.compile(rb"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]|\x1b\[[0-?]*[ -/]*[@-~]")
# 입력 가능 표식: TUI 의 입력 프롬프트. 이게 보이기 전에는 프롬프트를 넣지 않는다.
_READY = re.compile(r"❯|Type your message")
_SESSION_ID = re.compile(r"Session:\s*(\S+)|--resume\s+(\S+)")
# 재개 실패 마커(실측 2026-07-30): 없는 ID 로 --resume 하면 제품이 이 줄을 찍고 **조용히 새
# 대화를 시작한다.** 배너는 요청한 ID 를 그대로 에코하므로 "ID 가 화면에 있는가"는 판별력이
# 없다. 판별자는 이 마커의 부재다. 프롬프트 0건 세션은 저장되지 않아 재개가 항상 실패한다.
_RESUME_FAILED = re.compile(r"Session not found")
# 세션 ID 의 디스크 진실: <home>/sessions/request_dump_<sid>_<ts>.json
_DUMP_NAME = re.compile(r"^request_dump_(\d{8}_\d{6}_[0-9a-f]+)_\d{8}_\d{6}_\d+\.json$")


def disk_session_ids(home: Path) -> list[str]:
    """디스크가 기억하는 세션 ID 를 최신순으로 돌려준다. TUI 화면 스크래핑은 2차원 박스
    레이아웃 때문에 옆 칸 텍스트를 잡을 수 있다(실측: `sid=email:`). 디스크가 진실이다."""
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
    out: list[str] = []
    for _, sid in sorted(found, reverse=True):
        if sid not in out:
            out.append(sid)
    return out


def sanitized_env(home: Path) -> dict[str, str]:
    """제품 자식 프로세스의 환경을 명시적으로 만든다 — 상속하지 않는다.

    이유(실측 2026-07-30): 오너의 실제 `~/.hermes` 자격 풀에 openai-api 키가 있다.
    HOME 을 그대로 상속하면 `HERMES_HOME` 배선이 한 번이라도 새는 순간 오너 키로 과금된다.
    "자격 파일이 없으면 과금 없음"은 약속이 아니라 이 함수로 구조가 된다. 자격은 오직
    secret 파일의 명시적 주입으로만 들어간다."""
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
        base = f"./.venv/bin/hermes --cli -m {model} --provider openai-api"
        if resume:
            base += f" --resume {resume} --no-restore-cwd"
        inner = ("set -a; "
                 + (f". '{secret}'; " if secret and secret.exists() else "")
                 + f"export HERMES_HOME='{home}'; exec {base}")
        self.master, slave = pty.openpty()
        os.set_blocking(self.master, False)
        self.proc = subprocess.Popen(
            ["bash", "-c", inner], cwd="/Users/jyp/Developer/lab_un/hermes-agent",
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
        os.write(self.master, (line + "\n").encode())

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
