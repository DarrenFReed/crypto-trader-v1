-- CreateTable
CREATE TABLE "pumpToken" (
    "base_address" TEXT NOT NULL,
    "token_status" TEXT NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL,
    "bought_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pumpToken_pkey" PRIMARY KEY ("base_address")
);
