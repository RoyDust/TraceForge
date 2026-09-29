export type UiValueSource = "live" | "derived" | "mock";

export type SourcedValue<T> = {
  value: T;
  source: UiValueSource;
};

export function sourced<T>(value: T, source: UiValueSource): SourcedValue<T> {
  return { value, source };
}

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

export function deterministicNumber(seed: string, min: number, max: number) {
  if (max <= min) return min;
  const hash = hashText(seed);
  return min + (hash % (max - min + 1));
}

export function mockLiveIngest(seed: string | null | undefined) {
  const value = deterministicNumber(seed ?? "traceforge", 900, 12400);
  return sourced(`${(value / 1000).toFixed(1)}千次/秒`, "mock");
}

export function mockFreshness(seed: string | null | undefined) {
  return sourced(`${deterministicNumber(seed ?? "fresh", 3, 59)} 秒前`, "mock");
}

export function mockEnvironment() {
  return sourced("生产", "mock");
}
