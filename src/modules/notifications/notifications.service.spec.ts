import type { EventEnvelope } from '../../events/domain-events.js';
import type { NotificationsRepository } from './notifications.repository.js';
import { NotificationsService } from './notifications.service.js';

const payload = {
  orderId: 'o',
  orderCode: 'SS-1',
  buyerId: 'b',
  buyerName: 'Buyer',
  sellerId: 's',
  sellerName: 'Seller',
  title: 'Loa',
  total: 1000,
  actor: 'buyer',
  reason: null,
} as const;

const order = (type: 'order.placed' | 'order.edited'): EventEnvelope => ({
  id: 'e-1',
  version: 1,
  occurredAt: '2026-01-02T03:04:05.000Z',
  type,
  payload,
});

describe('NotificationsService', () => {
  let repository: { insert: ReturnType<typeof vi.fn>; mergeEdited: ReturnType<typeof vi.fn> };
  let service: NotificationsService;

  beforeEach(() => {
    repository = { insert: vi.fn(), mergeEdited: vi.fn() };
    service = new NotificationsService(
      repository as unknown as NotificationsRepository,
    );
  });

  const row = (type: string) => ({
    recipientId: 's',
    eventId: 'e-1',
    type,
    params: { ...payload, role: 'seller' },
    orderId: 'o',
    createdAt: new Date('2026-01-02T03:04:05.000Z'),
  });

  it('inserts a notification for the seller on order.placed', async () => {
    await service.handleEvent(order('order.placed'));
    expect(repository.insert).toHaveBeenCalledWith(row('order.placed'));
    expect(repository.mergeEdited).not.toHaveBeenCalled();
  });

  it('merges order.edited into an unread row first', async () => {
    repository.mergeEdited.mockResolvedValue(true);
    await service.handleEvent(order('order.edited'));
    expect(repository.mergeEdited).toHaveBeenCalledWith(row('order.edited'));
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('inserts order.edited when there is nothing to merge', async () => {
    repository.mergeEdited.mockResolvedValue(false);
    await service.handleEvent(order('order.edited'));
    expect(repository.insert).toHaveBeenCalledWith(row('order.edited'));
  });

  it('ignores events that are not order events', async () => {
    await service.handleEvent({
      id: 'e-2',
      version: 1,
      occurredAt: '2026-01-02T03:04:05.000Z',
      type: 'campaign.opened',
      payload: {} as never,
    });
    expect(repository.insert).not.toHaveBeenCalled();
    expect(repository.mergeEdited).not.toHaveBeenCalled();
  });
});
