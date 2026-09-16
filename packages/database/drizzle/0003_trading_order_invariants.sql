-- TradeShark trading order invariants.
-- Filled orders must be allowed to reach zero remaining quantity.
-- Keep the order sequence at a valid PostgreSQL value even when the table is empty.

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_remaining_quantity_valid;

ALTER TABLE orders
  ADD CONSTRAINT orders_remaining_quantity_valid
  CHECK (remaining_quantity >= 0 AND remaining_quantity <= quantity);

SELECT setval(
  'orders_sequence_seq',
  GREATEST(COALESCE((SELECT MAX(sequence) FROM orders), 0), 1),
  true
);
