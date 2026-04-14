-- AlterTable
ALTER TABLE "Medication"
ADD COLUMN "lowStockThreshold" INTEGER,
ADD COLUMN "lastLowStockAlertDate" TEXT;
