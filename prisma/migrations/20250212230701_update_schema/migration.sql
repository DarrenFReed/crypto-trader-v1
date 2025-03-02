/*
  Warnings:

  - The `token_status` column on the `Token` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "Token" DROP COLUMN "token_status",
ADD COLUMN     "token_status" "TokenStatus" NOT NULL DEFAULT 'WAITING_FOR_POOL';
