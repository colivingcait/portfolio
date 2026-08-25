-- Net cash was reading zero for any month whose statement was not imported.
-- What the platform says will land is known regardless; the variance against
-- what actually arrived is reported separately.
ALTER TABLE "MonthlyPropertyRollup" ADD COLUMN "expectedDepositCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MonthlyPropertyRollup" ADD COLUMN "depositVarianceCents" INTEGER NOT NULL DEFAULT 0;
