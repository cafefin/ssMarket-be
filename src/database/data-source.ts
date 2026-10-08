import 'dotenv/config';
import { DataSource } from 'typeorm';
import { Category } from '../modules/categories/category.entity.js';
import { ListingImage } from '../modules/listings/listing-image.entity.js';
import { ListingCombo } from '../modules/listings/listing-combo.entity.js';
import { Listing } from '../modules/listings/listing.entity.js';
import { CartLine } from '../modules/cart/cart-line.entity.js';
import { OrderLine } from '../modules/orders/order-line.entity.js';
import { Order } from '../modules/orders/order.entity.js';
import { User } from '../modules/users/user.entity.js';
import { migrations } from './migrations/index.js';

// Used only by the TypeORM CLI (pnpm migration:run), which loads the compiled
// file from dist/. The app builds its own connection in DatabaseModule.
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [
    User,
    Category,
    Listing,
    ListingCombo,
    ListingImage,
    Order,
    OrderLine,
    CartLine,
  ],
  migrations,
});
