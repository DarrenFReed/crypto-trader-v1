/*
  Warnings:

  - Added the required column `buy_price` to the `pumpToken` table without a default value. This is not possible if the table is not empty.
  - Added the required column `buy_tx_hash` to the `pumpToken` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "pumpToken" ADD COLUMN     "buy_price" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "buy_tx_hash" TEXT NOT NULL,
ADD COLUMN     "profit" DOUBLE PRECISION,
ADD COLUMN     "sell_price" DOUBLE PRECISION,
ADD COLUMN     "sell_tx_hash" TEXT;
