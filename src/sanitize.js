/**
 * Neutralize CSV/Excel formula injection: cells that (after optional leading
 * whitespace) begin with = + - @ get an apostrophe prefix so spreadsheet apps
 * treat them as text. Leading whitespace is included because Excel trims it and
 * would still evaluate e.g. " =cmd()".
 */
export function neutralizeCell(v) {
  if (typeof v !== 'string') return v;
  return /^[\s=+\-@]/.test(v) ? `'${v}` : v;
}
