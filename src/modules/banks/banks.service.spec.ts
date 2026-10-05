import { BanksService } from './banks.service.js';

describe('BanksService', () => {
  const service = new BanksService();

  it('lists banks sorted by short name', () => {
    const names = service.list().map((bank) => bank.shortName.toLowerCase());

    expect(names.length).toBeGreaterThan(20);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('has a unique 6-digit BIN for every bank', () => {
    const bins = service.list().map((bank) => bank.bin);

    expect(bins.every((bin) => /^\d{6}$/.test(bin))).toBe(true);
    expect(new Set(bins).size).toBe(bins.length);
  });

  it.each(['970436', '970415', '970418', '970407', '970422'])(
    'knows the major bank %s',
    (bin) => {
      expect(service.exists(bin)).toBe(true);
    },
  );

  it('does not know an unlisted BIN', () => {
    expect(service.exists('000000')).toBe(false);
  });

  it('finds a bank by BIN', () => {
    expect(service.findByBin('970436')?.shortName).toBe('Vietcombank');
    expect(service.findByBin('000000')).toBeNull();
  });
});
