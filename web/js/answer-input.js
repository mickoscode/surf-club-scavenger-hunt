// Keeps what a player types in a number question to digits (and one decimal point for decimal questions). Pure, so it is
// tested in Node. The server checks again; this is only so a number field cannot be typed into with letters.
export function sanitizeAnswer(type, value) {
  if (type === 'whole-number') return value.replace(/\D/g, '');
  if (type === 'decimal') {
    const cleaned = value.replace(/[^\d.]/g, '');
    const firstPoint = cleaned.indexOf('.');
    return firstPoint === -1 ? cleaned : cleaned.slice(0, firstPoint + 1) + cleaned.slice(firstPoint + 1).replace(/\./g, '');
  }
  return value;
}
