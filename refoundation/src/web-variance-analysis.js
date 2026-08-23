function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function jaccard(left, right) {
  const union = new Set([...left, ...right]);
  if (!union.size) return 1;
  let shared = 0;
  for (const value of left) if (right.has(value)) shared += 1;
  return shared / union.size;
}

export function rankedCandidateAgreement(runs, limit = 8) {
  const ranked = runs.map((run) => (run.candidates ?? []).slice(0, limit).map((candidate) => candidate.url));
  const pairs = [];
  for (let left = 0; left < ranked.length; left += 1) {
    for (let right = left + 1; right < ranked.length; right += 1) {
      const leftUrls = ranked[left]; const rightUrls = ranked[right];
      const width = Math.max(leftUrls.length, rightUrls.length, 1);
      let sameRank = 0;
      for (let index = 0; index < width; index += 1) if (leftUrls[index] && leftUrls[index] === rightUrls[index]) sameRank += 1;
      pairs.push({
        top1Same: Boolean(leftUrls[0] && leftUrls[0] === rightUrls[0]),
        setJaccard: jaccard(new Set(leftUrls), new Set(rightUrls)),
        exactRankOverlap: sameRank / width,
      });
    }
  }
  const union = new Set(ranked.flat());
  return {
    runs: ranked.length, comparedPairs: pairs.length, limit,
    top1Agreement: average(pairs.map((pair) => Number(pair.top1Same))),
    meanSetJaccard: average(pairs.map((pair) => pair.setJaccard)),
    meanExactRankOverlap: average(pairs.map((pair) => pair.exactRankOverlap)),
    unionCandidateCount: union.size,
    candidateCounts: ranked.map((urls) => urls.length),
  };
}

export function queryPlanAgreement(plans) {
  const normalized = plans.map((plan) => new Set((plan.queries ?? []).map((query) => (
    String(query).toLowerCase().replace(/\s+/gu, ' ').trim()
  )).filter(Boolean)));
  const similarities = [];
  for (let left = 0; left < normalized.length; left += 1) {
    for (let right = left + 1; right < normalized.length; right += 1) {
      similarities.push(jaccard(normalized[left], normalized[right]));
    }
  }
  return {
    plans: normalized.length, comparedPairs: similarities.length,
    exactPlanAgreement: average(similarities.map((value) => Number(value === 1))),
    meanQuerySetJaccard: average(similarities),
    unionQueryCount: new Set(normalized.flatMap((queries) => [...queries])).size,
  };
}
