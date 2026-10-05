/** Removes Vietnamese diacritics: "Hoa quả" -> "Hoa qua", "Đà" -> "Da". */
export function stripDiacritics(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/** The single normal form used for both stored search text and user queries. */
export function normalizeForSearch(text: string): string {
  return stripDiacritics(text).toLowerCase().replace(/\s+/g, ' ').trim();
}
