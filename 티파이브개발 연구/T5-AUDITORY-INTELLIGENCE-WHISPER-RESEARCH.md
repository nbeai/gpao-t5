# T5 Auditory Intelligence 연구·차기 개발 계획

## Whisper를 T5의 기본 청각기관으로 장착하는 교차 플랫폼 계획

기록일: 2026-08-31
조사 기준 source head: `aa6b3b94167983623103f47486e9db907c9d4774`
상태: `OWNER_REQUESTED_NEXT_PLAN · RESEARCH_COMPLETE · PRODUCT_IMPLEMENTATION_NOT_OPEN`
현재 제품 변경: `0`

## 0. 오너 결정과 한 문장

> T5는 사용자가 파일명·형식·모델·명령을 몰라도 평소 말로 녹음과 영상을 맡기면, 정확한 원본을 찾아 로컬에서
> 듣고, 시간축과 coverage를 검증하며, 전사·자막·회의록·실행 과제를 실제 결과물로 전달한다.

Whisper는 선택형 장식품이나 설정 속 숨은 기능이 아니다. T5가 컴퓨터 안의 현실을 다루는 Android라면 파일과
문서를 보는 눈에 대응하는 기본 청각기관이다. 다만 `항상 마이크를 듣는 기능`, `사용자 파일 자동 수집`, `모든
오디오 자동 색인`을 뜻하지 않는다. 엔진은 제품에 기본 장착하고, 모델 weight는 사용자가 처음 실제로 음성 목적을
맡겼을 때 정확한 source·용량·license를 확인해 한 번 준비한다.

```text
기본 설치
→ T5 Whisper helper 포함
→ model weight 0

첫 실제 음성 목적
→ 현재 컴퓨터·디스크·backend 확인
→ large-v3-turbo exact model 준비
→ 같은 Work 자동 재개

이후
→ 오프라인 전사
→ 재다운로드 0
```

이 문서는 연구실의 비정본 차기 계획이다. 현재 6차 release·Windows 기본 제품선을 확장하지 않으며, 오너가 다음
개발 Gate를 명시적으로 열기 전에는 구현하지 않는다.

---

## 1. 왜 지금 필요한가

### 1.1 현재 제품에 명시된 실제 gap

`T5-SIXTH-COMPLETION.md`의 S6-C는 현재 상태를 다음처럼 봉인했다.

```yaml
S6-C:
  status: COMPLETE_SUPPORTED_TYPES
  STT_CAPABILITY_GAP_NOT_WAIVED: true
```

현재 source는 다음 현실을 이미 안다.

- `WAV`, `MP3`, `MP4`를 Attachment의 audio·video kind로 식별한다.
- audio를 inspect하면 `speech_transcription_not_connected`를 정직하게 반환한다.
- video를 inspect하면 `video_understanding_not_connected`를 반환한다.
- 긴 process·stdout/stderr·취소·Runtime 사고·partial output을 S4-D에서 관리한다.
- exact source·revision·mutation·rollback을 E/F에서 관리한다.
- 검증된 output을 Artifact·Preview·Download·Reveal로 전달한다.
- Capability Reality와 S6-B/C가 source·version·digest·license·준비·원래 Work 재개를 제공한다.

하지만 다음은 아직 없다.

- current product에서 사용할 수 있는 STT executable
- 검증된 Whisper model generation
- 큰 model asset의 준비·update·remove·rollback
- macOS·Windows 공통 audio decode→PCM 계약
- chunk·VAD·timestamp·coverage·partial transcript 정산
- transcript의 Artifact·후속 문서 결속
- 실제 Console에서 자연어 목적 하나로 시작해 결과까지 끝나는 제품 경로

### 1.2 이미 선 사용자 가치 증거

오너가 제공한 0.3.1 실사용 기록에는 다음 성공이 있다.

```text
Mac 전체에서 2시간 2분 녹음 발견
→ 1분 sample STT
→ 낮은 품질의 tiny 후보 폐기
→ MLX Whisper large-v3-turbo로 전환
→ 약 8분 40초에 전체 전사
→ Markdown·회의 요약·결정·실행 과제
→ Notion page 생성·readback
→ 전체 원문 Artifact 전달
```

이는 상품 가치가 실제로 있다는 증거다. 그러나 과거 실제 성공은 현재 설치 제품의 reusable Capability, crash/cancel,
Windows 동등성, exact model lifecycle을 증명하지 않는다. 역사 성공을 현재 제품 완료로 승격하지 않고 동일 목적을
현재 source에서 다시 자격해야 한다.

### 1.3 사용자에게 생기는 직접 가치

- 회의·강의·인터뷰·상담·통화 녹음 전사
- Voice Memo·다운로드 파일·영상의 음성 검색
- SRT·VTT 자막 제작
- 결정·담당자·기한·실행 과제 추출
- 계약서·일정표·과거 회의록과 음성 발언 대사
- Telegram voice note를 같은 canonical Conversation으로 연결
- 외부 STT 사용료와 audio provider 전송 없이 오프라인 처리
- 접근성·음성 업무의 차기 TTS 기관과 결합

Whisper의 model 자체는 경쟁군도 사용할 수 있다. T5의 차별점은 Whisper 호출이 아니라 `파일 발견→source
identity→로컬 실행→coverage→원음 위치→Transcript Artifact→문서·기억·전달·교정`을 한 Work로 닫는 데 있다.

---

## 2. 외부 기술 조사

## 2.1 OpenAI Whisper large-v3-turbo

[공식 model card](https://huggingface.co/openai/whisper-large-v3-turbo)에 따르면:

- multilingual speech recognition·English translation
- 99개 언어
- 약 0.8B parameters
- 공식 `model.safetensors` 약 1.62GB
- MIT license
- large-v3의 decoder layer를 32에서 4로 줄여 속도를 높이고 품질 손실은 작게 만든 계열

T5 첫 품질 기준 모델은 `large-v3-turbo`다. 일반 사용자용이라는 이유로 Hermes의 기본 `base` 수준으로 능력을
낮추지 않는다. 더 작은 model은 현재 hardware에서 large-v3-turbo의 사용자 체감이 실제로 실패하고, 같은 한국어
목적에서 정확성 무회귀가 증명된 경우에만 fallback 후보가 된다.

## 2.2 whisper.cpp

[whisper.cpp 공식 source](https://github.com/ggml-org/whisper.cpp)는 OpenAI Whisper를 C/C++로 실행하며 다음을
지원한다.

- macOS Apple Silicon Metal·Core ML
- Windows x64·ARM64 build
- NVIDIA CUDA
- AMD·Intel을 포함하는 Vulkan
- CPU fallback
- integer quantization
- segment·word timestamp
- SRT·VTT·JSON·text output
- progress callback
- Silero VAD
- MIT license

공식 표의 일반 large model은 약 2.9GiB disk·약 3.9GB memory이며 quantization은 disk와 memory를 줄일 수 있다.
turbo weight와 실제 T5 build는 별도 측정한다. quantized model을 기본으로 고정하지 않고 full/quantized를 같은 한국어
fixture에서 accuracy·wall·memory로 A/B한다.

`whisper.cpp`가 첫 제품 후보인 이유:

```text
Python runtime 불필요
macOS·Windows 공통 native contract
작은 helper
CPU·Metal·CUDA·Vulkan
model file을 T5가 exact digest로 소유 가능
별도 process·progress·cancel 연결 용이
```

알려진 경계도 숨기지 않는다.

- VAD 앞부분에 음악이 있으면 token timestamp가 틀어질 수 있다는 보고가 있다.
- 무음 input과 VAD 조합에서 server crash·stale result 문제가 과거 재현됐다.
- OpenClaw도 bounded queue와 lifecycle이 없는 upstream resident server를 안전하게 관리하지 못해 process-per-request를
  사용한다.

따라서 upstream `whisper-server`를 그대로 제품 daemon으로 켜지 않는다. exact commit으로 build한 T5-owned helper를
별도 process로 실행하고, silent/music/VAD 반례를 선시험한다.

## 2.3 MLX Whisper

[Apple MLX Whisper](https://github.com/ml-explore/mlx-examples/blob/main/whisper/README.md)는 Apple Silicon에서
빠르고 model conversion·4-bit quantization·word timestamp를 지원한다. 과거 오너 실사용 속도도 강했다.

그러나:

- Apple Silicon 전용
- Python package와 MLX runtime 필요
- 긴 input·word timestamp에서 memory growth 보고
- 1GB 이상 media 처리의 OOM 보고
- Windows와 공통 helper가 아님

이 있으므로 첫 공통 product engine으로 확정하지 않는다. macOS qualification comparison으로만 유지한다.
`whisper.cpp`보다 같은 정확성에서 wall·memory가 크게 우수하고 D-owned lifecycle로 감쌀 수 있을 때 macOS adapter
후보가 될 수 있다.

## 2.4 faster-whisper

[faster-whisper 공식 source](https://github.com/SYSTRAN/faster-whisper)는 CTranslate2 기반으로 OpenAI Whisper보다
빠르고 memory가 작다고 보고하며, CPU/GPU int8·batch·word timestamp·Silero VAD·PyAV audio decoding을 제공한다.

강점:

- Windows NVIDIA GPU에서 성숙한 고속 경로
- MP3/M4A/MP4를 PyAV로 직접 decode
- batched transcription
- VAD·word timestamp
- Hermes가 기본 local STT로 사용

비용:

- Python·CTranslate2·PyAV runtime
- Windows CUDA/cuDNN version matrix
- package·update·dependency surface가 큼
- macOS Apple Silicon의 단일 native helper 목표와 불일치

따라서 Windows NVIDIA positive control과 accuracy/performance 비교군으로 둔다. 첫 공통 제품 후보는 아니다.

## 2.5 media decode

whisper.cpp inference에는 16kHz mono PCM reality가 필요하다. 사용자가 `WAV`만 준비하게 만들지 않는다.

- macOS: [AVFoundation](https://developer.apple.com/av-foundation/)과 `AVAssetReader`로 MP3·M4A·MP4·MOV 등
  system-supported media의 audio track을 PCM으로 읽는다.
- Windows: [Media Foundation](https://learn.microsoft.com/en-us/windows/win32/medfound/supported-media-formats-in-media-foundation)으로
  MP3·M4A·MP4·MOV·WAV와 AAC·MP3 등을 PCM으로 읽는다.

첫 후보는 platform-native decoder다. FFmpeg는 더 넓은 format positive control로 비교하되, 별도 package·license·binary
surface가 실제 사용자 필요 없이 늘어나면 채택하지 않는다.

---

## 3. 비교군 조사와 T5가 배울 원리

## 3.1 OpenClaw

[OpenClaw Audio 공식 문서](https://github.com/openclaw/openclaw/blob/main/docs/nodes/audio.md)의 현재 구조:

- provider audio model 또는 local CLI 자동 발견
- provider credential이 있으면 Groq·OpenAI·xAI·Deepgram 등 hosted provider가 local CLI보다 먼저 선택됨
- local `whisper-cli`, sherpa-onnx, `parakeet-mlx`, Python `whisper` fallback
- 첫 audio attachment를 전사해 `Transcript`와 Agent input으로 공급
- model별 maxBytes·timeout·fallback
- 기본 audio size cap 20MB
- local resident Whisper를 관리하지 않고 process-per-request
- file transcription CLI 별도 제공

배울 원리:

- capability inventory와 actual observed backend를 분리
- provider·CLI ordered fallback
- size·timeout·empty output은 다음 후보로 넘어갈 수 있음
- transcript를 untrusted media evidence로 취급
- backend를 status에 정직하게 표시

복제하지 않을 것:

- API key가 있다는 이유만으로 사용자의 local-first 목적보다 hosted provider를 우선
- 첫 attachment·20MB 중심의 voice-note 범위를 T5 전체 청각 경계로 사용
- process-per-request cold load를 영구 구조로 확정
- transcript를 현재 message text로만 바꾸고 source·Artifact·coverage를 약하게 보존

## 3.2 Hermes Agent

[Hermes Voice·TTS 공식 문서](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/tts.md)의
현재 구조:

- Telegram·Discord·WhatsApp·Slack·Signal voice message 자동 전사
- `faster-whisper` local provider가 기본
- 기본 local model은 약 150MB `base`
- Groq·OpenAI·Mistral·xAI provider
- local `whisper` CLI와 custom command provider
- TXT·JSON·SRT·VTT
- timeout 뒤 process tree 종료
- provider plugin과 TTS/streaming voice delivery

배울 원리:

- 사용자는 Whisper 이름을 몰라도 voice input이 바로 작동
- local·hosted provider를 같은 사용자 기능으로 제공
- custom command와 plugin을 하나의 STT result envelope로 정규화
- timeout·empty output·process tree를 정확히 관리
- 메신저 입력과 결과 전달까지 함께 설계

복제하지 않을 것:

- 일반 사용자 품질을 위해 `base`를 무조건 기본값으로 사용
- user-level shell command template을 제품 권한 경계로 사용
- 원본 file을 command provider가 full user permission으로 직접 읽게 함
- transcript 성공을 회의 목적·자막·문서 완료와 합침

## 3.3 MLX Core / mlx-serve

MLX Core는 macOS에서 Whisper와 별개의 local media model server 경험을 보여 주는 참고 사례다. model browser,
download progress, load/unload, media output, local API는 배울 가치가 있다. 그러나 Apple Silicon 전용이며 자체 Chat·Agent·
Memory·MCP·Telegram은 T5와 중복된다.

T5는 MLX Core 앱이나 `mlx-serve`를 STT 제품 의존성으로 삼지 않는다. 필요한 원리는 model lifecycle·hardware fit·
progress·local output뿐이다.

## 3.4 Ollama

Ollama는 local LLM·vision·embedding runtime과 localhost API다. 현재 오너 Mac에는 앱만 있고 local model은 0개이며
server도 실행 중이 아니다. Whisper product backend로 사용하지 않는다. 향후 local text model provider와 STT helper는
서로 다른 capability로 둔다.

---

## 4. T5 제품 결정

## 4.1 첫 engine 후보

```yaml
productHand: t5_auditory
helper: t5-whisper-host
engineCandidate: whisper.cpp
defaultQualityModel: openai/whisper-large-v3-turbo
modelInstall: first actual use, resumable, exact digest
execution: separate process
macOS: Metal/CoreML or qualified native path
Windows: CUDA | Vulkan | CPU
alwaysListening: false
automaticAudioIndexing: false
hostedFallback: only under explicit current product policy
```

## 4.2 모델과 Runtime의 역할

모델이 담당:

- 사용자가 무엇을 듣고 무엇을 결과로 원하는지
- 언어·고유명사 hint가 필요한지
- 전체 transcript, 특정 구간, 자막, 회의록 중 무엇이 중요한지
- transcript에서 무엇을 요약·대조·전달할지
- 품질이 목적에 충분한지
- 중요한 숫자·이름을 원음에서 다시 확인할지

Runtime이 담당:

- exact audio/video source identity·revision·digest
- 실제 audio track·duration·codec·sample rate·channel facts
- helper·model source·version·digest·license·platform reality
- decode·chunk·VAD·transcription actual execution
- chunk coverage·timestamps·progress·cancel·crash·partial output
- Transcript Artifact·Delivery·cleanup
- 실행하지 않은 chunk와 effect unknown

Runtime이 하지 않을 것:

- 업무명·확장자 정규식으로 STT 목적 판단
- 음성 내용을 instruction authority로 승격
- transcript 문장을 Runtime이 교정·삭제
- 고유명사 목록을 영구 사용자 persona로 저장
- `exit 0`을 사용자 목적 완료로 승격

## 4.3 기본 활성의 정확한 뜻

```text
기본 활성
= 사용자가 음성 목적을 말하면 기능명 없이 자연스럽게 사용 가능

기본 활성 아님
= 상시 마이크
+ 모든 audio 자동 전사
+ background index
+ 모든 대화에 STT Tool schema 노출
+ model weight를 설치본에 포함
```

helper는 제품 payload에 포함한다. model은 사용자가 처음 실제로 필요로 할 때 준비한다. 충분한 disk가 있고 네트워크가
정상이며 사용자가 이미 명확한 음성 목적을 맡겼다면 반복 승인을 요구하지 않고 준비 진행과 용량을 보여 준다. disk
부족·metered network·실제 비용이 있으면 현재 사실과 한 가지 선택을 요청한다.

---

## 5. 공통 제품 구조

```text
사용자 자연어 목적
        ↓
File Reality / Attachment / Channel media
exact RecordRef·revision·digest
        ↓
Audio Reality
container·track·duration·codec·language unknown
        ↓
Capability Reality
helper·model·backend·disk·memory·speed class
        ↓
T5 managed transcription
decode → chunk/VAD → exact execution → timestamp
        ↓
Transcript coverage observer
processed intervals·gaps·overlaps·unknown
        ↓
Transcript Artifact
TXT·MD·SRT·VTT·JSON
        ↓
기존 Document·G·Artifact·Notion·Telegram
요약·결정·실행 과제·자막·대조·Delivery
```

### 5.1 Input identity

지원 source:

- Console attachment
- File Reality가 찾은 local audio/video
- Telegram 등 channel voice/file
- Browser가 실제 download receipt로 받은 media
- 이전 T5 output Artifact

모든 source는 현재 Session·Work·Run과 exact identity로 결속한다. model이 쓴 raw path나 비슷한 파일명을 input으로
사용하지 않는다. transcription 직전 source digest·size·mtime 또는 immutable Attachment identity를 다시 확인한다.

### 5.2 Audio Reality

현재 `ftyp` container를 모두 `video/mp4`로 보는 단순 분류를 그대로 사용하지 않는다. 실행 전 native media observer가
다음을 사실로 돌려준다.

```yaml
audioReality:
  sourceHandle:
  container:
  durationMs:
  tracks:
    - trackId:
      kind: audio
      codec:
      sampleRate:
      channels:
      languageTag:
  selectedTrack:
  coverage: complete | partial | unavailable | unknown
```

여러 audio track의 의미는 모델이 현재 목적에서 판단한다. Runtime은 첫 track이 관련 있다고 단정하지 않는다.

### 5.3 Decode boundary

- source는 read-only
- decode output은 T5 scratch의 16kHz mono PCM
- original timestamp mapping 보존
- source 밖 read 0
- network 0
- decode failure와 no-audio-track 분리
- partial PCM을 complete input으로 승격하지 않음
- macOS AVFoundation·Windows Media Foundation을 먼저 비교
- format gap이 실제 재현될 때만 bounded FFmpeg helper 검토

### 5.4 Chunk·VAD·coverage

긴 파일을 메모리에 한 번에 올리지 않는다.

```text
audio duration
→ bounded windows
→ optional VAD speech intervals
→ overlap과 original-time mapping
→ exact chunk execution
→ partial transcript append
→ coverage settlement
```

Runtime이 보존할 사실:

- expected duration
- decoded duration
- processed intervals
- skipped silence intervals
- gaps·overlaps
- chunk model/config identity
- segment timestamps
- language observation
- no-speech probability·compression/repetition observation
- failed·cancelled·unknown intervals

Runtime은 suspicious repetition을 임의로 삭제하지 않는다. 사실을 모델에 공급하고, source segment 재개방과 재전사
필요성을 모델이 판단한다.

### 5.5 Transcript Artifact

원본 transcript와 후속 결과를 구분한다.

```yaml
rawTranscript:
  sourceAudio:
  modelGeneration:
  coverage:
  segments:
  unknownIntervals:

derivedResult:
  transcriptVersion:
  userCorrections:
  summary:
  decisions:
  actionItems:
  citationsToTime:
```

Whisper raw output을 사용자 교정으로 덮어쓰지 않는다. 교정본은 같은 Artifact family의 새 version으로 만들고 원본
machine transcript와 사용자 correction provenance를 보존한다.

### 5.6 Context economy

긴 transcript 전체를 모든 model call에 넣지 않는다.

- Transcript Artifact와 segment handle을 정본으로 보존
- 목적 관련 span search→exact reopen
- 전체 요약이 필요할 때 기존 large-document·recoverable output 원리를 재사용
- 같은 transcript payload 반복 투영 0
- 다른 Session·channel 자동 주입 0
- Memory 자동 저장 0

---

## 6. 모델 asset lifecycle

모델을 설치본에 포함하지 않는다. 공식 weight 약 1.62GB와 helper를 분리한다.

### 필수 사실

- publisher: OpenAI
- model: `whisper-large-v3-turbo`
- exact immutable revision
- artifact SHA-256
- expected bytes
- license: MIT
- format: GGML/whisper.cpp conversion provenance
- conversion source commit·tool digest·quantization facts
- target platform·backend compatibility

### lifecycle

```text
not_present
→ source_resolved
→ resumable_download
→ hash_verified
→ installed_inactive
→ fixture_qualified
→ active
→ updated | rolled_back | removed
```

경계:

- 기존 `ManagedCliStore`의 64MB 상한을 전역으로 올려 model file을 밀어 넣지 않는다.
- Hugging Face cache·MLX cache·T5 cache에 같은 model을 중복 저장하지 않는다.
- partial download는 active model이 아니다.
- update가 실패하면 이전 verified generation 유지.
- model weight는 backup 대상 사용자 자료가 아니라 재다운로드 가능한 Capability asset.
- settings에는 용량·상태·마지막 사용·제거만 보이고 내부 path·hash는 기본 숨김.
- 새 범용 Model Marketplace나 관리자 UI를 만들지 않는다.

첫 AU-2에서 현재 Capability lifecycle을 확장하는 가장 작은 bounded asset 결속을 비교한다. 휴면
`LocalCapabilityPackageStore`를 과거에 연구했다는 이유로 product entry에 통째로 복원하지 않는다.

---

## 7. 차기 개발 Gate

Gate 이름은 `S7-AU`를 제안하되, 실제 차수 번호는 당시 단일 제품 정본이 결정한다.

## AU-0 — Current Auditory Baseline · 제품 변경 0

목적:

- 현재 audio/video attachment·File Reality·channel·Artifact 현실 확인
- 과거 2시간 성공을 current qualification과 분리
- whisper.cpp·MLX Whisper·faster-whisper의 동일 목적 A/B
- macOS·Windows 실행 요구와 model asset gap 고정

고정 fixture:

1. 45초 한국어 음성 메모 — 사람 이름·금액·기한
2. 20분 회의 — 두 주제·교정·무음
3. 2시간 회의 — 장기 memory·coverage·cancel
4. 음악 intro 뒤 한국어 발화 — VAD timestamp 반례
5. 완전 무음·잡음·깨진 file — false transcript 반례
6. MP4/MOV video — audio track 선택
7. 한국어·영어 code-switch

비교:

```text
A current T5 capability boundary
B whisper.cpp full large-v3-turbo
C whisper.cpp quantized candidate
D MLX Whisper large-v3-turbo, macOS only
E faster-whisper, Windows NVIDIA positive control
```

측정:

- Korean CER·WER
- 이름·금액·날짜·기한 exactness
- segment·word timestamp error
- silence hallucination·repetition
- total coverage·gap·overlap
- first partial result·total wall
- peak RSS·disk·model load time
- model/helper crash·cancel latency
- output size·Artifact usability

AU-0 종료 문장:

> 같은 audio source와 oracle에서 현재 제품 gap, 세 engine의 정확성·속도·메모리·플랫폼 차이, 첫 제품 후보 하나가
> 제품 변경 없이 확정됐다.

whisper.cpp가 이기지 못하면 채택하지 않는다. MLX/faster-whisper가 플랫폼별로 명확히 우월하면 공통 계약과 platform
adapter를 분리한다.

## AU-1 — Audio Reality & Native Decode

첫 implementation slice다.

- WAV·MP3·M4A·MP4·MOV representative inputs
- exact container·track·duration
- macOS AVFoundation·Windows Media Foundation
- 16k mono PCM scratch
- source digest pre/post revalidation
- large input streaming, 전체 bytes 메모리 적재 금지
- Console attachment 128MB 상한을 전역으로 올리지 않고 large local media를 File Reality handle로 처리
- 실제 upload 대형 audio가 product requirement라면 streaming Attachment 경계만 별도 후보화

완료 문장:

> T5는 사용자가 맡긴 exact audio/video에서 실제 audio track을 원본 변경 없이 bounded PCM으로 관측하고, 읽지 못한
> 형식·track·구간을 정직하게 구분한다.

## AU-2 — Helper & Model Acquisition

- `t5-whisper-host` macOS arm64·Windows x64·Windows arm64 build
- whisper.cpp exact commit·MIT notice
- model on-demand resumable download
- exact digest·bytes·license·generation
- fixture qualification 뒤 active
- remove·update·rollback
- disk 부족·corrupt download·network loss·relaunch
- helper는 기본 package, model weight는 별도
- 모델 준비 polling model call 0
- 준비 완료 뒤 original Work exact once resume

완료 문장:

> 사용자는 Whisper를 몰라도 음성 목적만 말하며, T5는 현재 컴퓨터에 맞는 검증된 helper와 model을 준비한 뒤 같은
> Work를 다시 설명받지 않고 이어간다.

## AU-3 — Managed Transcription Spine

- D-owned separate process
- chunk·progress callback·output handle
- stdout/stderr 대형 보존
- cancel→tail chunk 실행 0
- stop 뒤 late transcript 0
- helper crash→partial exact reopen·blind retry 0
- foreign Session handle 0
- multiple concurrent audio jobs의 GPU/RAM admission
- process-per-job baseline
- resident model host는 cold load가 실제 UX 병목일 때만 별도 A/B

OpenClaw의 resident lifecycle 경계가 반대시험이다. health/startup, bounded queue, model residency, cancellation, loopback
ownership, idle unload가 모두 없으면 resident candidate를 채택하지 않는다.

완료 문장:

> 긴 전사는 진행·중단·사고 뒤에도 같은 source·model·chunk reality를 보존하며 실행하지 않은 구간을 자동 재실행하거나
> 다른 대화에 섞지 않는다.

## AU-4 — Transcript Coverage & Truth

- expected·decoded·processed duration
- segment monotonicity
- gap·overlap·duplicate
- no-speech·music intro·noise
- truncated output
- invalid UTF-8·empty output
- source change/stale
- model generation mismatch
- SRT/VTT timestamp validity
- important names·numbers source segment exact reopen

guest exit 0이나 transcript text 존재만으로 success를 만들지 않는다.

완료 문장:

> T5는 전사된 구간과 전사하지 못한 구간을 시간축으로 정확히 알고, Whisper의 자신감이나 빈 출력 대신 원음·coverage
> 현실로 결과를 전달한다.

## AU-5 — Transcript Artifact & Work Results

첫 실제 사용자 목적 세 가지:

1. 사업: 2시간 회의→전체 transcript·결정·담당자·기한·회의록 DOCX/MD
2. 연구: 강의 영상→SRT/VTT·핵심 구간·출처 timestamp
3. 개인: 파일명을 모르는 음성 메모→내용 검색·정리·원본 Reveal

기존 기반 재사용:

- File Reality exact file discovery
- Document·large evidence handling
- Artifact family/version
- Preview·Download·Reveal
- user correction
- Notion·Telegram delivery
- Backup·delete·forget boundaries

완료 문장:

> 사용자는 녹음 기능이 아니라 목적을 말하고, T5는 전사 원문과 검증된 후속 결과를 실제로 열고 내려받고 교정할 수
> 있는 같은 작업 결과로 전달한다.

## AU-6 — Natural Activation & Channels

- direct text 요청 Tool 0 무회귀
- audio purpose에서만 auditory hand on-demand
- 첨부 audio
- File Reality local audio/video
- Telegram voice note
- Console↔Telegram canonical continuity
- channel audio 원문·transcript 다른 Session 자동 투영 0
- 기능명·model·CLI 선택 요구 0
- internal path·command·hash 노출 0

첫 범위에서 열지 않을 것:

- 항상 켜진 microphone
- wake word
- 실시간 통화
- background recording
- 다른 앱 audio capture
- Apple Notes 내부 첨부 추출 우회

## AU-7 — Platform·Performance·Economy

macOS physical:

- M4 16GB 기준 large-v3-turbo
- Metal/CoreML·CPU facts
- 1분·20분·2시간
- model cold/warm
- battery·thermal은 사실로 기록하되 성공과 합치지 않음

Windows physical:

- x64 NVIDIA CUDA
- x64 AMD·Intel Vulkan
- x64 CPU fallback
- ARM64 native build와 실제 성능
- 한글·공백·긴 path
- Job Object cancellation·Runtime crash
- Media Foundation decode

성능 목표는 Runtime 고정 timeout이 아니다.

```yaml
submitFeedback: 300ms 권장
actualProgress: 2s 이내
modelPollingCalls: 0
M4_16GB_warm_1h: 실시간 대비 10배 이상 후보
cancelToNoLateOutput: 1s 권장
peakMemory: 현재 foreground 작업과 swap을 망치지 않는 measured bound
```

과거 2시간 2분→8분 40초보다 정확성·coverage를 낮추면서 속도만 맞추면 실패다. Windows는 GPU·CPU가 다양하므로
한 초로 PASS를 복제하지 않고 hardware class와 실제 factor를 함께 기록한다.

## AU-HQ — Actual Human Console Qualification

실제 설치 제품과 같은 Console에서 사람이 수행한다.

### H1 빠른 음성 메모

```text
“다운로드 폴더에서 오늘 받은 음성 메모 찾아서 할 일만 알려줘.”
```

- 파일명 모름
- exact file discovery
- first useful result
- 원본 Reveal·transcript

### H2 긴 회의

```text
“이 회의를 전체 전사하고 결정·담당자·기한이 있는 회의록으로 만들어줘.”
```

- model 최초 준비부터 결과
- progress·Stop·Session 전환·복귀
- raw transcript·DOCX/MD
- 숫자·이름 correction→version 2

### H3 영상 자막

```text
“이 영상에 한국어 자막을 만들어줘.”
```

- actual audio track
- SRT·VTT
- timestamp seek sample
- video original unchanged

합격:

```text
세 목적 정확성·완전성
AND 사용자 기능·model 선택 0
AND source·duration·coverage truth
AND local-only transmission
AND first useful progress
AND Stop·restart·Session continuity
AND transcript·SRT·문서 Artifact actual
AND names·numbers correction·version
AND target 밖 effect·orphan·blind retry 0
AND macOS·Windows 의미 동등
```

---

## 8. 필수 반대시험

### source·decode

- symlink·hardlink·stale source
- audio track 0개
- 여러 audio track
- MP4 video지만 audio 없음
- malformed container·truncated media
- huge duration·oversized attachment
- Unicode·NFC/NFD·공백·긴 filename

### model asset

- download 중단·resume
- content-length mismatch
- digest mismatch
- disk full
- previous generation rollback
- model removed while job active
- foreign model file substitution
- duplicate HF/MLX cache 0

### execution

- 완전 무음
- 긴 침묵
- 음악 intro 뒤 발화
- 심한 background noise
- 반복 발화와 Whisper repetition
- code-switch
- chunk boundary에서 단어·timestamp 중복
- cancellation between decode/chunk/model/write/settlement
- Runtime crash
- helper crash
- 두 Session 동시 실행
- foreign Session output

### truth·delivery

- exit 0 + empty transcript
- transcript 존재 + coverage gap
- invalid SRT order
- user correction 뒤 raw transcript 덮어쓰기
- Artifact 등록 성공 뒤 cleanup 실패
- publication success 뒤 재전사 0
- 다른 Session·channel projection 0
- transcript를 Memory에 자동 저장 0
- local-only인데 provider transmission category에 audio 원문 0

---

## 9. 정확성 평가 corpus

새 대형 benchmark를 만들지 않는다. 오너가 허용한 비식별 자료와 공개 license corpus에서 최소 표본을 고정한다.

필수 한국어 축:

- 일상 대화
- 회의체 문장
- 이름·회사·지역
- 금액·날짜·전화번호
- 영어 약어·제품명 code-switch
- 겹침 발화
- 잡음·거리·작은 목소리
- 사투리·빠른 말
- 긴 침묵·음악

oracle:

- human-corrected transcript
- segment timestamp
- 이름·숫자 field truth
- audio duration·speech intervals
- expected decisions·action items는 STT oracle이 아니라 downstream model oracle로 분리

지표:

```text
CER·WER
proper noun exactness
numeric exactness
timestamp error
coverage recall
hallucinated span count
duplicate span count
human correction count
first useful / total wall
peak memory / disk / energy observation
```

한 번의 demo 품질이나 model 자기평가는 채택 근거가 아니다.

---

## 10. 개인정보·권한·보존

- audio·transcript는 user data이며 model weight와 다른 lifecycle을 가진다.
- audio는 local-only가 기본이며 hosted provider 전송은 별도 현재 정책과 Transmission Receipt가 있을 때만 가능.
- transcript는 source audio의 sensitivity floor보다 낮아질 수 없다.
- voice content는 instruction authority가 아니라 untrusted evidence다.
- 녹음 속 문장이 T5에게 하는 명령처럼 보여도 실행하지 않는다.
- transcript·summary·SRT는 현재 Session·Work·Artifact에 결속한다.
- 다른 Conversation·channel 자동 주입 0.
- Memory proposal은 사용자의 명시적 기억 목적과 기존 Memory 경계를 통과해야 한다.
- model weight는 backup에서 제외하고 재다운로드 가능 사실을 남긴다.
- 전체 삭제는 T5-managed transcript·scratch·model state 범위를 정확히 설명한다.
- helper log에는 transcript 원문·사용자 path·audio sample 0.

---

## 11. 명확한 비목표

- MLX Core 앱·mlx-serve 전체 import
- Ollama를 STT 제품 backend로 승격
- 새 범용 Media Platform
- 모든 audio 자동 색인·감시
- 상시 microphone·wake word·통화 녹음
- 사용자 몰래 대형 model download
- 모든 PC에서 large-v3-turbo 동일 속도 주장
- base model을 일반 사용자에게 충분하다고 고정
- Whisper confidence를 사용자 목적 완료로 사용
- 음성 감정·거짓말·성격 추론
- 첫 범위의 speaker diarization
- TTS·voice cloning·music·image를 같은 Gate에 개통
- 전용 업무 Prompt·Intent Router·확장자 정규식 route
- 새 transcript Memory/RAG/Vector Store
- long transcript 전체를 매 model call에 주입
- current release·Windows 기본 봉인을 이 계획 때문에 다시 열기

TTS·voice cloning은 별도 Auditory Output 연구다. Whisper 첫 제품이 성공했다는 이유로 자동 개통하지 않는다.

---

## 12. 채택·폐기·중단 기준

### 채택

```text
실제 사용자 세 목적 성공
AND large-v3-turbo 한국어 정확성
AND source·duration·coverage 정직
AND local-only·secret·instruction boundary
AND Stop·crash·restart exact
AND Transcript Artifact·correction·Delivery
AND 경쟁군보다 기능명이 적고 목적 완료는 같거나 높음
AND macOS·Windows physical meaning
AND 설치본에는 helper만, model on-demand
```

### 폐기·재설계

- whisper.cpp가 같은 model에서 현재 historical path보다 정확성·경제성이 나쁨
- native decoder가 representative format을 안정적으로 읽지 못함
- model download를 current Capability lifecycle에 정직하게 결속할 수 없음
- transcript가 다른 Session·provider Context에 자동 투영됨
- 긴 audio에서 coverage가 증명되지 않음
- cancel 뒤 late transcript·orphan helper가 남음
- resident 후보가 process-per-job보다 사용자 이익 없이 memory만 상주
- quantization이 이름·숫자·한국어 정확성을 낮춤
- 같은 결함 가족에 세 번째 조건 patch가 필요함
- fixture는 통과하지만 actual Console 목적이 실패함

두 후보가 같은 결함 가족에서 실패하면 engine option을 더 붙이지 않고 input/decode/model/lifecycle/UX 중 원인 계층을
다시 판정한다.

---

## 13. 실행 순서

```text
현재 macOS 6.0 release·Windows 기본 제품선 봉인
→ 오너가 Whisper Gate 명시 개통
→ AU-0 read-only current baseline
→ engine 하나 선택 또는 제품 변경 0 종료
→ AU-1 Audio Reality
→ AU-2 helper·model acquisition
→ AU-3 managed transcription
→ AU-4 coverage truth
→ AU-5 Artifact·업무 결과
→ AU-6 자연어·채널
→ AU-7 macOS·Windows physical
→ AU-HQ actual Console
→ focused regression
→ 전체 CI 1회
→ clean commit·단일 evidence chain
```

각 Gate는 기능 수가 아니라 사용자 완료 문장 하나로 닫는다. 이미 선 D·E·F·G·Capability·Artifact·Channel을
재개발하지 않는다.

---

## 14. 미래 개발 세션의 시작 일곱 줄

1. **제품 약속**: 사용자는 Whisper·파일형식·모델을 몰라도 평소 말로 녹음 목적을 맡긴다.
2. **현재 Gate**: 오너가 실제로 연 `AU-*` 한 단계와 완료 문장.
3. **사용자 완료 문장**: T5는 exact local audio를 듣고 coverage를 검증해 transcript와 실제 업무 결과를 전달한다.
4. **이미 선 증거**: S6-C STT gap, 과거 2시간 actual, Attachment audio boundary, D process, Artifact, Capability lifecycle.
5. **가장 큰 미달**: current exact head에서 재현된 source/decode/model/execution/coverage/delivery 결함 하나.
6. **첫 변경 방식**: whisper.cpp candidate와 현재 기반의 가장 작은 연결부 하나.
7. **Non-goals**: 항상 듣기·RAG·TTS·voice clone·music·새 Router·거대 media platform·현재 release 재개통.

그 뒤 반드시 AU-0부터 시작한다. 이 문서와 오너의 기대만으로 implementation PASS를 가정하지 않는다.

---

## 15. 조사 source

### 모델·엔진

- [OpenAI Whisper large-v3-turbo model card](https://huggingface.co/openai/whisper-large-v3-turbo)
- [whisper.cpp official repository](https://github.com/ggml-org/whisper.cpp)
- [whisper.cpp MIT license](https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE)
- [MLX Whisper official example](https://github.com/ml-explore/mlx-examples/blob/main/whisper/README.md)
- [faster-whisper official repository](https://github.com/SYSTRAN/faster-whisper)

### 비교군

- [OpenClaw Audio and voice notes](https://github.com/openclaw/openclaw/blob/main/docs/nodes/audio.md)
- [OpenClaw Media understanding](https://github.com/openclaw/openclaw/blob/main/docs/nodes/media-understanding.md)
- [Hermes Agent Voice & TTS](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/tts.md)

### 플랫폼 media

- [Apple AVFoundation](https://developer.apple.com/av-foundation/)
- [Apple AVAssetReader](https://developer.apple.com/documentation/avfoundation/avassetreader)
- [Microsoft Media Foundation supported formats](https://learn.microsoft.com/en-us/windows/win32/medfound/supported-media-formats-in-media-foundation)

### 현재 T5 내부 근거

- `T5-PRODUCT.md`
- `T5-SIXTH-COMPLETION.md` S6-C
- `refoundation/evidence/s6-c-natural-acquisition-first-slice-2026-08-30.json`
- `refoundation/evidence/s6-c-closeout-2026-08-30.json`
- `refoundation/evidence/r8-a1-unified-attachment-live.json`
- `refoundation/src/attachment-store.js`
- `refoundation/src/attachment-hand.js`
- `refoundation/src/managed-process.js`
- `refoundation/src/managed-cli-store.js`
- `refoundation/src/capability-reality.js`
- `refoundation/src/attachment-store.js`

## 최종 연구 판정

> Whisper는 T5에 있으면 좋은 부가기능이 아니라, 경쟁 제품이 이미 갖춘 기본 음성 입력 능력을 T5의 현실 확인·긴
> 작업·Artifact·교정·Windows 동등성과 결합해 더 완전한 사용자 결과로 만드는 차기 핵심 기관이다. 첫 후보는
> `whisper.cpp + large-v3-turbo + platform-native decode + T5-managed model lifecycle`이며, 제품 구현은 현재 release와
> Windows 기본선이 봉인되고 오너가 AU Gate를 연 뒤 AU-0 read-only baseline에서 시작한다.
