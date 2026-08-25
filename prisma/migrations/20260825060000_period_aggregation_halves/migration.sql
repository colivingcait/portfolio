-- A period spanning several months has to add the halves of a rate, not
-- average the monthly rates. Store the halves.
ALTER TABLE "MonthlyPropertyRollup" ADD COLUMN "roomDaysLet" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MonthlyPropertyRollup" ADD COLUMN "roomDaysAvailable" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MonthlyPropertyRollup" ADD COLUMN "netBilledCents" INTEGER NOT NULL DEFAULT 0;
