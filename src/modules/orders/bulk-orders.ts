import { HttpException, HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception.js';
import type { BulkAction, BulkResultDto } from './dto/summary.dto.js';
import type { OrdersService } from './orders.service.js';

/**
 * Applies one action to many orders, each on its own under the normal rules.
 * An order that is not in `belongs` is reported with `notMemberCode`; one that
 * fails is reported and does not stop the others.
 */
export async function runBulk(
  orders: OrdersService,
  sellerId: string,
  action: BulkAction,
  orderIds: string[],
  belongs: Set<string>,
  notMemberCode: string,
): Promise<BulkResultDto[]> {
  const results: BulkResultDto[] = [];
  for (const orderId of orderIds) {
    if (!belongs.has(orderId)) {
      results.push({ orderId, ok: false, code: notMemberCode });
      continue;
    }
    try {
      await (action === 'deliver'
        ? orders.deliver(sellerId, orderId)
        : orders.confirmPayment(sellerId, orderId));
      results.push({ orderId, ok: true, code: null });
    } catch (error) {
      if (!(error instanceof HttpException)) {
        throw error;
      }
      results.push({
        orderId,
        ok: false,
        code:
          error instanceof DomainException
            ? error.code
            : (HttpStatus[error.getStatus()] ?? 'ERROR'),
      });
    }
  }
  return results;
}
