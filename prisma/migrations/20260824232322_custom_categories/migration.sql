-- CreateTable
CREATE TABLE "CustomCategory" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "class" TEXT NOT NULL,
    "taxLine" TEXT,
    "taxTreatment" TEXT NOT NULL,
    "note" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomCategory_key_key" ON "CustomCategory"("key");
