-- CreateEnum
CREATE TYPE "ValuationSource" AS ENUM ('purchase', 'appraisal', 'broker_opinion', 'avm', 'owner_estimate', 'contract', 'sale');

-- CreateTable
CREATE TABLE "Valuation" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "valueCents" INTEGER NOT NULL,
    "source" "ValuationSource" NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Valuation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Valuation_propertyId_date_idx" ON "Valuation"("propertyId", "date");

-- AddForeignKey
ALTER TABLE "Valuation" ADD CONSTRAINT "Valuation_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
