/** Theme-aware categorical colors shared by chart marks and legends. */
export function getColor(index: number) {
  return `var(--chart-series-${Math.abs(index) % 10})`;
}
