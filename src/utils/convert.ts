import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
// active plugin dayjs
dayjs.extend(customParseFormat);

export function convertDateFormat(dateStr: string): string {
  const parsedDate = dayjs(dateStr, "DD/MM/YYYY", true);

  return parsedDate.isValid() ? parsedDate.format("YYYY-MM-DD") : "";
}
