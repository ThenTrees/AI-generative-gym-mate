import dayjs from "dayjs";

export function convertDateFormat(dateStr: string): string {
  return dayjs(dateStr, "DD/MM/YYYY").format("YYYY-MM-DD");
}
