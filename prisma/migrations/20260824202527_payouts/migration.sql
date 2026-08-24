-- CreateEnum
CREATE TYPE "PaymentFrequency" AS ENUM ('monthly', 'quarterly', 'semiannual', 'annual');

-- AlterEnum
ALTER TYPE "CapitalEntryKind" ADD VALUE 'return_of_capital';

-- AlterTable
ALTER TABLE "CapitalAccountEntry" ADD COLUMN     "month" TEXT;

-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "paymentFrequency" "PaymentFrequency" NOT NULL DEFAULT 'monthly';
