#!/bin/bash
# 오너 전용 자격 입력 — 키 한 번 붙여넣기로 끝난다.
#
# 하는 일: 숨김 입력으로 키를 받아 secret-env.sh(600)를 만들고,
#   1) 이 파일이 git 에 절대 올라갈 수 없는지(무시 목록) 먼저 확인하고
#   2) 무과금 GET /v1/models 로 키가 실제로 작동하는지, gpt-5.1 이 보이는지 확인한다.
# 401 이면 파일을 지우고 알린다. 키는 화면·기록·git 어디에도 남지 않는다.
set -euo pipefail
cd "$(dirname "$0")"

if ! git check-ignore -q secret-env.sh; then
  echo "중단: secret-env.sh 가 git 무시 목록에 없습니다. 커밋될 위험이 있어 진행하지 않습니다."
  exit 1
fi

if [[ -f secret-env.sh ]]; then
  echo "이미 secret-env.sh 가 있습니다. 새 키로 바꾸려면 Enter, 중단하려면 Ctrl+C."
  read -r
fi

read -rsp "OpenAI API 키를 붙여넣고 Enter (화면에 표시되지 않습니다): " KEY
echo
if [[ -z "$KEY" ]]; then echo "빈 입력 — 중단합니다."; exit 1; fi
if [[ "$KEY" != sk-* ]]; then echo "sk- 로 시작하지 않습니다 — OpenAI 키가 맞는지 확인하세요. 중단합니다."; exit 1; fi

umask 077
printf 'export OPENAI_API_KEY=%s\n' "$KEY" > secret-env.sh
chmod 600 secret-env.sh

echo "키 저장 완료. 무과금 검증(모델 목록 조회) 중..."
set +e
OPENAI_API_KEY="$KEY" python3 - <<'PY'
import json, os, sys, urllib.error, urllib.request

req = urllib.request.Request(
    "https://api.openai.com/v1/models",
    headers={"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"},
)
try:
    with urllib.request.urlopen(req, timeout=20) as r:
        ids = {m["id"] for m in json.load(r)["data"]}
except urllib.error.HTTPError as e:
    print(f"검증 실패: HTTP {e.code} — 키가 거부됐습니다.")
    sys.exit(2)
except Exception as e:  # 네트워크 등
    print(f"검증 보류: 네트워크 오류({e}). 키 파일은 남겨둡니다 — 다시 실행해 재검증하세요.")
    sys.exit(3)

print("키 유효: 모델 목록 조회 성공 (과금 0)")
for want in ("gpt-5.1", "gpt-5.3-chat-latest"):
    print(f"  {want}: {'사용 가능' if want in ids else '목록에 없음 — 회차 모델 재확인 필요'}")
sys.exit(0)
PY
RC=$?
set -e

if [[ $RC -eq 2 ]]; then
  rm -f secret-env.sh
  echo "잘못된 키였습니다. secret-env.sh 를 삭제했습니다. 다시 실행해 주세요."
  exit 1
fi

echo
echo "완료. 다음 단계는 유료 회차 1 실행입니다 — 이 창에 '키 넣었다'라고만 알려주시면 됩니다."
