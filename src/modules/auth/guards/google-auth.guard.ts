import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  // The default implementation throws 401, which would show raw JSON to a
  // person in the middle of a browser redirect. Returning null lets the
  // controller send them back to the login page instead.
  override handleRequest<TUser>(err: unknown, user: TUser | false): TUser {
    if (err || !user) {
      return null as TUser;
    }
    return user;
  }
}
