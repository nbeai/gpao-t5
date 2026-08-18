# T5 Refoundation Workspace

이 디렉터리는 새 T5 코어의 독립 개발 레인이다.

## 경계

- 기존 `../src`, `../test`, `../scripts`의 제품 코드를 import하지 않는다.
- 현재 Gate가 열지 않은 memory, skills, channels, automation, multi-agent를 만들지 않는다.
- 실제 사용자 HOME·계정·자격증명을 테스트에 사용하지 않는다.
- 상태와 산출물은 임시 격리 경로 또는 `T5_REFOUNDATION_*`가 가리키는 저장소 밖 경로에 둔다.

## 명령

```bash
npm run refoundation:doctor
npm run refoundation:boundary
npm run refoundation:test
npm run refoundation:check
npm run refoundation:isolated -- node refoundation/scripts/show-isolation.mjs
```

`refoundation:check`가 일상 진입점이다. legacy 전체 테스트와 gate는 새 코어의 일상 완료 기준이 아니다.
legacy 기준선은 단계 비교 또는 legacy 변경 작업에서 별도로 실행한다.

## 디렉터리

```text
refoundation/
  src/       새 코어만
  test/      새 코어 불변식·과업 시험
  scripts/   격리·경계·진단
  evidence/  작은 기계 증거만; 실행 부산물은 저장소 밖
```
