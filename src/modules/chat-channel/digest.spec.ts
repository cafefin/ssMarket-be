import { DIGEST_MAX_CHARS, digestItems } from './digest.js';

describe('digestItems', () => {
  it('lists messages', () => {
    expect(digestItems(['a', 'b'])).toBe('• a\n• b');
  });

  it('stops at 20 lines', () => {
    const result = digestItems(Array.from({ length: 25 }, (_, i) => `m${i}`));
    const lines = result.split('\n');
    expect(lines).toHaveLength(21);
    expect(lines[20]).toBe('… và 5 tin khác');
  });

  it('stops before passing the character limit, counting the last line', () => {
    const result = digestItems(Array.from({ length: 10 }, () => 'x'.repeat(500)));
    expect(result.length).toBeLessThanOrEqual(DIGEST_MAX_CHARS);
    const lines = result.split('\n');
    expect(lines.at(-1)).toBe(`… và ${10 - (lines.length - 1)} tin khác`);
    expect(lines.length).toBeLessThan(10);
  });

  it('cuts one message that is too long', () => {
    const result = digestItems(['y'.repeat(5000)]);
    expect(result.length).toBeLessThanOrEqual(DIGEST_MAX_CHARS);
    expect(result.length).toBeGreaterThan(0);
    expect(result.endsWith('…')).toBe(true);
  });

  it('cuts a long first message and counts the rest', () => {
    const result = digestItems(['y'.repeat(5000), 'z']);
    expect(result.length).toBeLessThanOrEqual(DIGEST_MAX_CHARS);
    expect(result.endsWith('\n… và 1 tin khác')).toBe(true);
  });

  it('keeps within a smaller budget', () => {
    const result = digestItems(
      Array.from({ length: 10 }, () => 'x'.repeat(50)),
      200,
    );
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result.split('\n').at(-1)).toMatch(/^… và \d+ tin khác$/);
  });

  it('cuts one message to a smaller budget', () => {
    const result = digestItems(['y'.repeat(500), 'z'], 100);
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result.endsWith('\n… và 1 tin khác')).toBe(true);
  });
});
