// Calendar boundaries keep full leap years and month-end ranges inclusive.
export function diversityWindowDays(start: Date, end: Date) {
  const afterMonths = (months: number) => {
    const boundary = new Date(start);
    boundary.setUTCDate(1);
    boundary.setUTCMonth(boundary.getUTCMonth() + months);
    const lastDay = new Date(
      Date.UTC(boundary.getUTCFullYear(), boundary.getUTCMonth() + 1, 0),
    ).getUTCDate();
    boundary.setUTCDate(Math.min(start.getUTCDate(), lastDay));
    return boundary.getTime();
  };
  if (end.getTime() < afterMonths(6)) return 7;
  if (end.getTime() <= afterMonths(12)) return 14;
  if (end.getTime() <= afterMonths(36)) return 30;
  if (end.getTime() <= afterMonths(120)) return 90;
  return 180;
}
