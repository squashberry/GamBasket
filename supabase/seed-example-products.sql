-- GamBasket development-only example products.
-- Run this in the Supabase SQL editor after schema.sql.
-- IDs are intentionally omitted so PostgreSQL generates UUIDs.

INSERT INTO public.categories (id, name, icon_name, sort_order) VALUES
    ('Solar', 'Solar', 'solar', 6),
    ('Food', 'Food', 'food', 7),
    ('Auto', 'Auto', 'car', 8),
    ('Hardware', 'Hardware', 'tools', 9),
    ('Baby', 'Baby', 'baby', 10),
    ('Sports', 'Sports', 'sports', 11)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.products (
    title,
    description,
    price,
    currency,
    category_id,
    condition,
    stock,
    location,
    main_image,
    status
)
SELECT
    seed.title,
    seed.description,
    seed.price,
    'GMD',
    seed.category_id,
    seed.condition,
    10,
    seed.location,
    seed.main_image,
    'approved'
FROM (VALUES
    (
        'iPhone 13 128GB',
        'Clean, genuine factory unlocked iPhone 13 in excellent condition with complete accessories.',
        45000::NUMERIC,
        'Phones',
        'Like New',
        'Serrekunda',
        'https://images.unsplash.com/photo-1603899122634-f086ca5f5ddd?auto=format&fit=crop&w=800&q=80'
    ),
    (
        'Classic White Sneakers',
        'Comfortable and durable white sneakers for daily wear. Available in Gambian sizes 39 to 45.',
        2500::NUMERIC,
        'Fashion',
        'New',
        'Brikama',
        'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=800&q=80'
    ),
    (
        'MacBook Air M2 256GB',
        'Brand new Apple MacBook Air M2 with 8GB unified memory and 256GB SSD storage.',
        58000::NUMERIC,
        'Electronics',
        'New',
        'Kololi',
        'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=800&q=80'
    ),
    (
        'Modern Ergonomic Accent Chair',
        'High quality ergonomic accent armchair with premium hardwood legs and stain-resistant fabric.',
        8500::NUMERIC,
        'Home',
        'New',
        'Bakau',
        'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=800&q=80'
    ),
    (
        'Samsung Galaxy S24 Ultra',
        'Flagship Samsung Galaxy phone with a dynamic AMOLED display and Galaxy AI features.',
        52000::NUMERIC,
        'Phones',
        'New',
        'Kotu',
        'https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?auto=format&fit=crop&w=800&q=80'
    )
) AS seed(title, description, price, category_id, condition, location, main_image)
WHERE NOT EXISTS (
    SELECT 1
    FROM public.products existing
    WHERE existing.title = seed.title
);

-- Verification: every seeded product has a PostgreSQL UUID and is wishlist-compatible.
SELECT id, title, category_id, status
FROM public.products
WHERE title IN (
    'iPhone 13 128GB',
    'Classic White Sneakers',
    'MacBook Air M2 256GB',
    'Modern Ergonomic Accent Chair',
    'Samsung Galaxy S24 Ultra'
)
ORDER BY title;

-- Foreign-key verification for wishlist references.
SELECT pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'public.wishlist_items'::regclass
  AND conname = 'wishlist_items_product_id_fkey';
