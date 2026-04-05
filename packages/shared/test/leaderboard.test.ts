import { describe, expect, it } from 'vitest';

import { shouldReplaceLeaderboardEntry } from '../src/leaderboard';

describe('shouldReplaceLeaderboardEntry', () => {
  it('creates the first entry when none exists', () => {
    expect(shouldReplaceLeaderboardEntry(null, { hiddenScore: 0.3 })).toBe(true);
  });

  it('replaces the entry when the new hidden score is higher', () => {
    expect(
      shouldReplaceLeaderboardEntry({ hiddenScore: 0.5 }, { hiddenScore: 0.8 })
    ).toBe(true);
  });

  it('keeps the current entry when the new hidden score is lower or equal', () => {
    expect(
      shouldReplaceLeaderboardEntry({ hiddenScore: 0.8 }, { hiddenScore: 0.4 })
    ).toBe(false);
    expect(
      shouldReplaceLeaderboardEntry({ hiddenScore: 0.8 }, { hiddenScore: 0.8 })
    ).toBe(false);
  });
});
