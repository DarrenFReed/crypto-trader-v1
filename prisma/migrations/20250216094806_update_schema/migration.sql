-- DropForeignKey
ALTER TABLE "ActiveSubscription" DROP CONSTRAINT "ActiveSubscription_token_base_address_fkey";

-- DropIndex
DROP INDEX "ActiveSubscription_token_base_address_key";
