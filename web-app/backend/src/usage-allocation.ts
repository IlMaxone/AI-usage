function round(value: number, digits: number) { const factor = 10 ** digits; return Math.round((value + Number.EPSILON) * factor) / factor; }

export interface WindowUsageInput {
  usedPct: number;
  endingUsedPct: number;
  mode: 'CONSTANT' | 'SEGMENT';
  capturedAt: Date | string;
}

export function allocateWindowUsage(values: WindowUsageInput[]) {
  const allocations = Array<number>(values.length).fill(0);
  const ordered = values
    .map((value, index) => ({ ...value, index }))
    .sort((left, right) => new Date(left.capturedAt).getTime() - new Date(right.capturedAt).getTime());
  let previousCumulativePct: number | null = null;
  for (const item of ordered) {
    const usedPct = Math.min(100, Math.max(0, Number(item.usedPct)));
    const endingUsedPct = Math.min(100, Math.max(0, Number(item.endingUsedPct)));
    if (item.mode === 'SEGMENT') {
      allocations[item.index] = usedPct;
    } else {
      allocations[item.index] = previousCumulativePct === null || endingUsedPct < previousCumulativePct
        ? endingUsedPct
        : endingUsedPct - previousCumulativePct;
    }
    previousCumulativePct = endingUsedPct;
  }
  const normalizedAllocations = allocations.map((value) => round(Math.max(0, value), 8));
  const rawUsedPct = values.reduce((sum, value) => sum + Math.max(0, Number(value.usedPct)), 0);
  const attributedUsedPct = normalizedAllocations.reduce((sum, value) => sum + value, 0);
  return {
    rawUsedPct: round(rawUsedPct, 4),
    attributedUsedPct: round(attributedUsedPct, 4),
    allocations: normalizedAllocations,
  };
}

export function groupByWindow<T extends { fiveHourResetsAt: Date | string | null }>(values: T[]) {
  const groups: Array<{ anchor: number | null; records: T[] }> = [];
  for (const item of values) {
    const time = item.fiveHourResetsAt ? new Date(item.fiveHourResetsAt).getTime() : null;
    const group = time === null ? undefined : groups.find((group) => group.anchor !== null && Math.abs(group.anchor - time) <= 60 * 60_000);
    if (group) group.records.push(item); else groups.push({ anchor: time, records: [item] });
  }
  return groups;
}

export function projectUsageShares(values: number[]) {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (!total) return values.map(() => 0);
  const exact = values.map((value) => Math.max(0, value) / total * 10000);
  const cents = exact.map(Math.floor);
  const order = exact.map((value, index) => ({ index, remainder: value - cents[index]! })).sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const remaining = 10000 - cents.reduce((sum, value) => sum + value, 0);
  for (let i = 0; i < remaining; i++) cents[order[i]!.index]!++;
  return cents.map((value) => value / 100);
}
