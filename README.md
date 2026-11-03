# Character Insight (캐릭터 해석) — SillyTavern 확장

캐릭터 카드를 분석해 **① 겉과 속**, **② 충돌하는 가치 쌍**을 만들고, 답변 생성 때 프롬프트에 넣어 캐해를 돕는 확장입니다. MVU가 돌아가고 있으면 "지금 이 순간"의 상태를 MVU 변수로 추적합니다.

| 모듈 | 내용 | 저장 위치 |
|---|---|---|
| ① 겉과 속 | 보여주는 모습 / 진짜 욕구 / 두려움·상처 / 스스로 믿는 착각 (칸당 160자) | 캐릭터 카드 `data.extensions.character_insight` (카드를 내보내면 같이 따라감) |
| ② 충돌하는 가치 쌍 (최대 3개) | A vs B, 기우는 쪽 0~100, 부딪힐 때 행동, 반대로 골랐을 때 대가 | 위와 같음 |
| MVU 동적 층 | `캐해.가면균열`, `캐해.기울기[]`, `캐해.최근갈등` | MVU 메시지 변수 `stat_data.캐해` (스와이프마다 분기) |

## 설치

**방법 A — 폴더 복사**
1. `SillyTavern-CharacterInsight` 폴더를 `SillyTavern/data/<사용자명>/extensions/` 에 넣습니다. (기본 사용자면 `data/default-user/extensions/`)
2. 실리태번을 새로고침 → 확장(Extensions) 패널에 **캐릭터 해석** 서랍이 생깁니다.

**방법 B — GitHub에 올린 뒤 설치**
1. 이 폴더를 GitHub 저장소로 올립니다 (폴더 안 파일이 저장소 최상단에 오도록).
2. 확장 패널 → **Install extension** → 저장소 주소 입력.

> ⚠️ 확장은 브라우저에서 JavaScript를 실행합니다. 이 확장은 **카드 분석 때만** 카드 내용을 지금 연결된 AI API로 보내고, 결과는 캐릭터 카드에 저장합니다. 그 밖의 외부 요청은 없습니다.

## 사용법

1. 1:1 채팅에서 캐릭터를 엽니다.
2. 실행 방법 (셋 다 같음)
   - 확장 패널 → **카드 분석** / **편집 열기**
   - 입력창 왼쪽 마법봉(🪄) 메뉴 → **캐해 분석** / **캐해 편집**
   - 슬래시 커맨드 `/caehae analyze` · `/caehae edit` · `/caehae show`(주입 텍스트 확인)
3. 분석이 끝나면 편집 창이 열립니다 → 확인·수정 → **저장**. 다음 답변부터 적용됩니다.
4. 편집 창 아래 **"AI에게 들어가는 프롬프트 미리보기"** 에서 실제 주입 내용을 볼 수 있습니다.

## MVU 연동

- **MVU 카드**(Tavern Helper + MVU 스크립트가 켜진 카드): 자동 감지됩니다. 패널에 `MVU: 감지됨`.
  - 새 채팅을 시작하면 `stat_data.캐해` 가 분석값으로 채워집니다.
  - AI가 매 답변에서 이 값들을 갱신하고, 확장이 범위(0~100)와 **한 턴 최대 변화량**을 강제합니다.
  - 카드의 기존 변수는 건드리지 않습니다.
- **MVU가 없는 카드에서 동적 층을 쓰고 싶다면**: 그 카드에 Tavern Helper 스크립트 두 개를 추가하고 패널에서 **"변수 출력 형식도 주입"** 을 켜세요.
  1. `import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js';`
  2. `import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js'; $(() => registerMvuSchema(z.object({})));`
- MVU가 없으면 **고정 모드**: 분석 결과만 주입하고 변수 추적은 하지 않습니다.

## 설정

| 설정 | 기본값 | 설명 |
|---|---|---|
| 답변 생성 때 주입하기 | 켬 | |
| 주입 깊이 | 2 | 0 = 맨 끝(가장 강하게 반영). 클수록 앞쪽 |
| 주입 역할 | system | |
| 분석 결과 언어 | 한국어 | 지시문은 항상 영어, 내용만 이 언어로 |
| 분석 응답 길이 | 1500 토큰 | JSON이 중간에 잘리면 늘리세요 |
| MVU 변수로 추적 | 켬 | MVU 감지 시에만 작동 |
| 변수 갱신 규칙 주입 | 켬 | AI에게 `캐해.*` 를 언제 바꾸는지 알려줌 (깊이 0) |
| 변수 출력 형식도 주입 | 끔 | **MVU 카드가 아닐 때만** 켜기 |
| 한 턴 최대 변화량 | 10 | |

## 동작 방식 (기술 메모)

- 분석: `generateRaw({ systemPrompt, prompt, responseLength })` — 프리셋·채팅 기록 없이 카드만 보냄. 응답에서 JSON을 꺼내 글자 수·범위를 고쳐 저장.
- 저장: `writeExtensionField(characterId, 'character_insight', …)`
- 주입: `setExtensionPrompt` (IN_CHAT, 설정한 깊이). 매 생성 직전 `GENERATION_AFTER_COMMANDS` 에서 최신 MVU 값으로 다시 만듦.
- MVU: Tavern Helper가 공유하는 `window.Mvu` 와 `global_Mvu_initialized` 이벤트로 감지. `mag_variable_initiailized` / `mag_variable_update_ended` 를 ST `eventSource` 에서 받아 보정.
- 현재 값 읽기: 가장 최근 메시지의 `variables[swipe_id].stat_data.캐해`.

## 테스트 체크리스트

- [ ] 확장 패널에 서랍, 마법봉 메뉴에 항목 2개
- [ ] 카드 분석 → 편집 창에 4칸 + 가치 쌍 2~3개
- [ ] 저장 후 패널의 "해석: 저장됨"
- [ ] `/caehae show` 로 `<character_insight>` 텍스트 확인
- [ ] (MVU) 답변 후 Tavern Helper 변수 관리자 → 메시지 변수에 `stat_data.캐해`
- [ ] (MVU) 가면균열이 한 턴에 10 넘게 변하지 않음
- [ ] 다른 캐릭터로 바꾸면 그 캐릭터 해석으로 바뀜 / 없으면 주입 안 함

문제가 생기면 F12 콘솔의 `[캐릭터해석]` 로그와 빨간 오류, 재현 순서(1~5줄)를 보내 주세요.

## 아직 안 되는 것

- 그룹 채팅 (비활성화)
- 모듈 3(관계·상황별 변화표), 4(장면별 선별 주입), 6(단면화 경고)
- 분석 전용 API/모델 지정
