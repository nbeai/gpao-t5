#!/usr/bin/env python3
"""실제 Downloads fixture의 생성 신분을 보존하고 그 파일만 정리한다."""
from __future__ import annotations

import hashlib
import os
import shutil
import uuid
from pathlib import Path


def _digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _identity(path: Path) -> tuple[int, int]:
    st = path.lstat()
    if path.is_symlink():
        raise RuntimeError(f"심볼릭 링크는 fixture가 아니다: {path}")
    return st.st_dev, st.st_ino


def create_owned(downloads: Path, files: dict[str, str], anchor_dir: Path) -> list[dict]:
    anchor_dir.mkdir(parents=True, exist_ok=True)
    made: list[dict] = []
    try:
        for name, body in files.items():
            path = downloads / name
            with path.open("x", encoding="utf-8") as f:
                f.write(body)
                f.flush()
                os.fsync(f.fileno())
            dev, ino = _identity(path)
            anchor = anchor_dir / f"{uuid.uuid4().hex}-{name}"
            os.link(path, anchor)
            made.append({
                "path": str(path),
                "anchor": str(anchor),
                "device": dev,
                "inode": ino,
                "sha256": _digest(path),
            })
    except OSError:
        cleanup_owned(made, anchor_dir / "rollback-snapshots")
        raise
    return made


def _same_owned(record: dict, path: Path) -> bool:
    anchor = Path(record["anchor"])
    if not path.exists() or not anchor.exists() or path.is_symlink():
        return False
    try:
        pst = path.stat()
        ast = anchor.stat()
        return (
            pst.st_dev == ast.st_dev == record["device"]
            and pst.st_ino == ast.st_ino == record["inode"]
            and _digest(path) == record["sha256"]
        )
    except OSError:
        return False


def _same_identity(record: dict, path: Path) -> bool:
    anchor = Path(record["anchor"])
    if not path.exists() or not anchor.exists() or path.is_symlink():
        return False
    try:
        pst = path.stat()
        ast = anchor.stat()
        return (
            pst.st_dev == ast.st_dev == record["device"]
            and pst.st_ino == ast.st_ino == record["inode"]
        )
    except OSError:
        return False


def chmod_owned(record: dict, mode: int) -> bool:
    path = Path(record["path"])
    anchor = Path(record["anchor"])
    try:
        ast = anchor.stat()
        if (ast.st_dev, ast.st_ino) != (record["device"], record["inode"]):
            return False
        # 예측 불가능한 anchor가 가리키는 생성 inode만 바꾼다. 원래 경로가 교체돼도
        # 사용자 파일에는 권한 변경이 닿지 않는다.
        anchor.chmod(mode)
        if not _same_identity(record, path):
            return False
        # mode 000은 내용 재검사가 불가능하다. 해제 뒤에는 내용도 다시 확인한다.
        if mode & 0o444 and not _same_owned(record, path):
            return False
        return True
    except OSError:
        return False


def cleanup_owned(
    records: list[dict], snapshot_dir: Path,
) -> tuple[list[str], list[dict], list[dict]]:
    """경로를 격리 이름으로 원자 이동한 뒤 anchor와 같은 파일일 때만 삭제한다."""
    removed: list[str] = []
    preserved: list[dict] = []
    outcomes: list[dict] = []
    if not records:
        return removed, preserved, outcomes
    for record in records:
        path = Path(record["path"])
        anchor = Path(record["anchor"])
        if not path.exists():
            anchor.unlink(missing_ok=True)
            item = {"path": str(path), "reason": "missing_by_product"}
            preserved.append(item)
            outcomes.append({**item, "disposition": "observed"})
            continue

        # 이미 다른 inode면 손대지 않는다. 경로는 소유권이 아니다.
        if not _same_identity(record, path):
            anchor.unlink(missing_ok=True)
            item = {"path": str(path), "reason": "identity_replaced_untouched"}
            preserved.append(item)
            outcomes.append({**item, "disposition": "observed"})
            continue

        quarantine = path.with_name(f".{path.name}.gpao-fixture-{uuid.uuid4().hex}")
        try:
            path.rename(quarantine)
        except OSError as exc:
            preserved.append({"path": str(path), "reason": f"quarantine_failed:{exc}"})
            continue

        if _same_identity(record, quarantine):
            snapshot_dir.mkdir(parents=True, exist_ok=True)
            changed = _digest(quarantine) != record["sha256"]
            shutil.copy2(quarantine, snapshot_dir / path.name)
            quarantine.unlink()
            anchor.unlink(missing_ok=True)
            removed.append(str(path))
            outcomes.append({
                "path": str(path),
                "reason": "content_modified_by_product" if changed else "fixture_unchanged",
                "disposition": "snapshotted_and_removed",
            })
            continue

        # 검사와 rename 사이에 교체됐다. 삭제하지 않고 원래 자리로 되돌린다.
        try:
            if not path.exists():
                quarantine.rename(path)
                item = {"path": str(path), "reason": "identity_changed_restored"}
                preserved.append(item)
                outcomes.append({**item, "disposition": "observed"})
            else:
                snapshot_dir.mkdir(parents=True, exist_ok=True)
                evidence_path = snapshot_dir / f"race-{uuid.uuid4().hex}-{path.name}"
                quarantine.rename(evidence_path)
                item = {
                    "path": str(quarantine),
                    "evidencePath": str(evidence_path),
                    "reason": "identity_changed_original_path_occupied",
                }
                preserved.append(item)
                outcomes.append({**item, "disposition": "preserved_in_evidence"})
        except OSError as exc:
            item = {"path": str(quarantine), "reason": f"restore_failed:{exc}"}
            preserved.append(item)
            outcomes.append({**item, "disposition": "unsafe_cleanup_failure"})
        anchor.unlink(missing_ok=True)
    return removed, preserved, outcomes
