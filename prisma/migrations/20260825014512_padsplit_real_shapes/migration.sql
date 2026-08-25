-- DropForeignKey
ALTER TABLE "EarningsTableRow" DROP CONSTRAINT "EarningsTableRow_importId_fkey";

-- DropForeignKey
ALTER TABLE "EarningsTableRow" DROP CONSTRAINT "EarningsTableRow_propertyId_fkey";

-- DropIndex
DROP INDEX "CollectionLine_roomExternalId_idx";

-- DropIndex
DROP INDEX "PadSplitImport_earningsMonth_idx";

-- AlterTable
ALTER TABLE "BilledLine" ADD COLUMN     "billId" TEXT NOT NULL,
ADD COLUMN     "billedDate" DATE NOT NULL,
ADD COLUMN     "memberId" TEXT,
ADD COLUMN     "memberName" TEXT,
ADD COLUMN     "reason" TEXT NOT NULL,
ADD COLUMN     "roomNumber" TEXT;

-- AlterTable
ALTER TABLE "CollectionLine" ADD COLUMN     "billId" TEXT,
ADD COLUMN     "bookingFeeCents" INTEGER NOT NULL,
ADD COLUMN     "hostEarningsCents" INTEGER NOT NULL,
ADD COLUMN     "memberId" TEXT,
ADD COLUMN     "memberName" TEXT,
ADD COLUMN     "roomNumber" TEXT,
ADD COLUMN     "serviceFeeCents" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "PadSplitImport" DROP COLUMN "earningsMonth",
ADD COLUMN     "monthsCovered" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "SummaryLine" DROP COLUMN "feesCents",
ADD COLUMN     "adjustmentsCents" INTEGER NOT NULL,
ADD COLUMN     "bookingFeesCents" INTEGER NOT NULL,
ADD COLUMN     "netOfBookingCents" INTEGER NOT NULL,
ADD COLUMN     "payoutAccount" TEXT,
ADD COLUMN     "payoutMonth" TEXT NOT NULL,
ADD COLUMN     "serviceFeesCents" INTEGER NOT NULL,
ADD COLUMN     "totalPayoutCents" INTEGER NOT NULL,
ALTER COLUMN "propertyExternalId" SET NOT NULL;

-- DropTable
DROP TABLE "EarningsTableRow";

-- CreateTable
CREATE TABLE "PadSplitMonthTotal" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "earningsMonth" TEXT NOT NULL,
    "inFlight" BOOLEAN NOT NULL,
    "collectionsCents" INTEGER NOT NULL,
    "expensesCents" INTEGER NOT NULL,
    "adjustmentsCents" INTEGER NOT NULL,
    "payoutCents" INTEGER NOT NULL,

    CONSTRAINT "PadSplitMonthTotal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PadSplitMonthTotal_earningsMonth_key" ON "PadSplitMonthTotal"("earningsMonth");

-- CreateIndex
CREATE INDEX "BilledLine_memberId_idx" ON "BilledLine"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "BilledLine_billId_key" ON "BilledLine"("billId");

-- CreateIndex
CREATE INDEX "CollectionLine_billId_idx" ON "CollectionLine"("billId");

-- CreateIndex
CREATE INDEX "CollectionLine_memberId_idx" ON "CollectionLine"("memberId");

-- CreateIndex
CREATE INDEX "PadSplitImport_fileKind_idx" ON "PadSplitImport"("fileKind");

-- CreateIndex
CREATE INDEX "SummaryLine_payoutMonth_idx" ON "SummaryLine"("payoutMonth");

-- CreateIndex
CREATE UNIQUE INDEX "SummaryLine_propertyExternalId_earningsMonth_key" ON "SummaryLine"("propertyExternalId", "earningsMonth");

-- AddForeignKey
ALTER TABLE "PadSplitMonthTotal" ADD CONSTRAINT "PadSplitMonthTotal_importId_fkey" FOREIGN KEY ("importId") REFERENCES "PadSplitImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

