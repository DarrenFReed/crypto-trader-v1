import axios from "axios";
import { PrismaClient } from "@prisma/client";
import { fetchPoolData } from "./fetchPoolData";
import { Connection } from "telegram";


const prisma = new PrismaClient();
const MAX_RETRIES = 9; // (9 retries = 90 sec total)
const RETRY_DELAY = 2000; // (10 seconds)

export async function FetchDexData(tokenMint: string) {
    console.log(`🔍 Starting pool lookup for ${tokenMint}...`);

    // ✅ Check if we already have pool data to avoid unnecessary API calls
    const existingPool = await prisma.liquidityPool.findUnique({
        where: { tokenMint: tokenMint }
    });

    if (existingPool) {
        console.log(`✅ Pool already exists in database: ${existingPool.poolId}`);
        return existingPool;
    }

    let retries = 0;
    while (retries < MAX_RETRIES) {
        try {
            console.log(`🔄 Attempt ${retries + 1} to fetch pool data for: ${tokenMint}`);

            const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`;
            const response = await axios.get(url);
            const { data } = response;

            if (!data || !data.pairs || data.pairs.length === 0) {
                console.log("❌ No pools found, retrying...");
                retries++;
                await new Promise(res => setTimeout(res, RETRY_DELAY));
                continue;
            }

            // ✅ Find the best pool (Raydium preferred)
            const pool = data.pairs.find(p => p.dexId === "raydium") || data.pairs[0];

            // ✅ Extract relevant pool data
            const poolInfo = {
                poolId: pool.pairAddress,
                dex: pool.dexId,
                url: pool.url,
                baseToken: pool.baseToken.symbol,
                quoteToken: pool.quoteToken.symbol,
                priceNative: pool.priceNative,
                priceUsd: pool.priceUsd,
                liquidityUsd: pool.liquidity.usd,
                volume24h: pool.volume.h24,
                transactionCounts: pool.txns.h24,
            };

            console.log(`✅ Found Pool: ${poolInfo.poolId} (${poolInfo.dex})`);

            // ✅ Store the pool in the database
            await prisma.liquidityPool.create({
                data: {
                    tokenMint: tokenMint,
                    poolId: poolInfo.poolId,
                    marketId: poolInfo.url, // Using the URL as marketId (modify if needed)
                    quoteMint: pool.quoteToken.address
                },
            });

            // ✅ Update token status in the database
            await prisma.token.updateMany({
                where: { baseAddress: tokenMint },
                data: {
                    status: "POOL_FOUND",
                },
            });

            return poolInfo; // ✅ Return pool information

        } catch (error) {
            console.error("❌ Error fetching pool info:", error);
        }

        retries++;
        await new Promise(res => setTimeout(res, RETRY_DELAY)); // Wait before retrying
    }

    console.log(`⏳ Pool not found for ${tokenMint} after ${MAX_RETRIES * (RETRY_DELAY / 1000)} sec. Marking as FAILED.`);

    // ❌ Mark token as failed if no pool found after retries
    await prisma.token.updateMany({
        where: { baseAddress: tokenMint },
        data: {
            status: "FAILED",
        },
    });

    return null;
}

