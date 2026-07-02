# Go-Live 가이드 (Telegram + WordPress)

코드는 준비 완료. 아래 2개 외부 리소스만 만들면 `node pipeline/run.mjs`로 실발행됩니다.
카드뉴스는 **한국어만** 텔레그램에 발송하고, 블로그 글은 KO+EN 둘 다 발행됩니다.

---

## 1. Telegram 봇 + 그룹 (무료, ~5분)

1. 텔레그램에서 **@BotFather** 대화 → `/newbot` → 봇 이름 + 사용자명 입력 → **봇 토큰** 받기
   → `.env`의 `TELEGRAM_BOT_TOKEN`
2. 카드뉴스를 받을 **그룹(또는 채널)** 생성 → 만든 봇을 멤버로 추가 (채널이면 관리자로)
3. **그룹 chat id 얻기:**
   - 그룹에 아무 메시지나 전송
   - 브라우저에서 `https://api.telegram.org/bot<봇토큰>/getUpdates` 열기
   - 응답에서 `"chat":{"id":-100XXXXXXXXXX ...}` 의 숫자(보통 음수) → `.env`의 `TELEGRAM_GROUP_ID`
   - (대안: 그룹에 `@getidsbot` 또는 `@RawDataBot` 잠깐 추가해 id 확인 후 제거)
4. 확인: `node scripts/live-check.mjs --send-card` → 그룹에 샘플 만화 카드 1장 도착하면 OK

---

## 2. WordPress 사이트 (스포츠 전용, VOBET와 별개)

> ⚠ 브랜드 중립 사이트 — 도메인·콘텐츠에 베팅/브랜드 언급 없음. **VOBET와 다른 도메인**으로.

**가장 빠른 경로:** VOBET와 동일 cPanel 호스팅 계정에 **애드온(또는 서브)도메인**으로 새 WP 설치
→ SSH 접속 정보는 기존과 동일, `WP_PATH`만 다른 디렉터리. (별도 WP 설치라 사이트는 완전히 분리됨)

체크리스트:
1. 브랜드 중립 **도메인** 결정 (예: 스포츠 뉴스성 이름)
2. **WordPress 설치** (애드온 도메인 디렉터리 → 그게 `WP_PATH`, 예 `/home/<acct>/sportsblog`)
3. 플러그인 설치·활성화:
   - **Polylang** → 언어에 **한국어(ko) + English(en)** 추가
   - **Rank Math SEO**
4. **카테고리 생성**(파이프라인이 자동 생성도 하지만 미리 만들어두면 안전):
   - KO: `축구` `야구` `농구` / EN: `Football` `Baseball` `Basketball`
5. **법적 페이지**: 면책(disclaimer) + 출처 정책 페이지 (애그리게이터 저작권 안전장치)
6. **SSH/wp-cli 접속** 확인 (`ssh <host>` 후 `wp --info`)
7. `.env` 채우기: `WP_SSH_HOST` / `WP_SSH_USER` / (`WP_SSH_KEY_PATH` 또는 `WP_SSH_KEY` 또는 `WP_SSH_PASSWORD`) / `WP_PATH`
8. 확인: `node scripts/live-check.mjs` → "WordPress: connected" + Polylang/Rank Math ✅

---

## 3. 실발행

```bash
# 1) 시크릿 채운 뒤 프리플라이트 (읽기전용 + 샘플카드)
node scripts/live-check.mjs --send-card

# 2) 실제 1회 발행 (이벤트 수 제한 권장)
MAX_EVENTS_PER_RUN=2 node pipeline/run.mjs
```
- 합성 LLM: `ANTHROPIC_API_KEY` 있으면 Claude, 없으면 `GEMINI_API_KEY`로 동작
- 만화 카드 아트: `GEMINI_API_KEY` 필요 (gemini-2.5-flash-image)
- WP/Telegram 시크릿 없으면 해당 단계는 mock으로 폴백 (안전)

## 4. 무인 일일 발행 (다음 단계)
GitHub 레포 생성 → Actions 시크릿 등록 → `.github/workflows/daily-aggregate.yml` 크론 활성화.
(레포 분리 + Actions 시크릿은 별도 단계 — 위 라이브 발행이 검증된 뒤 진행 권장)
