/*
  Warnings:

  - The values [TRADED] on the enum `TokenStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "TokenStatus_new" AS ENUM ('WAITING_FOR_POOL', 'POOL_FOUND', 'BUY_CANDIDATE', 'BOUGHT', 'SOLD', 'FAILED', 'ACTIVE');
ALTER TABLE "Token" ALTER COLUMN "token_status" DROP DEFAULT;
ALTER TABLE "Token" ALTER COLUMN "token_status" TYPE "TokenStatus_new" USING ("token_status"::text::"TokenStatus_new");
ALTER TYPE "TokenStatus" RENAME TO "TokenStatus_old";
ALTER TYPE "TokenStatus_new" RENAME TO "TokenStatus";
DROP TYPE "TokenStatus_old";
ALTER TABLE "Token" ALTER COLUMN "token_status" SET DEFAULT 'WAITING_FOR_POOL';
COMMIT;
