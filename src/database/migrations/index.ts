import { CreateUsers1759622400000 } from './1759622400000-create-users.js';
import { AddUserProfile1759708800000 } from './1759708800000-add-user-profile.js';
import { CreateCategories1759712400000 } from './1759712400000-create-categories.js';
import { CreateListings1759716000000 } from './1759716000000-create-listings.js';
import { CreateOrders1759795200000 } from './1759795200000-create-orders.js';
import { AddCategoryAdminFields1759881600000 } from './1759881600000-add-category-admin-fields.js';
import { AddListingDeadlineIndex1759885200000 } from './1759885200000-add-listing-deadline-index.js';
import { AddUserLocale1759888800000 } from './1759888800000-add-user-locale.js';
import { AddListingCondition1759971600000 } from './1759971600000-add-listing-condition.js';
import { AddCombos1759975200000 } from './1759975200000-add-combos.js';
import { OrdersSpanListings1759978800000 } from './1759978800000-orders-span-listings.js';
import { CreateCart1759982400000 } from './1759982400000-create-cart.js';
import { SingleProduct1760000000000 } from './1760000000000-single-product.js';

// Ordered oldest first. Add every new migration class here.
export const migrations = [
  CreateUsers1759622400000,
  AddUserProfile1759708800000,
  CreateCategories1759712400000,
  CreateListings1759716000000,
  CreateOrders1759795200000,
  AddCategoryAdminFields1759881600000,
  AddListingDeadlineIndex1759885200000,
  AddUserLocale1759888800000,
  AddListingCondition1759971600000,
  AddCombos1759975200000,
  OrdersSpanListings1759978800000,
  CreateCart1759982400000,
  SingleProduct1760000000000,
];
