import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthUser } from '../../modules/auth/auth.types.js';
import type { UserRole } from '../../modules/users/user.entity.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';

/**
 * Checks the role in the access token against @Roles. Place it after
 * JwtAuthGuard, which is what puts the user on the request.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }

    const user = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>().user;
    if (!user || !required.includes(user.role)) {
      throw new ForbiddenException('You may not do this');
    }
    return true;
  }
}
