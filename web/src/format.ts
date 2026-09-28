const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

export function formatPeriod(period: string): string {
  const month = MONTHS[Number(period.slice(5, 7)) - 1] ?? period;
  return `${month} ${period.slice(0, 4)}`;
}

export function formatSourceTime(iso: string): string {
  const date = new Date(iso);
  const month = (MONTHS[date.getUTCMonth()] ?? "").slice(0, 3);
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${month} ${date.getUTCDate()}, ${hours}:${minutes} UTC`;
}
