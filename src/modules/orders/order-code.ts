import { randomInt } from 'node:crypto';

// No 0/O or 1/I: people read this code off a bank statement.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const LENGTH = 6;

/** A short reference such as "SSM7K2Q9X", used as the bank transfer content. */
export function generateOrderCode(
  random: (max: number) => number = randomInt,
): string {
  let code = 'SSM';
  for (let i = 0; i < LENGTH; i += 1) {
    code += ALPHABET[random(ALPHABET.length)];
  }
  return code;
}
