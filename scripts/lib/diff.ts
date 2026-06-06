/**
 * Annotate a unified diff with new-file line numbers so the model can refer to
 * them as `[L42]` and we can post inline comments on the correct lines.
 */
export function annotateDiff(diff: string): string {
  const lines = diff.split("\n");
  const out: string[] = [];
  let newLine = 0;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const m = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
      if (m) newLine = parseInt(m[1], 10) - 1;
      out.push(line);
      continue;
    }
    if (line.startsWith("-") || line.startsWith("\\")) {
      out.push(line);
      continue;
    }
    newLine++;
    if (line.startsWith("+")) {
      out.push(`+[L${newLine}] ${line.slice(1)}`);
    } else {
      const rest = line.length > 1 ? ` ${line.slice(1)}` : "";
      out.push(` [L${newLine}]${rest}`);
    }
  }

  return out.join("\n");
}
