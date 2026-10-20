import { CHAT_EVENT_TYPES } from '../../events/domain-events.js';
import { digestItems } from './digest.js';

export const DIGEST_TYPE = 'chat.digest';
export const CHAT_TEMPLATE_TYPES = [...CHAT_EVENT_TYPES, DIGEST_TYPE] as const;
export type ChatTemplateType = (typeof CHAT_TEMPLATE_TYPES)[number];

export const TEMPLATE_VARIABLES: Record<ChatTemplateType, readonly string[]> = {
  'campaign.opened': [
    'sellerName',
    'campaignTitle',
    'categoryName',
    'deadline',
    'deliveryDate',
    'itemCount',
    'url',
  ],
  'campaign.reopened': [
    'sellerName',
    'campaignTitle',
    'categoryName',
    'deadline',
    'deliveryDate',
    'itemCount',
    'url',
  ],
  'listing.published': [
    'sellerName',
    'listingTitle',
    'categoryName',
    'price',
    'url',
  ],
  'chat.digest': ['count', 'items'],
};

/** Same text the migration seeded; used by "restore default". */
export const DEFAULT_TEMPLATES: Record<ChatTemplateType, string> = {
  'campaign.opened':
    '🛒 *{{sellerName}}* vừa mở đợt *{{campaignTitle}}* ({{itemCount}} món). Chốt {{deadline}}, giao {{deliveryDate}}. {{url}}',
  'campaign.reopened':
    '🔁 *{{sellerName}}* mở lại đợt *{{campaignTitle}}*. Chốt {{deadline}}, giao {{deliveryDate}}. {{url}}',
  'listing.published':
    '🆕 *{{sellerName}}* đăng *{{listingTitle}}*, giá {{price}}. {{url}}',
  'chat.digest': '📋 *Bảng tin giờ qua* ({{count}} tin chưa gửi):\n{{items}}',
};

export const TEMPLATE_MAX_LENGTH = 1000;
export const TEST_PREFIX = '[Thử] ';

export function isChatTemplateType(value: string): value is ChatTemplateType {
  return (CHAT_TEMPLATE_TYPES as readonly string[]).includes(value);
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([A-Za-z]+)\}\}/g, (whole, name: string) =>
    values[name] === undefined ? whole : values[name].replace(/[<>*_~`]/g, ''),
  );
}

/** Sample values for preview and test messages. */
export function sampleVariables(
  type: ChatTemplateType,
  webUrl: string,
): Record<string, string> {
  const campaign = {
    sellerName: 'Nguyễn Văn An',
    campaignTitle: 'Bánh trung thu Kinh Đô',
    categoryName: 'Đồ ăn',
    deadline: '17:00 20/10',
    deliveryDate: '22/10',
    itemCount: '12',
    url: `${webUrl}/`,
  };
  const listing = {
    sellerName: 'Nguyễn Văn An',
    listingTitle: 'Bàn phím cơ Keychron K2',
    categoryName: 'Đồ ăn',
    price: '850.000 ₫',
    url: `${webUrl}/`,
  };
  switch (type) {
    case 'campaign.opened':
    case 'campaign.reopened':
      return campaign;
    case 'listing.published':
      return listing;
    case 'chat.digest':
      return {
        count: '3',
        items: digestItems([
          fill(DEFAULT_TEMPLATES['campaign.opened'], campaign),
          fill(DEFAULT_TEMPLATES['campaign.reopened'], campaign),
          fill(DEFAULT_TEMPLATES['listing.published'], listing),
        ]),
      };
  }
}
