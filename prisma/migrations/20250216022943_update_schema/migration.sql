-- DropForeignKey
ALTER TABLE "ActiveSubscription" DROP CONSTRAINT "ActiveSubscription_token_base_address_fkey";

-- AddForeignKey
ALTER TABLE "ActiveSubscription" ADD CONSTRAINT "ActiveSubscription_token_base_address_fkey" FOREIGN KEY ("token_base_address") REFERENCES "Token"("base_address") ON DELETE RESTRICT ON UPDATE CASCADE;
