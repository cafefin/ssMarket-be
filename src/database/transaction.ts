import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';

/**
 * An open database transaction. Services pass it between repositories
 * without knowing what it is, which keeps TypeORM out of the service layer.
 */
export type Tx = EntityManager;

@Injectable()
export class TransactionRunner {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Commits when `work` resolves and rolls back when it rejects. */
  run<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }
}
