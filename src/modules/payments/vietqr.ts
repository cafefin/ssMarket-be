import { crc16CcittFalse } from './crc16.js';

export interface VietQrInput {
  /** 6-digit NAPAS bank identification number. */
  bankBin: string;
  accountNumber: string;
  /** Integer VND. */
  amount: number;
  /** Transfer content shown on the seller's statement, e.g. the order code. */
  content: string;
}

const field = (id: string, value: string): string =>
  `${id}${String(value.length).padStart(2, '0')}${value}`;

/**
 * Builds the text encoded in a VietQR code (NAPAS, EMVCo merchant-presented
 * format) for a bank transfer with a fixed amount and content. Rendering the
 * string as a QR image is left to the caller. Nothing is sent anywhere: the
 * code only pre-fills a transfer in the buyer's banking app.
 */
export function buildVietQrPayload(input: VietQrInput): string {
  if (!/^\d{6}$/.test(input.bankBin)) {
    throw new Error('bankBin must be 6 digits');
  }
  if (!/^[A-Za-z0-9]{1,19}$/.test(input.accountNumber)) {
    throw new Error('accountNumber must be 1-19 letters or digits');
  }
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error('amount must be a positive whole number of VND');
  }
  if (!/^[A-Z0-9]{1,25}$/.test(input.content)) {
    throw new Error('content must be 1-25 upper-case letters or digits');
  }

  const beneficiary =
    field('00', input.bankBin) + field('01', input.accountNumber);
  const merchantAccount =
    field('00', 'A000000727') + // NAPAS
    field('01', beneficiary) +
    field('02', 'QRIBFTTA'); // transfer to an account
  const withoutCrc =
    field('00', '01') + // payload format
    field('01', '12') + // dynamic: one code per payment
    field('38', merchantAccount) +
    field('53', '704') + // VND
    field('54', String(input.amount)) +
    field('58', 'VN') +
    field('62', field('08', input.content)) +
    '6304'; // the CRC covers its own id and length
  return withoutCrc + crc16CcittFalse(withoutCrc);
}
