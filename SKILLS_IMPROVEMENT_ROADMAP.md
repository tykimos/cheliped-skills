# Cheliped Skills — 개선 로드맵 (Synthesis)

> 산출 기준: 본 로드맵의 모든 주장은 `/Users/tykimos/Projects/cheliped-skills` 실제 코드로 검증했다. 두 검증자(red-team, feasibility)가 **reject**하거나 핵심 사실을 **반증**한 제안은 그대로 채택하지 않고, 안전한 하위집합만 남기거나 드롭했다. 특히 검증 과정에서 직접 확인한 사항:
> - `fillByBackendNodeId`(기본 `fill` 경로, controller.ts:796–818)는 **per-char 지연 없는 단일 native-setter write** — DIFF-2의 "20자 입력 ~2s 절감" 헤드라인은 기본 경로에 대해 과장임(반증 확정).
> - `clickByBackendNodeId`(controller.ts:438–475)는 **primary 경로에 scrollIntoView 없음**(catch fallback 471만 스크롤), hit-test 없음, `act()`는 무조건 success.
> - `waitForStable → waitForNetworkIdle(500, …)`, `checkIdle`는 pendingRequests≤0여도 **500ms 타이머 무장**(page.ts:62–67).
> - 배치 루프는 첫 에러에서 `break`(cheliped-cli.mjs:531) — fail-fast 확정. 반면 computer-use는 per-command 격리.
> - 보안/세션 가드는 `if (this.options.security)` / `if (this.options.session)` 게이트(cheliped.ts:43,59)이고 CLI는 `{headless,stealth,compression}`만 전달(cheliped-cli.mjs:85–88) → **shipped 경로에서 dead code**.
> - computer-use는 click/type/key/scroll에 **무조건 `success:true`**(computer-cli.mjs:104–141), 스크린샷은 콘텐츠 검증 없음(75), 단일결과는 bare object로 붕괴 + pretty-print(255).
> - 호스트에서 `screencapture -R`/`-D` 플래그 존재 확인, `sips` 존재 확인. **`import Quartz` 실패(pyobjc 미설치)** → CU-6의 CGEvent 스크롤은 기본 환경에서 동작 불가(feasibility 반증 확정).

---

## 1. Executive Thesis & Differentiators

Cheliped의 승부처는 "프레임워크를 깐 에이전트"가 아니라 **호스트가 직접 부리는 토큰-절약형 손(hands)** 이라는 포지션이다. 세 가지를 동시에 갖춘 제품은 경쟁군에 없다.

1. **결정당 최소 토큰(tokens-per-decision)** — 숫자형 `agentId` + 카테고리 버킷 JSON(`agent-dom.ts:67–82`, `compressor.ts`)으로 a11y-snapshot 계열(Playwright `ariaSnapshot` ~5,672 tok, Puppeteer ~5,020 tok, Playwright-MCP는 매 스텝 스냅샷이 누적되어 task당 ~114K tok) 대비 self-report ~1,932 tok/page, vision 계열(Anthropic computer-use / OpenAI CUA, 스크린샷당 1,300–1,800+ image tok) 대비는 한 자릿수 분의 1. 이게 **유일하게 다른 누구도 이 밀도+속도로 못 하는 지점**이다.
2. **엔터프라이즈/한국어-IME 정합성** — WebSquare auto-detect + native `setValue`(controller.ts:23–27, 339–360, 786) + `Input.insertText` IME 입력(257, 573, 638). Playwright/Puppeteer/Selenium/browser-use/Stagehand는 전부 char-by-char 또는 generic value-set라 WebSquare/CJK-IME에서 깨진다. g2b.go.kr류 공공·기업 자동화에서 **경쟁사가 구조적으로 못 들어오는 niche**.
3. **임베더빌리티** — ws-only 단일 의존, SKILL.md auto-discovery, JSON in/out. browser-use(Python 루프)·Stagehand(Browserbase 결합)·Playwright-MCP(full 설치)·vision(클라우드 모델) 대비 압도적으로 가볍다.

**그러나 해자가 방치돼 있다.** 토큰 수치는 chars/4 추정(`compressor.ts:146`), 벤치마크는 2026-03-20 구버전·경쟁사 보조 API 기준이라 "strictly better"를 방어할 수 없다. `success`가 거짓을 말하는 실패 모드(권한 누락 시 computer-use, off-screen 클릭 시 browser)가 두 스킬의 최대 신뢰성 구멍이다. 보안/세션 코드는 켜지지도 않는 dead code라 신뢰성 부채다.

**로드맵의 두 축**: (A) **"모든 `success`는 검증된 효과"** 로 신뢰성을 역전시킨다. (B) **토큰 해자를 재증명 가능한 수치로 굳히고**, 엔터프라이즈/한국어 niche를 first-class로 끌어올린다. **명시적 non-goal**: 독자 agent loop를 키우지 않는다(임베더빌리티 해자 훼손).

---

## 2. Competitor Comparison Table

| Capability | **Cheliped** | Playwright(core) | Playwright-MCP | browser-use | Stagehand | Anthropic CU / OpenAI CUA | raw-CDP agents |
|---|---|---|---|---|---|---|---|
| Tokens / perception | **~1,932 tok (self-report, chars/4)** | ~5,672 (ariaSnapshot) | 2–5KB/snap, **task당 ~114K** | DOM-first, heavy page extra LLM call | discover-then-cache | **screenshot 1,300–1,800+ tok** | 종종 raw CDP, 무압축 |
| Numeric/dense interaction IDs | **Yes (agentId)** | No (CSS/locator) | symbolic `[ref=eN]` | numbered DOM | NL act/observe | pixel coords | No |
| Extraction speed | **~29–44ms (self-report)** | ~69ms a11y | per-snap fast, MCP RT 무거움 | DOM serialize 지연 | cold-path LLM | ~0.8s/screenshot | fastest tier |
| Self-heal / action cache | **None** | auto-wait | inherits PW | re-perceive | **caching+self-heal** | reasoning | varies |
| WebSquare / 한국어 IME | **Yes (유일)** | No | No | No | No | (vision 우회) | No |
| Multi-engine search ($0) | **Yes, 8 engines (유일)** | No | No | No | No | No | No |
| Multi-tab/dialog/upload/cookie | **없음(CLI)** | Yes | Yes | Yes | Yes | n/a | varies |
| Verified success signal | **거짓 양성 존재** | auto-wait throws | inherits | — | self-heal | 화면은 봄 | varies |
| Security guards (shipped) | **dead code** | n/a | n/a | n/a | n/a | sandbox | no |
| Native desktop(GUI) | **Yes (computer-use)** | No | No | No | No | **Yes** | No |
| Embeddability(thin CLI) | **최상(ws-only)** | heavy | full PW+browser | Python loop | TS+Browserbase | cloud | 가벼움 |

핵심: Cheliped가 **strictly 이기는 칸**은 토큰밀도+속도, WebSquare/IME, $0 search, 임베더빌리티. **table-stakes로 지는 칸**은 multi-tab/dialog/upload/cookie, verified-success, (지금은) 보안.

---

## 3. Quick Wins — effort S, high confidence

검증자 양쪽 모두 endorse(또는 endorse-with-changes, confidence ≥ 0.8)한 항목. 즉시 착수 권장.

| ID | 변경 | 근거(file:line) | 검증 합의 |
|---|---|---|---|
| **QW-1** | **JSON 출력 minify**(`JSON.stringify(results)`), `--pretty`로 게이트. 양 CLI 공통 | `cheliped-cli.mjs:548`, `computer-cli.mjs:255` 둘 다 `null,2` | P7/API-2: endorse 0.90–0.93. observe당 whitespace 15–30% 절감 |
| **QW-2** | observe 페이로드에서 **무용 `timestamp` 제거**(또는 `includeTiming` 게이트) | `agent-dom.ts:79` 13자리 `Date.now()` | P7: endorse. 모델 미사용, 손실 0 |
| **QW-3** | **배치 에러 격리**: `break`→`continue`, `stopOnError` 플래그 추가. browser를 computer-use 시맨틱에 맞춤 | `cheliped-cli.mjs:531` break vs `computer-cli.mjs:249–253` 격리 | P2: endorse 0.90/0.95. 계약 일관성 + footgun 제거 |
| **QW-4** | **`--chrome-path`/`CHROME_PATH`/`--timeout` 플래그** + Chromium/Brave/Chrome-for-Testing 경로 탐색 확대. 명시 경로 우선 | findChrome 단일 mac 경로, 플래그 파서는 `--session/--headed/--headless`만(`cheliped-cli.mjs:453–461`) | P15: endorse 0.85/0.90. 문서화된 escape hatch가 현재 도달 불가 |
| **QW-5** | **compression 노출 플래그** `--max-links/--max-texts/--max-text-length` | CLI 하드코딩 `maxLinks:50`(`cheliped-cli.mjs:88`) vs lib default 5000(`compressor.ts`) | P10 절반: endorse. nav-heavy 페이지 link recall 무음 저하 수정 |
| **QW-6** | **scroll repeat-loop 단일 spawn**: `repeat n times … key code … end repeat` | `computer-cli.mjs:134` 페이지당 1 spawn 루프 | P17/CU-4의 **유일 안전 부분**(일반 fusion은 reject). n→1 spawn |
| **QW-7** | **CU 프론트모스트 가드(opt-in)**: `type/key`가 target 받으면 frontmost 비교 후 재activate 1회/`E_WRONG_FOCUS` | `computer-cli.mjs:139–164` 가드 없음; frontmost 쿼리는 이미 존재 | CU-5: endorse 0.78. opt-in이라 기존 사용 무회귀 |
| **QW-8** | **list-apps 구분자 버그 수정**(콤마→sentinel `text item delimiters`), scroll amount 시맨틱 명확화 | `computer-cli.mjs:192` 콤마 split, `:131–133` amount/5 | API-3 타깃 버그만: endorse. named-params 레이어는 보류 |

> QW-3·QW-1·QW-2는 **출력 계약을 함께 건드리므로 한 번의 versioned 변경으로 묶어** 배포(아래 SB-2 참조)하는 게 검증자 권고.

---

## 4. Strategic Bets — L/XL

| ID | 베팅 | 무엇을 친다 | 채택 형태(검증 반영) | effort |
|---|---|---|---|---|
| **SB-1** | **"모든 success는 검증된 효과"** 신뢰성 역전 (DIFF-4) | Anthropic CU/OpenAI CUA(화면은 보지만 느림/비쌈), raw-CDP(검증 없음) | CU-1(권한 preflight+blank-frame: 키/마우스는 hard-error, 스크린샷은 **warn-only**), P3(verified click: scrollIntoView 항상+hit-test는 **보고 플래그**, 차단 아님), CU-2(scale emit). **auto-retry는 스냅샷 상태 생길 때까지 보류** | M (스테이징) |
| **SB-2** | **단일 정직 계약 + dead-code 활성화** (DIFF-5) | browser-use(Python loop), Stagehand(클라우드 결합), Playwright-MCP(무거움) | API-1/P2/P14 envelope+error-code를 **양 CLI 동시·버전드**로. **PID-identity 검증**(now). 보안은 **warn/report 기본, 차단 아님**(P11). idMap 영속화는 세션파일 스냅샷에 게이트 | M (분해 배포) |
| **SB-3** | **엔터프라이즈+한국어 niche를 first-class로** (DIFF-3) | 모든 프레임워크 경쟁사(framework/IME 특화 없음) | CU-3/P12(clipboard-paste IME fallback, S, 즉시) 우선. **WebSquare 경로를 작은 registry 인터페이스로 정리하되 React/Vue/Angular는 어댑터 1–2개만 검증 후**(generic native-setter 대비 우위 입증 전엔 확장 금지) | M |
| **SB-4** | **토큰 해자 재증명** (DIFF-1) | Playwright-MCP, browser-use(89.1% WebVoyager), vision | tiktoken으로 교체, **경쟁사 PRIMARY API + 현행 버전 + WebVoyager류 task-success(추출토큰 아님)** 재벤치. **재벤치가 격차를 좁힐 수 있음을 전제로** "strictly better"는 신규 수치 확보 후에만 표방 | L (별도 예산) |
| **SB-5** | **table-stakes CDP primitives** (P16) | Playwright/Puppeteer/Selenium, lightweight-CDP tier | **cookie CRUD + file upload + dialog 먼저**(낮은 상태부담). **multi-tab은 보류**(persistent target state 필요 → 데몬 의존) | L (점진) |
| **SB-6** | **resident daemon(선택) + 단일파일 dist 번들** (DIFF-2/P1) | browser-use("fastest"), Stagehand(10–100x cache), MCP round-trip | **먼저 cheap wins**: 적응형 settle(P5) + dist 단일파일 번들. **프로파일 후** Node-startup+reconnect가 여전히 지배적일 때만 소켓 데몬. cross-call agentId는 **세션파일 idMap 영속화로 데몬 없이** 우선 해결 | L (조건부) |

검증자 합의로 **드롭/대폭 축소**: P9(observe `--interactive` data-cid DOM 변이 → reject), P17/CU-4 일반 osascript fusion(에러격리 계약 훼손 → reject, scroll만 QW-6로 채택), CU-6 CGEvent 스크롤(pyobjc 미설치로 기본환경 미동작 → 드롭, multi-monitor `-D`만 별도 검토).

---

## 5. Per-Skill Concrete Next PRs (code-level direction)

### Browser

**PR-B1 (QW-3 + SB-2 일부): 에러격리 배치 + 통일 envelope + error code.** 단일 versioned 변경.
- `cheliped-cli.mjs` 명령 루프: catch에서 `break` 제거, `continue`. `stopOnError`(기본 false)일 때만 break, `close`는 항상 break.
- 결과 항목을 `{cmd, ok, result?, error?}` 로 통일. **단일 결과도 항상 array**로 emit(현 browser는 이미 array; computer-use의 bare-object 붕괴(`computer-cli.mjs:255`)는 제거).
- error는 `{code, message, retryable}` — `E_STALE_ID/E_TIMEOUT/E_UNKNOWN_CMD/E_NO_CHROME/E_NO_PERMISSION/E_NO_CLICLICK/E_WRONG_FOCUS/E_BLANK_FRAME`. 초기엔 `e.message` 분류기, 점진적으로 thrown typed error로. 메시지 언어 영어 통일(현재 일부 한국어).
- `cmd` 필드는 **유지**(per-result attribution용). minify는 QW-1과 함께.

**PR-B2 (SB-1 일부): verified click.**
- `clickByBackendNodeId`(controller.ts:438): `getBoxModel` 전에 **항상** `scrollIntoViewIfNeeded`. quad 검증(길이 8 / area>0 / NaN 가드 — `fillDeep`의 `pos!==0,0` 가드와 패리티).
- dispatch 후 `Runtime.callFunctionOn`로 `document.elementFromPoint(x,y)`가 target을 포함하는지 hit-test → 결과에 `{verified: bool, method:'dispatch'|'js-fallback'}`. **verified=false는 보고 플래그(차단 아님)** — 투명 오버레이 false-negative 때문(red-team 0.74, feasibility 0.88 합의).

**PR-B3 (P5): 적응형 post-click settle.**
- `page.ts` `waitForStable(grace=100, idle=150, cap=2000)`: 클릭 후 grace 윈도우 내 `Network.requestWillBeSent` 0건이면 즉시 resolve; 발생 시 idle floor 500→150. **이벤트-게이트라 미정착 SPA에 대해서만 bounded.** param은 상향 override 가능.

**PR-B4 (SB-5 1단계): cookie CRUD + file upload + dialog.**
- `Network.getCookies/setCookies`, `DOM.setFileInputFiles`(`upload-file [agentId,path]`), `Page.handleJavaScriptDialog`(opening 이벤트 구독 후 accept/dismiss). dialog는 navigation 전 arming 필요 → per-call detach 모델에서 fragile하므로 **데몬/세션상태 작업과 함께**가 안전. **multi-tab(Target.*)은 이 PR에서 제외.**

**PR-B5 (SB-2 일부): PID-identity + 보안 warn-report.**
- `loadSession`(`cheliped-cli.mjs:47–50`)의 `process.kill(pid,0)`에 더해 `/json/version`의 Browser 토큰을 저장값과 비교(재활용 PID hijack 방지) — **가장 싸고 순수 이득**.
- `getConnectedCheliped`에 `security:{promptInjection:'warn', exfiltration:'warn', allowlist}` 전달, `getSecurityViolations()`를 envelope에 노출. **기본 차단 금지**, `--enforce`/`--no-security` 제공. 가드 실효성 미검증이므로 "robust 방어"로 마케팅 금지 — "의심 동작 가시화"로 프레이밍.

**PR-B6 (P13 안전부분): wait/assert primitives 노출.** `wait-stable`, `wait-network-idle`(라이브러리에 이미 존재), `wait-for-text`. **auto-re-observe-retry는 보류**(시그니처 재매치가 다른 요소로 잘못 resolve → 무음 오작동 위험; 스냅샷 상태 생긴 뒤 exact-match+`retried:true` 보고로만).

### Computer-use

**PR-C1 (SB-1 핵심 / CU-1): 권한 preflight + blank-frame.**
- 캐시된 `checkPerms()`: `osascript -e 'tell application "System Events" to UI elements enabled'`(거부 시 false 반환, 에러 아님)로 Accessibility 판정 → 키/마우스 핸들러는 거부 시 **`E_NO_PERMISSION` hard-error**(no-op success 금지).
- 스크린샷 후 `sips -Z 8`로 다운스케일 후 variance 검사 → near-uniform이면 `{ok:false, warning:'frame blank — Screen Recording'}`. **dark UI false-positive 때문에 warn-only, variance(평균 아님) 사용.** `UI elements enabled`가 미인가 머신서 Automation TCC 프롬프트 유발 가능 → 자체 거부는 'unknown/warn'.

**PR-C2 (SB-1 / CU-2): self-describing 스크린샷.** (호스트서 `-R`/`-D`/`sips` 확인 완료)
- `screenshot`이 `{path, pixelWidth, pixelHeight, pointWidth, pointHeight, scale}` 반환. scale 룩업은 **프로세스당 캐시**(매 샷마다 system_profiler 호출 금지).
- `maxWidth`(기본 ~1568px longest-edge, `sips -Z`)로 다운스케일 → Anthropic 서버측 다운스케일 세금 제거 + Retina point-정렬. `region:[x,y,w,h]`(`screencapture -R`)로 크롭, **crop offset을 결과에 emit**(전역좌표 복원). screen-size sips fallback이 PIXEL 반환(`computer-cli.mjs:89`)하는 불일치도 함께 정정.

**PR-C3 (SB-3 / CU-3): IME-safe type.**
- non-ASCII/멀티라인/긴 텍스트는 clipboard-paste 경로(`set the clipboard to` 또는 stdin 포워딩하는 `sh()` 수정 후 `pbcopy`) + cmd-v. ASCII 단일라인은 keystroke 유지. `asStr`에 `\n/\r`/control char escape 추가(현재 backslash·quote만). **이전 클립보드 save/restore**(opt-out). `paste` 명령 추가. PR-C1의 frontmost 가드와 페어.

**PR-C4 (QW-6 + QW-1/QW-8): scroll 단일 spawn + minify + list-apps 수정.** envelope는 PR-B1과 동일 형태로 lockstep.

> **드롭(이 사이클)**: CU-6 CGEvent 진짜 스크롤 — `import Quartz` 호스트 실패로 zero-dep 보장 위반·기본환경 미동작. 필요 시 컴파일된 Swift/ObjC 헬퍼를 **선택적**으로. multi-monitor `-D`는 별도 검증 항목.

---

## 6. Metrics to Prove Dominance

| 메트릭 | 정의 | 목표 | 측정 |
|---|---|---|---|
| **Tokens-per-completed-task** | WebVoyager류 end-to-end task의 누적 모델 입력 토큰(스냅샷 아님) | Playwright-MCP의 ≤1/3, vision의 ≤1/10 | tiktoken 실측, 경쟁사 PRIMARY API·현행 버전(SB-4) |
| **Task success rate** | WebVoyager류 과제 완료율 | browser-use(89.1%)와 동급 이상을 niche에서 | 실제 task harness |
| **False-positive-success rate** | 무효과인데 `success/ok:true` 비율(권한·blank·off-screen 클래스) | 해당 클래스 **미탐 0** | PR-B2/PR-C1 회귀 스위트 |
| **Repeat-observe token cost** | 동일 페이지 재-observe 토큰(diff 도입 시) | 안정 페이지 80–95%↓(diff 도입 후) | minify(QW-1) 적용 후 baseline |
| **Static-page click latency** | 정적 페이지 클릭 round-trip | P5 후 settle floor ~350–500ms↓ | per-click 타이밍 |
| **Fill fidelity (CJK/WebSquare)** | typed == read-back 일치율(Hangul+WebSquare 스위트) | 프레임워크 경쟁사가 깨지는 곳에서 high | 전용 테스트 페이지 |
| **Cold-start portability** | Chromium/Brave/CI 환경 launch 성공률 | QW-4 후 ~100% | CI 매트릭스 |

---

## 7. Explicit Non-Goals

- **독자 agent loop를 키우지 않는다.** browser-use(Python 루프)·Stagehand(Browserbase) 경로로 가면 임베더빌리티 해자를 잃는다. Cheliped는 호스트가 부리는 thin primitive로 남는다.
- **cross-browser 폭(Selenium 게임)을 좇지 않는다.** 깊이(엔터프라이즈/한국어 위젯)가 wedge다.
- **per-page screenshot-by-default(browser)를 도입하지 않는다.** 토큰 thesis 자체를 포기하는 행위.
- **observe `--interactive`의 data-cid DOM 변이 매핑을 도입하지 않는다**(P9 reject) — 페이지 side-effect + 이중 id namespace. pierce/iframe-merge **opt-in 플래그**라는 안전 하위집합만 추후 고려.
- **일반 osascript 명령 fusion을 도입하지 않는다**(P17/CU-4 reject) — per-command 에러격리 계약(SB-1/SB-2가 강화하려는 바로 그것) 훼손. scroll repeat-loop(QW-6)만 채택.
- **CGEvent/pyobjc 의존 스크롤을 기본 경로에 넣지 않는다** — zero-dep 보장 위반(호스트 `import Quartz` 실패 확인).
- **보안 가드를 "robust 방어"로 마케팅하지 않는다** — 휴리스틱 실효성 미검증. warn/report·가시화로만 표방하고, 적대 페이지 테스트 스위트 확보 전까지 hard-block 기본화 금지.
- **multi-tab을 stateless per-call 모델에서 구현하지 않는다** — persistent target state(데몬) 선행 필요.

---

### 배포 시퀀스 권고 (의존성 순)
1. **즉시(S)**: QW-1·2·3(묶음 versioned 계약) + QW-4·5·6·7·8.
2. **신뢰성 핵심(M)**: PR-C1 → PR-C2 → PR-C3(computer-use), PR-B2(verified click, 보고 플래그) → PR-B5(PID-identity) → PR-B3(적응형 settle).
3. **계약 통일(M)**: PR-B1 + PR-C4를 양 CLI lockstep·SKILL.md 버전 명시.
4. **커버리지/속도(L, 조건부)**: PR-B4(cookie/upload/dialog), PR-B6(wait primitives), SB-6(dist 단일파일 → 프로파일 → 필요 시 데몬·세션 idMap 영속화 → 그 위 observe `--diff`), SB-4(tiktoken 재벤치, 별도 예산).

관련 파일(절대경로): `/Users/tykimos/Projects/cheliped-skills/browser/scripts/cheliped-cli.mjs`, `/Users/tykimos/Projects/cheliped-skills/browser/scripts/src/browser/controller.ts`, `/Users/tykimos/Projects/cheliped-skills/browser/scripts/src/browser/page.ts`, `/Users/tykimos/Projects/cheliped-skills/browser/scripts/src/dom/agent-dom.ts`, `/Users/tykimos/Projects/cheliped-skills/browser/scripts/src/dom/compressor.ts`, `/Users/tykimos/Projects/cheliped-skills/browser/scripts/src/api/cheliped.ts`, `/Users/tykimos/Projects/cheliped-skills/computer-use/scripts/computer-cli.mjs`.

---

## 8. Completeness Addendum — 누락·미경화 항목 (Critic)

> 본 부록의 모든 지적은 `/Users/tykimos/Projects/cheliped-skills` 실제 코드로 재검증했다. 로드맵 본문은 인용 사실이 정확하다(클릭 primary 경로 scrollIntoView 부재 controller.ts:471에만, security/session 게이트 cheliped.ts:43/59, 배치 break cheliped-cli.mjs:531, computer-use bare-object 붕괴 computer-cli.mjs:255 모두 확인). 아래는 **본문이 다루지 않았거나 약하게 닫은** 지점이다.

### 8.1 가장 큰 구멍 — computer-use의 임의 실행 표면이 위협모델 밖
SB-1은 computer-use를 '신뢰성 역전'의 1순위 무대로 삼는다. 그런데 `run-shell`(computer-cli.mjs:208–211)은 `/bin/sh -c <arg>`, `run-applescript`(203–206)는 임의 AppleScript를 그대로 실행한다 — 호스트 OS에 대한 사실상 RCE 표면이다. 로드맵의 보안 논의(SB-2/PR-B5)는 **브라우저 페이지 콘텐츠 위협**(promptInjection/exfiltration/allowlist)에만 한정돼, 가장 위험한 이 두 핸들러를 한 번도 언급하지 않는다.

- **조치(추가 PR-C5, S):** `run-shell`/`run-applescript`를 기본 비활성 → `--allow-shell` opt-in 게이트. 비활성 시 `E_DISABLED` 반환. 활성 시에도 호출을 envelope에 `audited:true`로 기록. 이는 "보안을 robust로 마케팅하지 않는다"(non-goal)와 모순되지 않으며, *호스트 손* 제품이 기본값으로 임의 셸을 여는 것 자체가 별개의 신뢰성 부채다.

### 8.2 verified-success '미탐 0'이 자기참조 측정
6장 False-positive-success rate의 측정 수단이 'PR-B2/PR-C1 회귀 스위트'다 — **목표 달성을 선언할 도구를 같은 PR이 만든다.** 독립 골든셋이 없으면 "미탐 0"은 반증 불가능한 주장이다.

- **조치:** PR과 **분리된** 라벨드 픽스처 데이터셋을 먼저 정의 — (a) 투명 오버레이 위 클릭, (b) `disabled`/`pointer-events:none` 요소, (c) off-screen 요소, (d) Accessibility 미인가, (e) blank frame(Screen Recording 미인가, dark-UI 대조군 포함). 각 케이스의 **기대 라벨**(true-fail vs true-pass)을 고정한 뒤 그 위에서 미탐률을 보고해야 수치가 의미를 갖는다.

### 8.3 가장 가까운 경쟁자(저토큰 a11y 계열)가 표에서 빠짐
2장 표는 vision(Anthropic CU/OpenAI CUA)만 토큰으로 압도하는 그림이다. 그러나 직접 경쟁 포지션인 **Chrome 공식 `chrome-devtools-mcp`**와 **Playwright MCP의 accessibility-tree(비스크린샷) 모드**는 Cheliped와 *동일한* "DOM/a11y 텍스트 → 저토큰" wedge를 노린다. SB-4 재벤치가 이들을 PRIMARY로 포함하지 않으면 "strictly better"는 가장 가까운 적을 빼고 선언한 것이 된다.

- **조치:** 비교표·SB-4 벤치 대상에 두 a11y-text 경쟁자 추가. 이들 대비 Cheliped의 차별점은 토큰 절대량이 아니라 **numeric agentId 밀도 + WebSquare/IME 정합 + $0 search**임을 명시 — 토큰 단독 우위 주장은 vision 대비로 국한.

### 8.4 출력 계약 통일의 실제 변경량 과소
PR-B1은 `{cmd, ok, result?, error?}`로 통일한다. 현 코드는 **두 스킬의 중첩 구조가 다르다**: browser는 `{cmd, result}`(cheliped-cli.mjs:524) — 한 단계 래핑; computer-use는 `{cmd, ...result}`(computer-cli.mjs:250) — `success`가 최상위로 **평탄화**. 즉 computer-use lockstep은 거의 모든 핸들러의 반환 형태(`return { success:true, ... }`)를 손대야 한다. 본문의 "현 browser는 이미 array, computer-use bare-object만 제거"는 평탄/래핑 비대칭을 가린다.

- **조치:** 마이그레이션 범위에 "computer-use 25개 핸들러의 success-key 평탄화 제거 + result 서브객체 도입"을 명시. SKILL.md 버전 범프와 함께 양 스킬 result 스키마를 **단일 JSON Schema 문서**로 고정.

### 8.5 한국어 에러의 마이그레이션 규모
PR-B1은 "thrown 메시지 영어 통일"을 분류기로 처리한다 했으나, executeCommand의 **인자 검증 에러가 전부 한국어 하드코딩**(cheliped-cli.mjs:125,141,148,164,172… 수십 곳)이고 연결 실패/usage도 한국어(474–477,542–543)다. 이들은 `e.message` 분류기 *이전*에 던져지는 pre-flight 문자열이라 분류기로 잡히지 않는다.

- **조치:** error-code 매핑을 분류기가 아니라 **throw 지점에 typed error로** 우선 심는다(본문도 점진 전환을 언급하나 한국어 pre-flight 분량을 과소평가). 최소한 `E_BAD_ARG` 계열을 검증 분기에 직접 부여.

### 8.6 토큰 레버 미점검 — fill-human / per-char 경로
DIFF-2 반증으로 기본 `fill`이 single-write임을 밝혔다면, **실제 per-char 비용을 지는 `fill-human`/`fillHuman`**(cheliped-cli.mjs:153–158)·`type`·`pressKey`가 언제 호출되는지, 기본 경로 대비 토큰/지연이 얼마인지가 짝으로 다뤄져야 한다. 현재 침묵이라 "토큰 해자"의 *내부 누수*(에이전트가 fill 대신 fill-human을 고를 때)가 측정 밖이다.

- **조치:** 6장에 "fill vs fill-human 선택률 및 per-call 지연" 보조 메트릭 추가. SKILL.md에서 fill-human은 anti-bot 우회 전용임을 명시해 기본 선택을 fill로 유도.

### 8.7 좌표계 단위 비일관 — fallback이 아니라 1차 경로
PR-C2는 sips fallback의 PIXEL 반환(computer-cli.mjs:89)을 정정한다 했다. 그러나 **1차 경로 `screen-size`도 단위가 조건부**다: 'UI Looks like'(point) 우선, 없으면 'Resolution'(native pixel) fallback(82–85). cliclick은 point 좌표를 받으므로, native 줄만 노출되는 디스플레이에선 click 좌표가 scale 배수만큼 어긋난다.

- **조치:** PR-C2에 "1차 경로도 항상 point로 정규화(native만 있으면 scale로 나눠 point 환산하고 `unit:'point'` 명시)"를 포함. 좌표를 반환하는 모든 명령에 `unit` 필드 부착.

### 8.8 상태 영속화의 동시성 — 데몬 없는 idMap은 경합
SB-6은 cross-call agentId를 "세션파일 idMap 영속화로 데몬 없이" 푼다 한다. 그러나 `saveSession`은 atomic rename 없는 `writeFileSync`(cheliped-cli.mjs:66)이고, `--session`을 공유한 두 동시 호출은 같은 파일을 read-modify-write 한다. 데몬 없이 영속 상태를 늘리면 손상·lost-update가 생긴다.

- **조치:** idMap 영속화 도입 시 (a) `writeFile`+atomic rename(temp→rename), (b) 파일 lock 또는 단조 증가 버전 필드로 stale write 거부. 동시성 보장이 없으면 idMap 영속화는 데몬(SB-6 후반) 전까지 **보류**가 더 안전 — 본문의 "데몬 없이 우선 해결"은 이 조건을 달아야 한다.

### 8.9 SB-6 데몬 ROI에 baseline 수치 부재
"먼저 프로파일"은 옳으나 본문 어디에도 현재 Node-startup + CDP reconnect의 **실측 분해**(혹은 추정)가 없다. 무엇을 줄이는지 모르는 채 데몬 조건부 채택을 적으면 의사결정 기준이 공허하다.

- **조치:** 배포 시퀀스 1단계 직후 `time node cheliped-cli.mjs '[{"cmd":"observe"}]'`의 cold/warm 분해(프로세스 부팅 / dynamic import / reconnect / observe)를 한 번 측정해 SB-6 게이트의 임계치(예: reconnect가 총시간의 ≥40%일 때만 데몬)를 수치로 고정.

### 8.10 배포 시퀀스 보강 제안
- **즉시(S) 묶음에 PR-C5(임의 실행 게이트) 추가** — 8.1은 코드 변경이 작고 위험이 크다.
- **2단계 진입 전 8.2 골든셋 정의를 선행조건으로** 명시 — 그래야 PR-B2/PR-C1의 성공 선언이 검증 가능.