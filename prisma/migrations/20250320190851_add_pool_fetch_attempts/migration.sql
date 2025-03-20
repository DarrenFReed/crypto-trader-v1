-- CreateTable
CREATE TABLE "Market" (
    "marketId" TEXT NOT NULL,
    "base_mint" TEXT NOT NULL,
    "quote_mint" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_updated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Market_pkey" PRIMARY KEY ("marketId")
);

-- CreateTable
CREATE TABLE "Pool" (
    "poolId" TEXT NOT NULL,
    "base_mint" TEXT NOT NULL,
    "quote_mint" TEXT NOT NULL,
    "market_id" TEXT NOT NULL,
    "base_decimals" INTEGER NOT NULL,
    "quote_decimals" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_updated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pool_pkey" PRIMARY KEY ("poolId")
);

-- CreateIndex
CREATE INDEX "Market_base_mint_idx" ON "Market"("base_mint");

-- CreateIndex
CREATE INDEX "Market_quote_mint_idx" ON "Market"("quote_mint");

-- CreateIndex
CREATE INDEX "Pool_base_mint_idx" ON "Pool"("base_mint");

-- CreateIndex
CREATE INDEX "Pool_quote_mint_idx" ON "Pool"("quote_mint");

-- CreateIndex
CREATE INDEX "Pool_market_id_idx" ON "Pool"("market_id");
