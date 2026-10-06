export enum PaymentMethod {
  PrepaidQr = 'prepaid_qr',
  PayOnDelivery = 'pay_on_delivery',
}

export enum PaymentStatus {
  Unpaid = 'unpaid',
  /** The buyer says they have transferred; the seller has not confirmed. */
  Reported = 'reported',
  Paid = 'paid',
}

export enum FulfillmentStatus {
  Pending = 'pending',
  Delivered = 'delivered',
  Cancelled = 'cancelled',
}

export enum OrderActor {
  Buyer = 'buyer',
  Seller = 'seller',
}

export const ORDER_LIMITS = {
  linesMax: 20,
  quantityMax: 9999,
  deliveryLocationMax: 120,
  noteMax: 500,
  cancelReasonMax: 300,
} as const;
