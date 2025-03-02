/*
  Warnings:

  - You are about to drop the column `base_lp_amount` on the `TokenMetrics` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Token" ADD COLUMN     "base_lp_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "quote_lp_amount" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "TokenMetrics" DROP COLUMN "base_lp_amount";
