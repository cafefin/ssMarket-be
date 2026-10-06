import { crc16CcittFalse } from './crc16.js';
import { buildVietQrPayload, type VietQrInput } from './vietqr.js';

describe('crc16CcittFalse', () => {
  it('matches the published check value for the algorithm', () => {
    expect(crc16CcittFalse('123456789')).toBe('29B1');
  });

  it('is the initial value for empty input and always four characters', () => {
    expect(crc16CcittFalse('')).toBe('FFFF');
    for (const text of ['a', 'ab', 'abc', 'SSM7K2Q9X', '000201']) {
      expect(crc16CcittFalse(text)).toMatch(/^[0-9A-F]{4}$/);
    }
  });
});

/** Reads the top-level id/length/value fields of an EMV QR payload. */
function parse(payload: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let position = 0;
  while (position < payload.length) {
    const id = payload.slice(position, position + 2);
    const length = Number(payload.slice(position + 2, position + 4));
    fields[id] = payload.slice(position + 4, position + 4 + length);
    position += 4 + length;
  }
  return fields;
}

const input = (overrides: Partial<VietQrInput> = {}): VietQrInput => ({
  bankBin: '970436',
  accountNumber: '0123456789',
  amount: 122500,
  content: 'SSM7K2Q9X',
  ...overrides,
});

describe('buildVietQrPayload', () => {
  it('produces well-formed fields for a dynamic VND transfer', () => {
    const fields = parse(buildVietQrPayload(input()));

    expect(fields).toMatchObject({
      '00': '01',
      '01': '12',
      '53': '704',
      '54': '122500',
      '58': 'VN',
    });
    // Object keys that look like integers ("38") are enumerated first, so sort.
    expect(Object.keys(fields).sort()).toEqual([
      '00',
      '01',
      '38',
      '53',
      '54',
      '58',
      '62',
      '63',
    ]);
  });

  it('addresses the transfer to the bank account through NAPAS', () => {
    const merchant = parse(parse(buildVietQrPayload(input()))['38']);

    expect(merchant['00']).toBe('A000000727');
    expect(merchant['02']).toBe('QRIBFTTA');
    expect(parse(merchant['01'])).toEqual({
      '00': '970436',
      '01': '0123456789',
    });
  });

  it('carries the order code as the transfer content', () => {
    const additional = parse(parse(buildVietQrPayload(input()))['62']);

    expect(additional).toEqual({ '08': 'SSM7K2Q9X' });
  });

  it('ends with the CRC of everything before it', () => {
    const payload = buildVietQrPayload(input());
    const body = payload.slice(0, -4);

    expect(body.endsWith('6304')).toBe(true);
    expect(payload.slice(-4)).toBe(crc16CcittFalse(body));
  });

  it.each(['1234', '0123456789', '1234567890123456789'])(
    'keeps field lengths right for the account number %s',
    (accountNumber) => {
      const merchant = parse(
        parse(buildVietQrPayload(input({ accountNumber })))['38'],
      );

      expect(parse(merchant['01'])['01']).toBe(accountNumber);
    },
  );

  it('changes when the amount or the content changes', () => {
    const base = buildVietQrPayload(input());

    expect(buildVietQrPayload(input({ amount: 122501 }))).not.toBe(base);
    expect(buildVietQrPayload(input({ content: 'SSM7K2Q9Y' }))).not.toBe(base);
  });

  it('is deterministic', () => {
    expect(buildVietQrPayload(input())).toBe(buildVietQrPayload(input()));
  });

  it.each<[string, Partial<VietQrInput>]>([
    ['a bank code that is not 6 digits', { bankBin: '97043' }],
    ['an account number with a space', { accountNumber: '0123 456' }],
    ['an empty account number', { accountNumber: '' }],
    ['a zero amount', { amount: 0 }],
    ['a negative amount', { amount: -5 }],
    ['a fractional amount', { amount: 1000.5 }],
    ['lower-case content', { content: 'ssm7k2q9x' }],
    ['content with a space', { content: 'SSM 123' }],
    ['content that is too long', { content: 'A'.repeat(26) }],
  ])('refuses %s', (_label, overrides) => {
    expect(() => buildVietQrPayload(input(overrides))).toThrow();
  });
});
