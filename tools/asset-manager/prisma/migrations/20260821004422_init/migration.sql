-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('TILESET', 'SPRITE', 'SPRITE_SHEET', 'CHARACTER', 'OBJECT', 'ENVIRONMENT', 'BUILDING', 'ANIMATION', 'UI', 'FONT', 'MAP_RESOURCE', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetPlacement" AS ENUM ('floor', 'wall', 'ceiling', 'overlay');

-- CreateEnum
CREATE TYPE "TilesetKind" AS ENUM ('grid', 'collection');

-- CreateEnum
CREATE TYPE "FileRole" AS ENUM ('original', 'thumbnail', 'tsj', 'tsx', 'atlas', 'tile_image', 'zip');

-- CreateTable
CREATE TABLE "License" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "licenseName" TEXT,
    "licenseUrl" TEXT,
    "source" TEXT,
    "sourceUrl" TEXT,
    "author" TEXT,
    "attributionRequired" BOOLEAN NOT NULL DEFAULT true,
    "commercialUseAllowed" BOOLEAN NOT NULL DEFAULT true,
    "redistributionAllowed" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "License_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetPack" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "source" TEXT,
    "sourceUrl" TEXT,
    "author" TEXT,
    "tileSize" INTEGER,
    "licenseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tileset" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TilesetKind" NOT NULL DEFAULT 'grid',
    "tileWidth" INTEGER NOT NULL,
    "tileHeight" INTEGER NOT NULL,
    "columns" INTEGER NOT NULL DEFAULT 0,
    "tileCount" INTEGER NOT NULL DEFAULT 0,
    "imageWidth" INTEGER,
    "imageHeight" INTEGER,
    "version" TEXT NOT NULL DEFAULT '1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tileset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "AssetType" NOT NULL DEFAULT 'OBJECT',
    "category" TEXT NOT NULL DEFAULT 'uncategorized',
    "subcategory" TEXT,
    "style" TEXT,
    "source" TEXT,
    "sourceUrl" TEXT,
    "author" TEXT,
    "version" TEXT NOT NULL DEFAULT '1',
    "tileSize" INTEGER NOT NULL DEFAULT 16,
    "widthTiles" INTEGER NOT NULL DEFAULT 1,
    "heightTiles" INTEGER NOT NULL DEFAULT 1,
    "placement" "AssetPlacement" NOT NULL DEFAULT 'floor',
    "tilesetId" TEXT,
    "tileId" INTEGER,
    "collision" JSONB,
    "interaction" JSONB,
    "packId" TEXT NOT NULL,
    "licenseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetFile" (
    "id" TEXT NOT NULL,
    "role" "FileRole" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER,
    "height" INTEGER,
    "sha256" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assetId" TEXT,
    "tilesetId" TEXT,
    "packId" TEXT,

    CONSTRAINT "AssetFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_AssetTags" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AssetTags_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssetPack_slug_key" ON "AssetPack"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Tileset_key_key" ON "Tileset"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_slug_key" ON "Asset"("slug");

-- CreateIndex
CREATE INDEX "Asset_category_idx" ON "Asset"("category");

-- CreateIndex
CREATE INDEX "Asset_type_idx" ON "Asset"("type");

-- CreateIndex
CREATE INDEX "Asset_tilesetId_idx" ON "Asset"("tilesetId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_slug_key" ON "Tag"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "AssetFile_storageKey_key" ON "AssetFile"("storageKey");

-- CreateIndex
CREATE INDEX "AssetFile_assetId_idx" ON "AssetFile"("assetId");

-- CreateIndex
CREATE INDEX "AssetFile_tilesetId_idx" ON "AssetFile"("tilesetId");

-- CreateIndex
CREATE INDEX "_AssetTags_B_index" ON "_AssetTags"("B");

-- AddForeignKey
ALTER TABLE "AssetPack" ADD CONSTRAINT "AssetPack_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "License"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tileset" ADD CONSTRAINT "Tileset_packId_fkey" FOREIGN KEY ("packId") REFERENCES "AssetPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_packId_fkey" FOREIGN KEY ("packId") REFERENCES "AssetPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_tilesetId_fkey" FOREIGN KEY ("tilesetId") REFERENCES "Tileset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "License"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetFile" ADD CONSTRAINT "AssetFile_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetFile" ADD CONSTRAINT "AssetFile_tilesetId_fkey" FOREIGN KEY ("tilesetId") REFERENCES "Tileset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetFile" ADD CONSTRAINT "AssetFile_packId_fkey" FOREIGN KEY ("packId") REFERENCES "AssetPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AssetTags" ADD CONSTRAINT "_AssetTags_A_fkey" FOREIGN KEY ("A") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AssetTags" ADD CONSTRAINT "_AssetTags_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
