// Match intel provider (①). Live impl would call a sports-data API (form, injuries, H2H);
// fixture impl returns recorded intel so the dry-run is deterministic.
//
// intel shape: { homeForm, awayForm, injury, h2h, sourceText }
//   sourceText is the grounding corpus the fact-gate checks the synthesized note against.

export function liveIntel(env = process.env) {
  return {
    async get(/* fixture */) {
      const hasKey = env.SPORTSDATA_API_KEY || env.SERPER_API_KEY;
      if (!hasKey) throw new Error('Intel not wired: set a sports-data source key (see SECRETS.md)');
      // TODO(live): fetch form/injuries/H2H from a sports-data API or synthesize from recent
      // scraped news, and assemble sourceText as the grounding corpus.
      throw new Error('liveIntel.get not implemented for MVP — fixtureIntel is used in dry-run');
    },
  };
}

export function fixtureIntel(map) {
  return {
    async get(fixture) {
      const v = map[fixture.id];
      if (!v) throw new Error(`fixtureIntel: no intel for fixture ${fixture.id}`);
      return v;
    },
  };
}

// Upcoming-fixtures provider (schedule). Live = schedule API; fixture = recorded list.
export function liveSchedule(env = process.env) {
  return {
    async upcoming(/* { sports, date } */) {
      if (!(env.SPORTSDATA_API_KEY || env.SERPER_API_KEY)) {
        throw new Error('Schedule not wired: set a sports-data source key (see SECRETS.md)');
      }
      throw new Error('liveSchedule.upcoming not implemented for MVP — fixtureSchedule is used in dry-run');
    },
  };
}

export function fixtureSchedule(fixtures) {
  return { async upcoming() { return fixtures; } };
}
