import { categorySlug } from './category-slug.js';

describe('categorySlug', () => {
  it.each([
    ['Thực phẩm tươi', 'thuc-pham-tuoi'],
    ['  Đồ   công nghệ ', 'do-cong-nghe'],
    ['Sách & Truyện!', 'sach-truyen'],
    ['A'.repeat(60), 'a'.repeat(40)],
    ['!!!', ''],
  ])('turns %j into %j', (name, slug) => {
    expect(categorySlug(name)).toBe(slug);
  });
});
