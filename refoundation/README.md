# T5 Refoundation Workspace

이 디렉터리는 새 T5 코어의 독립 개발 레인이다.

## 경계

- 기존 `../src`, `../test`, `../scripts`의 제품 코드를 import하지 않는다.
- 현재 Gate가 열지 않은 memory, channels, automation, multi-agent와 S1 범위를 넘는 skills를 만들지 않는다.
- 실제 사용자 HOME·계정·자격증명을 테스트에 사용하지 않는다.
- 상태와 산출물은 임시 격리 경로 또는 `T5_REFOUNDATION_*`가 가리키는 저장소 밖 경로에 둔다.

## 명령

```bash
npm run refoundation:doctor
npm run refoundation:boundary
npm run refoundation:test
npm run refoundation:check
npm run refoundation:integration
npm run refoundation:ci
npm run refoundation:isolated -- node refoundation/scripts/show-isolation.mjs
npm run refoundation:live
npm run refoundation:connections
npm run refoundation:connect:oauth
npm run refoundation:qualify:project
npm run refoundation:qualify:terminal
npm run refoundation:console
```

`refoundation:check`가 일상 진입점이다. legacy 전체 테스트와 gate는 새 코어의 일상 완료 기준이 아니다.
legacy 기준선은 단계 비교 또는 legacy 변경 작업에서 별도로 실행한다.

`refoundation:integration`은 루프백 서버를 여는 관통 검사다. 로컬 포트를 제한하는 샌드박스에서는
해당 권한이 필요하다. CI와 단계 Gate는 `refoundation:ci`로 일상 검사와 통합검사를 함께 실행한다.

`refoundation:live`는 기존 T5 콘솔에서 선택한 활성 모델 연결을 기본으로 사용한다. API 키는 콘솔의
보호 입력칸에 붙여넣고, OAuth는 콘솔의 ChatGPT 로그인 버튼으로 연결한다. 사용자가 터미널에 키를 입력할
필요가 없다. 실제 사용자 자료는 읽지 않고 임시 fixture만 사용하며, `-- --keep`을 붙인 경우에만 실행
방과 가린 prompt dump를 남긴다. 모든 자격은 모델 요청 헤더에만 사용되고 exec 자식에는 전달되지 않는다.

OAuth 연결은 `refoundation:connect:oauth`를 실행하면 브라우저가 자동으로 열린다. 사용자는 로그인과
승인만 누르면 되고 터미널 입력은 하지 않는다. 이 경로는 공개 OpenAI API OAuth 계약이 아니라 기존
Codex 계정 backend를 사용하는 비공식 호환 경로다.

## 디렉터리

```text
refoundation/
  src/       새 코어만
  test/      새 코어 불변식·과업 시험
  scripts/   격리·경계·진단
  skills/    S1이 연 신뢰된 bundled 절차 지식; 실행기는 아님
  evidence/  작은 기계 증거만; 실행 부산물은 저장소 밖
```
