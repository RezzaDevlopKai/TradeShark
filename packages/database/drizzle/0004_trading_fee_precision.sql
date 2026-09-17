-- TradeShark trading fee precision.
-- The trading engine uses 18-decimal fixed-point arithmetic, so persist order fee rates
-- at the same precision instead of truncating them to 10 decimal places.

ALTER TABLE orders
  ALTER COLUMN fee_rate TYPE numeric(38,18)
  USING fee_rate::numeric(38,18);
