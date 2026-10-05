import { Injectable } from '@nestjs/common';
import { type Bank, BANKS } from './banks.data.js';

@Injectable()
export class BanksService {
  private readonly byBin = new Map(BANKS.map((bank) => [bank.bin, bank]));

  list(): readonly Bank[] {
    return BANKS;
  }

  exists(bin: string): boolean {
    return this.byBin.has(bin);
  }

  findByBin(bin: string): Bank | null {
    return this.byBin.get(bin) ?? null;
  }
}
