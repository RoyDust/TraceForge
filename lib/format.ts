export function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function formatFullDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function formatNumber(value: number | bigint | null | undefined) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("zh-CN").format(value);
}

export function formatMs(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${formatNumber(value)} ms`;
}

export function formatMoney(value: { toString(): string } | string | number | null | undefined) {
  if (value === null || value === undefined) return "—";
  const n = Number(value.toString());
  if (!Number.isFinite(n)) return value.toString();
  if (n === 0) return "0";
  return n < 0.0001 ? n.toFixed(8) : n.toFixed(6);
}

export function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export function compactId(id: string) {
  return id.slice(0, 8);
}
