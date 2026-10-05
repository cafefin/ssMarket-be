import 'dotenv/config';
import { DataSource } from 'typeorm';
import { User } from '../modules/users/user.entity.js';
import { migrations } from './migrations/index.js';

// Used only by the TypeORM CLI (pnpm migration:run), which loads the compiled
// file from dist/. The app builds its own connection in DatabaseModule.
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [User],
  migrations,
});
