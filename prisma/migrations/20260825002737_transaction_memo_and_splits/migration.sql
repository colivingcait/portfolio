-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN     "memo" TEXT,
ADD COLUMN     "splitParentId" TEXT;

-- CreateIndex
CREATE INDEX "BankTransaction_splitParentId_idx" ON "BankTransaction"("splitParentId");

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_splitParentId_fkey" FOREIGN KEY ("splitParentId") REFERENCES "BankTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
