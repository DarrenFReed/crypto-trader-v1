/*
  Warnings:

  - Added the required column `base_decimals` to the `LiquidityPool` table without a default value. This is not possible if the table is not empty.
  - Added the required column `base_mint` to the `LiquidityPool` table without a default value. This is not possible if the table is not empty.
  - Added the required column `quote_decimals` to the `LiquidityPool` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "LiquidityPool" ADD COLUMN     "base_decimals" INTEGER NOT NULL,
ADD COLUMN     "base_mint" TEXT NOT NULL,
ADD COLUMN     "base_reserve" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "quote_decimals" INTEGER NOT NULL,
ADD COLUMN     "quote_reserve" DOUBLE PRECISION NOT NULL DEFAULT 0;
