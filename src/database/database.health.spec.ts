import type { DataSource } from 'typeorm';
import { DatabaseHealth } from './database.health.js';

describe('DatabaseHealth', () => {
  it('is up when a trivial query succeeds', async () => {
    const dataSource = { query: vi.fn().mockResolvedValue([{ ok: 1 }]) };

    await expect(
      new DatabaseHealth(dataSource as unknown as DataSource).isUp(),
    ).resolves.toBe(true);
    expect(dataSource.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('is down when the query fails', async () => {
    const dataSource = { query: vi.fn().mockRejectedValue(new Error('down')) };

    await expect(
      new DatabaseHealth(dataSource as unknown as DataSource).isUp(),
    ).resolves.toBe(false);
  });
});
