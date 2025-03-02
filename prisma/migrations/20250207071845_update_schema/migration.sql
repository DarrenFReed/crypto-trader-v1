/*
  Warnings:

  - Added the required column `token_status` to the `Token` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "TokenStatus" ADD VALUE 'BUY_CANDIDATE';

-- AlterTable
ALTER TABLE "Token" ADD COLUMN     "token_status" TEXT NOT NULL;
