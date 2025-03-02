/*
  Warnings:

  - You are about to drop the column `holders_count` on the `TokenMetrics` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "TokenMetrics" DROP COLUMN "holders_count";
