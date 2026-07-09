export function average(values: number[]) {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (filtered.length === 0) return null;
  return Math.round(filtered.reduce((sum, value) => sum + value, 0) / filtered.length);
}

export function p95(values: number[]) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const index = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

export function ratio(numerator: number, denominator: number) {
  return denominator === 0 ? null : numerator / denominator;
}
