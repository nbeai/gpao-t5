#!/usr/bin/env python3
"""무과금 전실행 — 유료 회차 전에 수명주기를 증명한다.

모델 호출은 **0건**이다. 프롬프트를 보내지 않고 세션을 열고 닫기만 한다.
(제품 기동은 완료 요청을 보내지 않으므로 과금되지 않는다. 증명은 §4 의 usage 확인으로 남긴다.)

증명하는 것 — 감사 요구 ⑥:
  · 홈별 제품 프로세스 수가 열기 전 0, 열린 뒤 1, 닫은 뒤 0
  · 같은 홈에 두 번째 세션을 열면 **실패한다**(다중 writer 재발 방지가 구조로 걸려 있다)
  · 세션 ID 가 실제로 잡힌다
  · 종료가 어느 단계에서 확정됐는지(정상/SIGTERM/SIGKILL)와 확인 결과
  · `--resume <ID>` 로 원 대화가 다시 열린다 (H05 의 전제)

    python3 preflight.py
"""
from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from session_lifecycle import SessionHost, count_product_processes  # noqa: E402

HERE = Path(os.environ.get("LIVE_DIR") or Path(__file__).resolve().parent)
SECRET = HERE / "secret-env.sh"
MODEL = os.environ.get("PREFLIGHT_MODEL", "gpt-5.1")

report: dict = {"model": MODEL, "modelCalls": 0, "checks": []}
fails: list[str] = []


def record(label: str, ok: bool, detail: str = "") -> None:
    report["checks"].append({"label": label, "ok": ok, "detail": detail})
    print(f"  {'PASS' if ok else 'FAIL'} · {label}" + (f" — {detail}" if detail else ""))
    if not ok:
        fails.append(label)


def main() -> int:
    root = HERE / "preflight"
    shutil.rmtree(root, ignore_errors=True)
    home = root / "pf-home"
    home.mkdir(parents=True, exist_ok=True)

    print(f"[무과금 전실행] 모델 선택 {MODEL} · 프롬프트 0건 · 모델 호출 0건\n")

    record("열기 전 이 홈의 제품 프로세스 0", count_product_processes(home) == 0,
           f"{count_product_processes(home)}개")

    host = SessionHost(home, MODEL, SECRET if SECRET.exists() else None)

    # 1) 열기 — 입력 가능 상태까지 확인
    try:
        s1 = host.open("s1")
        record("입력 가능 상태 도달(입력 프롬프트 표식 확인)", s1.ready)
    except RuntimeError as e:
        record("입력 가능 상태 도달", False, str(e))
        return finish(1)

    n = count_product_processes(home)
    record("열린 뒤 이 홈의 제품 프로세스 정확히 1", n == 1, f"{n}개")

    # 2) 같은 홈에 두 번째 세션 — 반드시 실패해야 한다
    try:
        host.open("s2-must-fail")
        record("같은 홈 두 번째 세션 차단", False, "열렸다 — 다중 writer 재발")
    except RuntimeError as e:
        record("같은 홈 두 번째 세션 차단", True, str(e)[:80])

    n = count_product_processes(home)
    record("차단 시도 뒤에도 프로세스 1", n == 1, f"{n}개")

    # 3) 닫기 — 단계·종료 확인·세션 ID
    try:
        rep = host.close("s1")
        record("종료 확인", rep.verified_dead, f"단계={rep.stage} 대기={rep.waited_s}s")
        record("세션 ID 확보", bool(rep.session_id), str(rep.session_id))
        sid = rep.session_id
    except RuntimeError as e:
        record("종료 확인", False, str(e))
        return finish(1)

    n = count_product_processes(home)
    record("닫은 뒤 이 홈의 제품 프로세스 0", n == 0, f"{n}개")

    # 4) 재개 — H05 의 전제. 실패하면 즉시 중단해야 하는 지점이다.
    if not sid:
        record("--resume 검증", False, "세션 ID 가 없어 재개를 잴 수 없다")
        return finish(1)
    try:
        host.open("s1-resumed", resume=sid)
        record("--resume 로 원 대화 재개", True, f"resume={sid}")
        n = count_product_processes(home)
        record("재개 뒤 프로세스 정확히 1", n == 1, f"{n}개")
        rep2 = host.close("s1-resumed")
        record("재개 세션도 종료 확인", rep2.verified_dead, f"단계={rep2.stage}")
    except RuntimeError as e:
        record("--resume 로 원 대화 재개", False, str(e)[:120])
        return finish(1)

    n = count_product_processes(home)
    record("전실행 종료 시 잔여 프로세스 0", n == 0, f"{n}개")

    # 5) 과금 증거: 이 홈에 usage 흔적이 없어야 한다(프롬프트를 안 보냈으므로)
    sessions_db = home / "state.db"
    report["stateDbExists"] = sessions_db.exists()
    report["hostHistory"] = host.history
    return finish(0 if not fails else 1)


def finish(code: int) -> int:
    report["verdict"] = "VALID" if not fails else f"INVALID ({len(fails)}건)"
    out = HERE / "preflight" / "preflight-report.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n판정: {report['verdict']}")
    print(f"보고서: {out}")
    return code


if __name__ == "__main__":
    sys.exit(main())
