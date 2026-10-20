export const DIGEST_MAX_LINES = 20;
export const DIGEST_MAX_CHARS = 4000;

const more = (n: number): string => `… và ${n} tin khác`;

/** "• msg" lines, cut at 20 lines / `maxChars` characters, then "… và N tin khác". */
export function digestItems(
  messages: string[],
  maxChars = DIGEST_MAX_CHARS,
): string {
  const lines: string[] = [];
  let length = 0;
  for (const [index, message] of messages.entries()) {
    const rest = messages.length - index;
    const line = `• ${message}`;
    // Room kept for the closing line if this one is the last that fits.
    const tail = rest - 1 > 0 ? `\n${more(rest - 1)}`.length : 0;
    const separator = lines.length > 0 ? 1 : 0;
    if (
      lines.length === DIGEST_MAX_LINES ||
      length + separator + line.length + tail > maxChars
    ) {
      if (lines.length === 0) {
        // A single message that is too long on its own: cut it.
        const room = Math.max(0, maxChars - tail - 1);
        lines.push(`${line.slice(0, room)}…`);
        if (rest - 1 > 0) lines.push(more(rest - 1));
      } else {
        lines.push(more(rest));
      }
      return lines.join('\n');
    }
    lines.push(line);
    length += separator + line.length;
  }
  return lines.join('\n');
}
