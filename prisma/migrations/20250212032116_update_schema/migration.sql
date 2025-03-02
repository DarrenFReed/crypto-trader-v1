-- CreateTable
CREATE TABLE "ActiveSubscription" (
    "subscription_id" SERIAL NOT NULL,
    "token_id" TEXT NOT NULL,
    "solana_subscription_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActiveSubscription_pkey" PRIMARY KEY ("subscription_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ActiveSubscription_token_id_key" ON "ActiveSubscription"("token_id");

-- AddForeignKey
ALTER TABLE "ActiveSubscription" ADD CONSTRAINT "ActiveSubscription_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "Token"("token_id") ON DELETE CASCADE ON UPDATE CASCADE;
