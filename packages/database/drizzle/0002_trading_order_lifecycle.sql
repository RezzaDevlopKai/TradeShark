-- TradeShark trading order lifecycle fields.
-- Existing orders are initialized with their full quantity remaining.

CREATE SEQUENCE IF NOT EXISTS orders_sequence_seq;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS remaining_quantity numeric(38,18);

UPDATE orders
SET remaining_quantity = quantity
WHERE remaining_quantity IS NULL;

ALTER TABLE orders
  ALTER COLUMN remaining_quantity SET NOT NULL,
  ADD COLUMN IF NOT EXISTS sequence integer;

ALTER TABLE orders
  ALTER COLUMN sequence SET DEFAULT nextval('orders_sequence_seq');

UPDATE orders
SET sequence = nextval('orders_sequence_seq')
WHERE sequence IS NULL;

ALTER TABLE orders
  ALTER COLUMN sequence SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS orders_sequence_uq ON orders(sequence);
CREATE INDEX IF NOT EXISTS orders_market_book_idx
  ON orders(market_id, status, side, sequence);

ALTER TABLE orders
  ADD CONSTRAINT orders_remaining_quantity_valid
  CHECK (remaining_quantity > 0 AND remaining_quantity <= quantity);
