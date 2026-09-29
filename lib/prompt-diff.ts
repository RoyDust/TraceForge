export type DiffLine = {
  type: "same" | "added" | "removed";
  text: string;
};

export function diffLines(base: string, compare: string): DiffLine[] {
  const baseLines = base.split(/\r?\n/);
  const compareLines = compare.split(/\r?\n/);
  const max = Math.max(baseLines.length, compareLines.length);
  const lines: DiffLine[] = [];

  for (let index = 0; index < max; index += 1) {
    const left = baseLines[index];
    const right = compareLines[index];
    if (left === right) {
      lines.push({ type: "same", text: left ?? "" });
      continue;
    }
    if (left !== undefined) lines.push({ type: "removed", text: left });
    if (right !== undefined) lines.push({ type: "added", text: right });
  }

  return lines;
}

export function diffSummary(lines: DiffLine[]) {
  return lines.reduce(
    (summary, line) => {
      if (line.type === "added") summary.added += 1;
      if (line.type === "removed") summary.removed += 1;
      if (line.type === "same") summary.same += 1;
      return summary;
    },
    { added: 0, removed: 0, same: 0 },
  );
}
