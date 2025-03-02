-- CreateEnum
CREATE TYPE "TokenStatus" AS ENUM ('WAITING_FOR_POOL', 'POOL_FOUND', 'TRADED', 'FAILED');

-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "Token" (
    "token_id" TEXT NOT NULL,
    "base_address" TEXT NOT NULL,
    "base_decimals" INTEGER NOT NULL,
    "quote_address" TEXT NOT NULL,
    "quote_decimals" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("token_id")
);

-- CreateTable
CREATE TABLE "TokenMetrics" (
    "metrics_id" SERIAL NOT NULL,
    "token_id" TEXT NOT NULL,
    "base_lp_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quote_lp_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "liquidity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "market_cap" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "buy_volume" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sell_volume" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "buy_count" INTEGER NOT NULL DEFAULT 0,
    "sell_count" INTEGER NOT NULL DEFAULT 0,
    "buy_sell_tx_ratio" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "buy_sell_volume_ratio" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "holders_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenMetrics_pkey" PRIMARY KEY ("metrics_id")
);

-- CreateTable
CREATE TABLE "LiquidityPool" (
    "pool_id" SERIAL NOT NULL,
    "token_id" TEXT NOT NULL,
    "pool_address" TEXT NOT NULL,
    "market_id" TEXT NOT NULL,
    "quote_mint" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiquidityPool_pkey" PRIMARY KEY ("pool_id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "trade_id" TEXT NOT NULL,
    "token_id" TEXT NOT NULL,
    "pool_id" INTEGER NOT NULL,
    "trade_status" "TradeStatus" NOT NULL DEFAULT 'PENDING',
    "executed_at" TIMESTAMP(3),
    "trade_amount" DOUBLE PRECISION NOT NULL,
    "trade_price" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("trade_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Token_base_address_key" ON "Token"("base_address");

-- CreateIndex
CREATE UNIQUE INDEX "TokenMetrics_token_id_key" ON "TokenMetrics"("token_id");

-- CreateIndex
CREATE UNIQUE INDEX "LiquidityPool_pool_address_key" ON "LiquidityPool"("pool_address");

-- AddForeignKey
ALTER TABLE "TokenMetrics" ADD CONSTRAINT "TokenMetrics_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "Token"("token_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiquidityPool" ADD CONSTRAINT "LiquidityPool_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "Token"("token_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "Token"("token_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "LiquidityPool"("pool_id") ON DELETE RESTRICT ON UPDATE CASCADE;
