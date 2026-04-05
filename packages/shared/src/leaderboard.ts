export interface LeaderboardCandidate {
  readonly hiddenScore: number;
}

export function shouldReplaceLeaderboardEntry(
  current: LeaderboardCandidate | null,
  candidate: LeaderboardCandidate
): boolean {
  if (!current) {
    return true;
  }

  return candidate.hiddenScore > current.hiddenScore;
}
