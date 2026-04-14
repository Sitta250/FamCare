-- AlterTable
ALTER TABLE "HealthMetric"
ADD COLUMN "label" TEXT,
ADD COLUMN "value2" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "MetricThreshold" (
    "id" TEXT NOT NULL,
    "familyMemberId" TEXT NOT NULL,
    "type" "MetricType" NOT NULL,
    "unit" TEXT NOT NULL,
    "minValue" DOUBLE PRECISION,
    "maxValue" DOUBLE PRECISION,
    "minValue2" DOUBLE PRECISION,
    "maxValue2" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetricThreshold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MetricThreshold_familyMemberId_type_key" ON "MetricThreshold"("familyMemberId", "type");

-- AddForeignKey
ALTER TABLE "MetricThreshold" ADD CONSTRAINT "MetricThreshold_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "FamilyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
