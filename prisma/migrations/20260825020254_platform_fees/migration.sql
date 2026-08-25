-- What the platform kept out of the rent it collected, stored as an expense.
ALTER TABLE "MonthlyPropertyRollup" ADD COLUMN "platformFeesCents" INTEGER NOT NULL DEFAULT 0;
