-- CreateTable
CREATE TABLE "TokenHolders" (
    "holders_id" SERIAL NOT NULL,
    "token_base_address" TEXT NOT NULL,
    "holders_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenHolders_pkey" PRIMARY KEY ("holders_id")
);

-- AddForeignKey
ALTER TABLE "TokenHolders" ADD CONSTRAINT "TokenHolders_token_base_address_fkey" FOREIGN KEY ("token_base_address") REFERENCES "Token"("base_address") ON DELETE CASCADE ON UPDATE CASCADE;
