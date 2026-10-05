import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rate-limits per signed-in user instead of per IP, so colleagues behind the
 * same office address do not share one budget. Place it after JwtAuthGuard.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req.user as { id?: string } | undefined;
    return Promise.resolve(user?.id ?? String(req.ip));
  }
}
