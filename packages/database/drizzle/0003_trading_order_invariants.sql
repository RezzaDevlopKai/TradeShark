-- TradeShark trading order invariants.
-- Filled orders must be allowed to reach zero remaining quantity.
-- The sequence is advanced past existing rows so future inserts cannot collide.

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_remaining_quantity_valid;

ALTER TABLE orders
  ADD CONSTRAINT orders_remaining_quantity_valid
  CHECK (remaining_quantity >= 0 AND remaining_quantity <= quantity);

SELECT setval(
  'orders_sequence_seq',
  COALESCE((SELECT MAX(sequence) FROM orders), 0),
  true
);
