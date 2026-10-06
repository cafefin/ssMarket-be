import { isEmail } from 'class-validator';

/**
 * The people who get the admin role at sign-in. A comma-separated list in
 * ADMIN_EMAILS; empty means nobody is an admin.
 */
export function parseAdminEmails(raw: string | undefined): Set<string> {
  const emails = new Set<string>();
  for (const part of (raw ?? '').split(',')) {
    const entry = part.trim().toLowerCase();
    if (entry === '') {
      continue;
    }
    if (!isEmail(entry, { require_tld: false })) {
      throw new Error(`Invalid ADMIN_EMAILS entry: ${entry}`);
    }
    emails.add(entry);
  }
  return emails;
}
