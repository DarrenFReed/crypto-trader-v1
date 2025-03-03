/*
  Warnings:

  - You are about to drop the column `pool_id` on the `Trade` table. All the data in the column will be lost.
  - You are about to drop the column `trade_status` on the `Trade` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Trade" DROP CONSTRAINT "Trade_pool_id_fkey";

-- AlterTable
ALTER TABLE "Trade" DROP COLUMN "pool_id",
DROP COLUMN "trade_status";
