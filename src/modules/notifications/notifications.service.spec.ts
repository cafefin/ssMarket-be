import { BadRequestException, NotFoundException } from '@nestjs/common';
import { encodeCreatedAtCursor } from '../../common/pagination/created-at-cursor.js';
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

describe('NotificationsService reads', () => {
  const repo = {
    list: vi.fn(),
    countUnread: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
  };
  const service = new NotificationsService(
    repo as unknown as NotificationsRepository,
  );
  const uuid = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const rows = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: uuid(i + 1),
      type: 'order.placed',
      params: { a: 1 },
      readAt: null,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 100 - i)),
    }));

  beforeEach(() => vi.resetAllMocks());

  it('asks for 21 rows and returns 20 with a cursor on the 20th', async () => {
    const found = rows(21);
    repo.list.mockResolvedValue(found);
    const page = await service.list('u');
    expect(repo.list).toHaveBeenCalledWith('u', null, 21);
    expect(page.items).toHaveLength(20);
    expect(page.items[0]).toEqual({
      id: found[0].id,
      type: 'order.placed',
      params: { a: 1 },
      readAt: null,
      createdAt: found[0].createdAt.toISOString(),
    });
    expect(page.nextCursor).toBe(
      encodeCreatedAtCursor({
        createdAt: found[19].createdAt.toISOString(),
        id: found[19].id,
      }),
    );
  });

  it('has no cursor on a short page', async () => {
    repo.list.mockResolvedValue(rows(3));
    expect((await service.list('u')).nextCursor).toBeNull();
  });

  it('passes a decoded cursor to the repository', async () => {
    repo.list.mockResolvedValue([]);
    const cursor = { createdAt: '2026-01-01T00:00:00.000Z', id: uuid(9) };
    await service.list('u', encodeCreatedAtCursor(cursor));
    expect(repo.list).toHaveBeenCalledWith('u', cursor, 21);
  });

  it('rejects an invalid cursor', async () => {
    await expect(service.list('u', 'nope')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('counts unread', async () => {
    repo.countUnread.mockResolvedValue(4);
    expect(await service.unreadCount('u')).toEqual({ count: 4 });
  });

  it('markRead throws NotFound when the row is not the user\'s', async () => {
    repo.markRead.mockResolvedValue(false);
    await expect(service.markRead('u', uuid(1))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('markRead on an already-read row is fine', async () => {
    repo.markRead.mockResolvedValue(true);
    await expect(service.markRead('u', uuid(1))).resolves.toBeUndefined();
  });

  it('markAllRead delegates', async () => {
    await service.markAllRead('u');
    expect(repo.markAllRead).toHaveBeenCalledWith('u', expect.any(Date));
  });
});
