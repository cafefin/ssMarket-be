import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../../modules/users/user.entity.js';

export const ROLES_KEY = 'roles';

/** Restricts a route or controller to these roles. Needs RolesGuard. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
