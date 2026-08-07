/** Neutralize CSV/Excel formula injection: cells beginning with = + - @ TAB CR. */
export function neutralizeCell(v) {
  if (typeof v !== 'string') return v;
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}
