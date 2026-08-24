-- CreateEnum
CREATE TYPE "EntityKind" AS ENUM ('person', 'company');

-- CreateEnum
CREATE TYPE "OwnedType" AS ENUM ('property', 'entity');

-- CreateEnum
CREATE TYPE "OwnershipBasis" AS ENUM ('equity', 'distribution');

-- CreateEnum
CREATE TYPE "CapitalEntryKind" AS ENUM ('contribution', 'distribution');

-- CreateEnum
CREATE TYPE "RevenueSource" AS ENUM ('padsplit', 'direct');

-- CreateEnum
CREATE TYPE "UnitStructure" AS ENUM ('rooms', 'units');

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('acquiring', 'ramping', 'stabilized', 'divesting', 'sold');

-- CreateEnum
CREATE TYPE "ManagementMode" AS ENUM ('self', 'pm');

-- CreateEnum
CREATE TYPE "FeeBasis" AS ENUM ('gross_collected', 'host_earnings', 'net_billed');

-- CreateEnum
CREATE TYPE "StatementStatus" AS ENUM ('pending', 'posted', 'rejected');

-- CreateEnum
CREATE TYPE "LoanType" AS ENUM ('mortgage', 'pml', 'heloc', 'seller_financed', 'other');

-- CreateEnum
CREATE TYPE "LoanStructure" AS ENUM ('fully_amortizing', 'interest_only', 'interest_only_balloon', 'custom');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('active', 'paid_off', 'refinanced');

-- CreateTable
CREATE TABLE "Entity" (
    "id" TEXT NOT NULL,
    "kind" "EntityKind" NOT NULL,
    "name" TEXT NOT NULL,
    "isViewer" BOOLEAN NOT NULL DEFAULT false,
    "taxId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnershipInterest" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "ownedType" "OwnedType" NOT NULL,
    "propertyId" TEXT,
    "ownedEntityId" TEXT,
    "percent" DECIMAL(9,6) NOT NULL,
    "distributionPercent" DECIMAL(9,6),
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "basis" "OwnershipBasis" NOT NULL DEFAULT 'equity',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnershipInterest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapitalAccountEntry" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "propertyId" TEXT,
    "kind" "CapitalEntryKind" NOT NULL,
    "date" DATE NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapitalAccountEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "addressLine1" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "externalId" TEXT,
    "titleEntityId" TEXT NOT NULL,
    "revenueSource" "RevenueSource" NOT NULL,
    "unitStructure" "UnitStructure" NOT NULL,
    "status" "PropertyStatus" NOT NULL DEFAULT 'stabilized',
    "roomCount" INTEGER,
    "unitCount" INTEGER,
    "acquiredOn" DATE,
    "disposedOn" DATE,
    "dataVerified" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "bedrooms" INTEGER,
    "bathrooms" DECIMAL(4,1),

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "unitId" TEXT,
    "label" TEXT NOT NULL,
    "externalId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagementPeriod" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "mode" "ManagementMode" NOT NULL,
    "managerName" TEXT,
    "feePercent" DECIMAL(6,3),
    "feeBasis" "FeeBasis",
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagementPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lease" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "unitId" TEXT,
    "tenantName" TEXT NOT NULL,
    "rentCents" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "depositHeldCents" INTEGER NOT NULL DEFAULT 0,
    "utilitiesIncluded" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PadSplitImport" (
    "id" TEXT NOT NULL,
    "earningsMonth" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileKind" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PadSplitImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SummaryLine" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "propertyId" TEXT,
    "propertyExternalId" TEXT,
    "earningsMonth" TEXT NOT NULL,
    "grossCents" INTEGER NOT NULL,
    "feesCents" INTEGER NOT NULL,
    "hostEarningsCents" INTEGER NOT NULL,

    CONSTRAINT "SummaryLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BilledLine" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "propertyId" TEXT,
    "propertyExternalId" TEXT,
    "roomExternalId" TEXT,
    "earningsMonth" TEXT NOT NULL,
    "billType" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,

    CONSTRAINT "BilledLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionLine" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "propertyId" TEXT,
    "propertyExternalId" TEXT,
    "roomExternalId" TEXT,
    "billType" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "payoutMonthRaw" TEXT,
    "createdDate" DATE NOT NULL,
    "earningsMonth" TEXT NOT NULL,

    CONSTRAINT "CollectionLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EarningsTableRow" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "propertyId" TEXT,
    "propertyExternalId" TEXT,
    "earningsMonth" TEXT NOT NULL,
    "grossCents" INTEGER NOT NULL,
    "feesCents" INTEGER NOT NULL,
    "creditsCents" INTEGER NOT NULL,
    "payoutCents" INTEGER NOT NULL,

    CONSTRAINT "EarningsTableRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "institution" TEXT,
    "last4" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatement" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "openingBalanceCents" INTEGER NOT NULL,
    "closingBalanceCents" INTEGER NOT NULL,
    "computedClosingCents" INTEGER,
    "status" "StatementStatus" NOT NULL DEFAULT 'pending',
    "fileName" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "runningBalanceCents" INTEGER,
    "categoryKey" TEXT,
    "matchedRuleId" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayeeRule" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT,
    "match" TEXT NOT NULL,
    "categoryKey" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayeeRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "lender" TEXT NOT NULL,
    "type" "LoanType" NOT NULL,
    "lienPosition" INTEGER,
    "originalPrincipalCents" INTEGER NOT NULL,
    "ratePercent" DECIMAL(7,4) NOT NULL,
    "startDate" DATE NOT NULL,
    "firstPaymentDate" DATE NOT NULL,
    "termMonths" INTEGER,
    "maturityDate" DATE,
    "paymentAmountCents" INTEGER,
    "structure" "LoanStructure" NOT NULL,
    "balloonAmountCents" INTEGER,
    "paymentDayOfMonth" INTEGER,
    "escrowIncluded" BOOLEAN NOT NULL DEFAULT false,
    "escrowCents" INTEGER,
    "personallyGuaranteed" BOOLEAN NOT NULL DEFAULT false,
    "status" "LoanStatus" NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanPayment" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "principalCents" INTEGER NOT NULL,
    "interestCents" INTEGER NOT NULL,
    "escrowCents" INTEGER NOT NULL DEFAULT 0,
    "extraPrincipalCents" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'actual',

    CONSTRAINT "LoanPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyPropertyRollup" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "revenueCents" INTEGER NOT NULL DEFAULT 0,
    "hostEarningsCents" INTEGER NOT NULL DEFAULT 0,
    "pmFeeCents" INTEGER NOT NULL DEFAULT 0,
    "ownerPaidOpexCents" INTEGER NOT NULL DEFAULT 0,
    "pmPaidOpexCents" INTEGER NOT NULL DEFAULT 0,
    "operatingExpenseCents" INTEGER NOT NULL DEFAULT 0,
    "noiCents" INTEGER NOT NULL DEFAULT 0,
    "depositReceivedCents" INTEGER NOT NULL DEFAULT 0,
    "debtServiceCents" INTEGER NOT NULL DEFAULT 0,
    "debtBalanceCents" INTEGER NOT NULL DEFAULT 0,
    "netCashCents" INTEGER NOT NULL DEFAULT 0,
    "roomsTotal" INTEGER NOT NULL DEFAULT 0,
    "roomsOccupied" INTEGER NOT NULL DEFAULT 0,
    "occupancyRate" DECIMAL(7,3),
    "collectionRate" DECIMAL(9,3),
    "delinquencyCents" INTEGER NOT NULL DEFAULT 0,
    "trueRoomRateCents" INTEGER,
    "managementMode" TEXT,
    "transitionMonth" BOOLEAN NOT NULL DEFAULT false,
    "inFlight" BOOLEAN NOT NULL DEFAULT false,
    "outlier" BOOLEAN NOT NULL DEFAULT false,
    "outlierReason" TEXT,
    "tieStatus" TEXT NOT NULL DEFAULT 'does_not_tie',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyPropertyRollup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyPortfolioRollup" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "revenueCents" INTEGER NOT NULL DEFAULT 0,
    "operatingExpenseCents" INTEGER NOT NULL DEFAULT 0,
    "noiCents" INTEGER NOT NULL DEFAULT 0,
    "debtServiceCents" INTEGER NOT NULL DEFAULT 0,
    "netCashCents" INTEGER NOT NULL DEFAULT 0,
    "roomsTotal" INTEGER NOT NULL DEFAULT 0,
    "roomsOccupied" INTEGER NOT NULL DEFAULT 0,
    "crossesEntities" BOOLEAN NOT NULL DEFAULT false,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyPortfolioRollup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PMStatement" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "earningsMonth" TEXT NOT NULL,
    "payoutMonth" TEXT,
    "grossCollectedCents" INTEGER,
    "feeChargedCents" INTEGER,
    "netRemittedCents" INTEGER,
    "fileName" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PMStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PMStatementLine" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "date" DATE,
    "description" TEXT NOT NULL,
    "categoryKey" TEXT,
    "amountCents" INTEGER NOT NULL,

    CONSTRAINT "PMStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Entity_kind_idx" ON "Entity"("kind");

-- CreateIndex
CREATE INDEX "OwnershipInterest_ownerId_startDate_idx" ON "OwnershipInterest"("ownerId", "startDate");

-- CreateIndex
CREATE INDEX "OwnershipInterest_propertyId_idx" ON "OwnershipInterest"("propertyId");

-- CreateIndex
CREATE INDEX "OwnershipInterest_ownedEntityId_idx" ON "OwnershipInterest"("ownedEntityId");

-- CreateIndex
CREATE INDEX "CapitalAccountEntry_entityId_date_idx" ON "CapitalAccountEntry"("entityId", "date");

-- CreateIndex
CREATE INDEX "CapitalAccountEntry_propertyId_date_idx" ON "CapitalAccountEntry"("propertyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Property_externalId_key" ON "Property"("externalId");

-- CreateIndex
CREATE INDEX "Property_titleEntityId_idx" ON "Property"("titleEntityId");

-- CreateIndex
CREATE INDEX "Property_status_idx" ON "Property"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_propertyId_label_key" ON "Unit"("propertyId", "label");

-- CreateIndex
CREATE INDEX "Room_externalId_idx" ON "Room"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Room_propertyId_label_key" ON "Room"("propertyId", "label");

-- CreateIndex
CREATE INDEX "ManagementPeriod_propertyId_startDate_idx" ON "ManagementPeriod"("propertyId", "startDate");

-- CreateIndex
CREATE INDEX "Lease_propertyId_startDate_idx" ON "Lease"("propertyId", "startDate");

-- CreateIndex
CREATE INDEX "PadSplitImport_earningsMonth_idx" ON "PadSplitImport"("earningsMonth");

-- CreateIndex
CREATE INDEX "SummaryLine_propertyId_earningsMonth_idx" ON "SummaryLine"("propertyId", "earningsMonth");

-- CreateIndex
CREATE INDEX "BilledLine_propertyId_earningsMonth_idx" ON "BilledLine"("propertyId", "earningsMonth");

-- CreateIndex
CREATE INDEX "CollectionLine_propertyId_earningsMonth_idx" ON "CollectionLine"("propertyId", "earningsMonth");

-- CreateIndex
CREATE INDEX "CollectionLine_roomExternalId_idx" ON "CollectionLine"("roomExternalId");

-- CreateIndex
CREATE INDEX "EarningsTableRow_propertyId_earningsMonth_idx" ON "EarningsTableRow"("propertyId", "earningsMonth");

-- CreateIndex
CREATE INDEX "BankAccount_propertyId_idx" ON "BankAccount"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "BankStatement_bankAccountId_periodStart_periodEnd_key" ON "BankStatement"("bankAccountId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "BankTransaction_statementId_date_idx" ON "BankTransaction"("statementId", "date");

-- CreateIndex
CREATE INDEX "BankTransaction_categoryKey_idx" ON "BankTransaction"("categoryKey");

-- CreateIndex
CREATE INDEX "PayeeRule_bankAccountId_idx" ON "PayeeRule"("bankAccountId");

-- CreateIndex
CREATE INDEX "Loan_propertyId_idx" ON "Loan"("propertyId");

-- CreateIndex
CREATE INDEX "Loan_maturityDate_idx" ON "Loan"("maturityDate");

-- CreateIndex
CREATE INDEX "LoanPayment_loanId_date_idx" ON "LoanPayment"("loanId", "date");

-- CreateIndex
CREATE INDEX "MonthlyPropertyRollup_month_idx" ON "MonthlyPropertyRollup"("month");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyPropertyRollup_propertyId_month_basis_key" ON "MonthlyPropertyRollup"("propertyId", "month", "basis");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyPortfolioRollup_month_basis_key" ON "MonthlyPortfolioRollup"("month", "basis");

-- CreateIndex
CREATE UNIQUE INDEX "PMStatement_propertyId_earningsMonth_key" ON "PMStatement"("propertyId", "earningsMonth");

-- CreateIndex
CREATE INDEX "PMStatementLine_statementId_idx" ON "PMStatementLine"("statementId");

-- AddForeignKey
ALTER TABLE "OwnershipInterest" ADD CONSTRAINT "OwnershipInterest_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnershipInterest" ADD CONSTRAINT "OwnershipInterest_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnershipInterest" ADD CONSTRAINT "OwnershipInterest_ownedEntityId_fkey" FOREIGN KEY ("ownedEntityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapitalAccountEntry" ADD CONSTRAINT "CapitalAccountEntry_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapitalAccountEntry" ADD CONSTRAINT "CapitalAccountEntry_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_titleEntityId_fkey" FOREIGN KEY ("titleEntityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementPeriod" ADD CONSTRAINT "ManagementPeriod_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SummaryLine" ADD CONSTRAINT "SummaryLine_importId_fkey" FOREIGN KEY ("importId") REFERENCES "PadSplitImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SummaryLine" ADD CONSTRAINT "SummaryLine_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BilledLine" ADD CONSTRAINT "BilledLine_importId_fkey" FOREIGN KEY ("importId") REFERENCES "PadSplitImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BilledLine" ADD CONSTRAINT "BilledLine_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionLine" ADD CONSTRAINT "CollectionLine_importId_fkey" FOREIGN KEY ("importId") REFERENCES "PadSplitImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionLine" ADD CONSTRAINT "CollectionLine_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarningsTableRow" ADD CONSTRAINT "EarningsTableRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "PadSplitImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarningsTableRow" ADD CONSTRAINT "EarningsTableRow_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatement" ADD CONSTRAINT "BankStatement_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "BankStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayeeRule" ADD CONSTRAINT "PayeeRule_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanPayment" ADD CONSTRAINT "LoanPayment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyPropertyRollup" ADD CONSTRAINT "MonthlyPropertyRollup_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PMStatement" ADD CONSTRAINT "PMStatement_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PMStatementLine" ADD CONSTRAINT "PMStatementLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "PMStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
