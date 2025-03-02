/*
  Warnings:

  - You are about to drop the column `base_decimals` on the `LiquidityPool` table. All the data in the column will be lost.
  - You are about to drop the column `base_mint` on the `LiquidityPool` table. All the data in the column will be lost.
  - You are about to drop the column `base_reserve` on the `LiquidityPool` table. All the data in the column will be lost.
  - You are about to drop the column `is_reversed` on the `LiquidityPool` table. All the data in the column will be lost.
  - You are about to drop the column `quote_decimals` on the `LiquidityPool` table. All the data in the column will be lost.
  - You are about to drop the column `quote_reserve` on the `LiquidityPool` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "LiquidityPool" DROP COLUMN "base_decimals",
DROP COLUMN "base_mint",
DROP COLUMN "base_reserve",
DROP COLUMN "is_reversed",
DROP COLUMN "quote_decimals",
DROP COLUMN "quote_reserve";
