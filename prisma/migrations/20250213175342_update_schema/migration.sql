/*
  Warnings:

  - You are about to drop the column `token_id` on the `ActiveSubscription` table. All the data in the column will be lost.
  - You are about to drop the column `token_id` on the `LiquidityPool` table. All the data in the column will be lost.
  - The primary key for the `Token` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `token_id` on the `Token` table. All the data in the column will be lost.
  - You are about to drop the column `token_id` on the `TokenMetrics` table. All the data in the column will be lost.
  - You are about to drop the column `token_id` on the `Trade` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[token_base_address]` on the table `ActiveSubscription` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[token_base_address]` on the table `TokenMetrics` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `token_base_address` to the `ActiveSubscription` table without a default value. This is not possible if the table is not empty.
  - Added the required column `token_base_address` to the `LiquidityPool` table without a default value. This is not possible if the table is not empty.
  - Added the required column `token_base_address` to the `TokenMetrics` table without a default value. This is not possible if the table is not empty.
  - Added the required column `token_base_address` to the `Trade` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "ActiveSubscription" DROP CONSTRAINT "ActiveSubscription_token_id_fkey";

-- DropForeignKey
ALTER TABLE "LiquidityPool" DROP CONSTRAINT "LiquidityPool_token_id_fkey";

-- DropForeignKey
ALTER TABLE "TokenMetrics" DROP CONSTRAINT "TokenMetrics_token_id_fkey";

-- DropForeignKey
ALTER TABLE "Trade" DROP CONSTRAINT "Trade_token_id_fkey";

-- DropIndex
DROP INDEX "ActiveSubscription_token_id_key";

-- DropIndex
DROP INDEX "Token_base_address_key";

-- DropIndex
DROP INDEX "TokenMetrics_token_id_key";

-- AlterTable
ALTER TABLE "ActiveSubscription" DROP COLUMN "token_id",
ADD COLUMN     "token_base_address" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "LiquidityPool" DROP COLUMN "token_id",
ADD COLUMN     "token_base_address" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Token" DROP CONSTRAINT "Token_pkey",
DROP COLUMN "token_id",
ADD CONSTRAINT "Token_pkey" PRIMARY KEY ("base_address");

-- AlterTable
ALTER TABLE "TokenMetrics" DROP COLUMN "token_id",
ADD COLUMN     "token_base_address" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Trade" DROP COLUMN "token_id",
ADD COLUMN     "token_base_address" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ActiveSubscription_token_base_address_key" ON "ActiveSubscription"("token_base_address");

-- CreateIndex
CREATE UNIQUE INDEX "TokenMetrics_token_base_address_key" ON "TokenMetrics"("token_base_address");

-- AddForeignKey
ALTER TABLE "TokenMetrics" ADD CONSTRAINT "TokenMetrics_token_base_address_fkey" FOREIGN KEY ("token_base_address") REFERENCES "Token"("base_address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiquidityPool" ADD CONSTRAINT "LiquidityPool_token_base_address_fkey" FOREIGN KEY ("token_base_address") REFERENCES "Token"("base_address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_token_base_address_fkey" FOREIGN KEY ("token_base_address") REFERENCES "Token"("base_address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveSubscription" ADD CONSTRAINT "ActiveSubscription_token_base_address_fkey" FOREIGN KEY ("token_base_address") REFERENCES "Token"("base_address") ON DELETE CASCADE ON UPDATE CASCADE;
