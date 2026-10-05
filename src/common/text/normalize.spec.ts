import { normalizeForSearch, stripDiacritics } from './normalize.js';

describe('stripDiacritics', () => {
  it.each([
    ['Hoa quả tươi', 'Hoa qua tuoi'],
    ['Đường Đà Nẵng', 'Duong Da Nang'],
    ['bưởi, ổi, nhãn', 'buoi, oi, nhan'],
    ['Loa JBL', 'Loa JBL'],
    ['', ''],
  ])('%j -> %j', (input, expected) => {
    expect(stripDiacritics(input)).toBe(expected);
  });
});

describe('normalizeForSearch', () => {
  it('lower-cases, strips diacritics and collapses whitespace', () => {
    expect(normalizeForSearch('  Cam   SÀNH\nVĩnh Long ')).toBe(
      'cam sanh vinh long',
    );
  });
});
