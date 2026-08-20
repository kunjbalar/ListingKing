-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('MEESHO');

-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('ACTIVE', 'NEEDS_REMAPPING', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SmartListingStatus" AS ENUM ('DRAFT', 'READY', 'PARTIALLY_FILLED', 'COMPLETED', 'NEEDS_REMAPPING', 'ERROR', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('DRAFT', 'READY', 'FILLING', 'FILLED', 'ERROR');

-- CreateEnum
CREATE TYPE "ImageRole" AS ENUM ('FRONT', 'SIDE', 'DETAIL', 'BACK');

-- CreateEnum
CREATE TYPE "FillJobStatus" AS ENUM ('STARTED', 'SUCCESS', 'PARTIAL', 'FAILED', 'DRY_RUN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL DEFAULT 'MEESHO',
    "name" TEXT NOT NULL,
    "categoryLabel" TEXT NOT NULL,
    "status" "TemplateStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "schemaJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastValidatedAt" TIMESTAMP(3),

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateField" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "inputType" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "selectorCandidatesJson" JSONB NOT NULL,
    "mappingJson" JSONB NOT NULL,
    "defaultValueJson" JSONB,
    "position" INTEGER NOT NULL,

    CONSTRAINT "TemplateField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmartListing" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "SmartListingStatus" NOT NULL DEFAULT 'DRAFT',
    "productDetailsJson" JSONB NOT NULL,
    "listingCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmartListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmartListingItem" (
    "id" TEXT NOT NULL,
    "smartListingId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "mrp" DECIMAL(10,2),
    "meeshoPrice" DECIMAL(10,2),
    "defectivePrice" DECIMAL(10,2),
    "sku" TEXT,
    "status" "ItemStatus" NOT NULL DEFAULT 'DRAFT',
    "validationJson" JSONB,

    CONSTRAINT "SmartListingItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingImage" (
    "id" TEXT NOT NULL,
    "smartListingItemId" TEXT NOT NULL,
    "role" "ImageRole" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ListingImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiGeneration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "smartListingItemId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "outputJson" JSONB NOT NULL,
    "warningsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FillJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "smartListingItemId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "status" "FillJobStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "resultsJson" JSONB,
    "errorJson" JSONB,

    CONSTRAINT "FillJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Template_userId_platform_status_idx" ON "Template"("userId", "platform", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateField_templateId_fieldKey_key" ON "TemplateField"("templateId", "fieldKey");

-- CreateIndex
CREATE INDEX "SmartListing_userId_status_updatedAt_idx" ON "SmartListing"("userId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "SmartListingItem_sku_idx" ON "SmartListingItem"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "SmartListingItem_smartListingId_position_key" ON "SmartListingItem"("smartListingId", "position");

-- CreateIndex
CREATE INDEX "ListingImage_smartListingItemId_role_idx" ON "ListingImage"("smartListingItemId", "role");

-- CreateIndex
CREATE INDEX "ListingImage_checksum_idx" ON "ListingImage"("checksum");

-- CreateIndex
CREATE INDEX "AiGeneration_userId_inputHash_idx" ON "AiGeneration"("userId", "inputHash");

-- CreateIndex
CREATE INDEX "FillJob_userId_status_idx" ON "FillJob"("userId", "status");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateField" ADD CONSTRAINT "TemplateField_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmartListing" ADD CONSTRAINT "SmartListing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmartListing" ADD CONSTRAINT "SmartListing_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmartListingItem" ADD CONSTRAINT "SmartListingItem_smartListingId_fkey" FOREIGN KEY ("smartListingId") REFERENCES "SmartListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingImage" ADD CONSTRAINT "ListingImage_smartListingItemId_fkey" FOREIGN KEY ("smartListingItemId") REFERENCES "SmartListingItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiGeneration" ADD CONSTRAINT "AiGeneration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiGeneration" ADD CONSTRAINT "AiGeneration_smartListingItemId_fkey" FOREIGN KEY ("smartListingItemId") REFERENCES "SmartListingItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FillJob" ADD CONSTRAINT "FillJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FillJob" ADD CONSTRAINT "FillJob_smartListingItemId_fkey" FOREIGN KEY ("smartListingItemId") REFERENCES "SmartListingItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
