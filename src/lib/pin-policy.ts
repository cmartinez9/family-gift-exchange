export function pinProblem(pin: string, confirmation: string) {
  if (!/^[0-9]{4}$/.test(pin)) return "pinLength";
  if (pin !== confirmation) return "pinMatch";
  if (/^([0-9])\1\1\1$/.test(pin) || /^([0-9]{2})\1$/.test(pin)
    || "0123456789012".includes(pin) || "9876543210987".includes(pin)
    || ["0852", "2580", "6969"].includes(pin)) return "pinPattern";

  const first = Number(pin.slice(0, 2));
  const second = Number(pin.slice(2));
  const isDate = (month: number, date: number) => month >= 1 && month <= 12
    && date >= 1 && date <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (isDate(first, second) || isDate(second, first) || (Number(pin) >= 1900 && Number(pin) <= 2099)) {
    return "pinDate";
  }
  return null;
}
