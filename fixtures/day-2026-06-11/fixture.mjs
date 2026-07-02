// Deterministic fixture day for the dry-run E2E gate. Exercises every stage:
//  - evt-football-trade: 2 outlets, same event -> collapses to 1 cluster (DEDUP-B);
//      grounded claims + original synthesis -> PUBLISHED (AC#1/#3/#5)
//  - evt-baseball-wrongscore: 2 sources say 2-1, article claims 3-0 -> fact-gate BLOCK (AC#2)
//  - evt-basketball-single: 1 source -> INELIGIBLE (multi-source requirement; degraded path)

export const rawItems = [
  // --- football: same event from two outlets (DEDUP-B collapse) ---
  {
    eventKey: 'evt-football-trade',
    sportKey: 'football',
    outlet: 'Reuters',
    url: 'https://reuters.test/a1',
    title: 'Brazil midfielder set for 80 million euro move to Manchester',
    text: 'Manchester club agreed an 80 million euro fee for the Brazil midfielder. Both clubs confirmed terms on Wednesday and a medical is planned.',
    publishedAt: '2026-06-11T08:00:00Z',
    entities: ['Manchester', 'Brazil midfielder'],
    eventType: 'transfer',
  },
  {
    eventKey: 'evt-football-trade',
    sportKey: 'football',
    outlet: 'AP',
    url: 'https://ap.test/b2',
    title: 'Manchester agree 80 million euro deal for Brazil midfielder',
    text: 'An 80 million euro agreement was reached between the two clubs for the Brazil international. The medical is scheduled this week.',
    publishedAt: '2026-06-11T08:30:00Z',
    entities: ['Manchester', 'Brazil midfielder'],
    eventType: 'transfer',
  },
  // --- baseball: wrong-score seed (fact-gate must BLOCK) ---
  {
    eventKey: 'evt-baseball-wrongscore',
    sportKey: 'baseball',
    outlet: 'WireA',
    url: 'https://wirea.test/c3',
    title: 'Home team win 2-1 on walk-off over visitors',
    text: 'The home team won 2-1 in extra innings. A walk-off single sealed the result.',
    publishedAt: '2026-06-11T09:00:00Z',
    entities: ['Home team', 'Visitors'],
    eventType: 'match_result',
  },
  {
    eventKey: 'evt-baseball-wrongscore',
    sportKey: 'baseball',
    outlet: 'WireB',
    url: 'https://wireb.test/c4',
    title: 'Walk-off single seals 2-1 home win over visitors',
    text: 'Final score 2-1. The closer earned the save in a tight contest.',
    publishedAt: '2026-06-11T09:20:00Z',
    entities: ['Home team', 'Visitors'],
    eventType: 'match_result',
  },
  // --- basketball: single source -> ineligible ---
  {
    eventKey: 'evt-basketball-single',
    sportKey: 'basketball',
    outlet: 'SoloDesk',
    url: 'https://solo.test/d5',
    title: 'Guard scores 40 in win',
    text: 'The guard scored 40 points to lead his team to victory.',
    publishedAt: '2026-06-11T10:00:00Z',
    entities: ['Guard'],
    eventType: 'game',
  },
];

// Synthesized articles (original wording — NOT copied from sources) + extracted claims.
export const fixtures = {
  synth: {
    'evt-football-trade:ko': {
      title: '브라질 미드필더, 8천만 유로 이적 합의',
      body: '두 구단이 브라질 국가대표 미드필더 영입에 합의했다. 이적료는 80 million 유로 규모로 전해졌다. 메디컬 테스트가 이번 주 예정돼 있다.',
      claimMap: [{ claim: '이적료 80 million 유로', source_urls: ['https://reuters.test/a1', 'https://ap.test/b2'] }],
    },
    'evt-football-trade:en': {
      title: 'Brazil midfielder agrees record move',
      body: 'A leading European side has reached an agreement to sign the Brazil international. Reporting puts the fee around 80 million euros, with a medical expected shortly.',
      claimMap: [{ claim: 'fee around 80 million', source_urls: ['https://reuters.test/a1'] }],
    },
    'evt-baseball-wrongscore:ko': {
      title: '홈팀 3-0 완승',
      body: '홈팀이 3-0으로 승리하며 시리즈 분위기를 가져왔다.',
      claimMap: [{ claim: '최종 스코어 3-0', source_urls: ['https://wirea.test/c3'] }],
    },
    'evt-baseball-wrongscore:en': {
      title: 'Home team wins 3-0',
      body: 'The home team cruised to a 3-0 victory.',
      claimMap: [{ claim: 'final 3-0', source_urls: ['https://wirea.test/c3'] }],
    },
  },
  claims: {
    // Claims are extracted from the ENGLISH article and grounded against the English sources.
    // football: all grounded in the English source corpus (80 million; Manchester)
    'evt-football-trade:en': [
      { type: 'fee', text: '80 million euros', normalized_value: '80 million', loadBearing: true },
      { type: 'team', text: 'Manchester', normalized_value: 'Manchester', loadBearing: false },
    ],
    // baseball: load-bearing score claim 3-0 is NOT in the corpus (which says 2-1) -> BLOCK
    'evt-baseball-wrongscore:en': [
      { type: 'score', text: '3-0', normalized_value: '3-0', loadBearing: true },
    ],
  },
  // ① pre-match notes keyed by fixture id. fx-1 grounded -> card built; fx-2 has a wrong
  // injury claim (player not in intel) -> fact-gate BLOCKS the pre-match card.
  prematch: {
    'fx-epl-1': {
      whatToWatch: '토트넘이 최근 4경기 무패 흐름 속에 홈에서 첼시를 맞이한다. 첼시 핵심 수비수 결장이 변수다.',
      claims: [
        { type: 'team', text: '토트넘 무패 흐름', normalized_value: 'Tottenham', loadBearing: false },
        { type: 'player', text: '첼시 수비수 결장', normalized_value: 'Reece James', loadBearing: true },
      ],
    },
    'fx-epl-2': {
      whatToWatch: '리버풀이 아스널 원정에 나선다. 손흥민 결장이 결정적이다.',
      // WRONG: "손흥민/Son" is NOT in this fixture's intel -> ungrounded load-bearing -> BLOCK
      claims: [
        { type: 'player', text: '손흥민 결장', normalized_value: 'Son Heung-min', loadBearing: true },
      ],
    },
  },
};

// ① upcoming fixtures (schedule) for the pre-match path.
export const schedule = [
  { id: 'fx-epl-1', sportKey: 'football', competition: 'EPL', kickoff: '6/14 23:30', home: 'Tottenham', away: 'Chelsea' },
  { id: 'fx-epl-2', sportKey: 'football', competition: 'EPL', kickoff: '6/15 01:00', home: 'Arsenal', away: 'Liverpool' },
];

// ① intel per fixture. sourceText is the grounding corpus the note's claims are checked against.
export const intel = {
  'fx-epl-1': {
    homeForm: 'WWDWW', awayForm: 'LWDLW', injury: 'Chelsea: Reece James 결장 (햄스트링)',
    h2h: 'Tottenham 3-1-2 Chelsea',
    sourceText: 'Tottenham are unbeaten in their last four matches. Chelsea defender Reece James is out with a hamstring injury. Spurs host at home.',
  },
  'fx-epl-2': {
    homeForm: 'WDWWL', awayForm: 'WWWDW', injury: 'Arsenal: 주요 결장 없음',
    h2h: 'Arsenal 2-2-2 Liverpool',
    sourceText: 'Liverpool travel to Arsenal in strong form. No major injuries reported for either side. Arsenal play at home.',
  },
};

// ② subscriptions fixture: a follower of Tottenham (KO) and one of "Brazil midfielder" (EN).
export const subscriptions = [
  { chatId: '1001', follows: ['Tottenham', '손흥민'], lang: 'ko' },
  { chatId: '1002', follows: ['Brazil midfielder'], lang: 'en' },
];
