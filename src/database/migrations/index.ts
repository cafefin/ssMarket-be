import { CreateUsers1759622400000 } from './1759622400000-create-users.js';
import { AddUserProfile1759708800000 } from './1759708800000-add-user-profile.js';
import { CreateCategories1759712400000 } from './1759712400000-create-categories.js';
import { CreateListings1759716000000 } from './1759716000000-create-listings.js';
import { CreateOrders1759795200000 } from './1759795200000-create-orders.js';

// Ordered oldest first. Add every new migration class here.
export const migrations = [
  CreateUsers1759622400000,
  AddUserProfile1759708800000,
  CreateCategories1759712400000,
  CreateListings1759716000000,
  CreateOrders1759795200000,
];
