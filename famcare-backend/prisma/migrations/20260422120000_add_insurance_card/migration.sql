-- CreateTable
CREATE TABLE "InsuranceCard" (
    "id" TEXT NOT NULL,
    "familyMemberId" TEXT NOT NULL,
    "addedByUserId" TEXT NOT NULL,
    "companyName" TEXT,
    "policyNumber" TEXT,
    "groupNumber" TEXT,
    "expirationDate" TIMESTAMP(3),
    "policyHolderName" TEXT,
    "dependentRelationship" TEXT,
    "customerServicePhone" TEXT,
    "emergencyPhone" TEXT,
    "coverageType" TEXT,
    "coverageSummary" TEXT,
    "frontPhotoUrl" TEXT,
    "backPhotoUrl" TEXT,
    "frontPhotoPublicId" TEXT,
    "backPhotoPublicId" TEXT,
    "extractedText" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "allowViewerFullAccess" BOOLEAN NOT NULL DEFAULT false,
    "reminder60dSent" BOOLEAN NOT NULL DEFAULT false,
    "reminder30dSent" BOOLEAN NOT NULL DEFAULT false,
    "reminder7dSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InsuranceCard_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "InsuranceCard" ADD CONSTRAINT "InsuranceCard_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "FamilyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
