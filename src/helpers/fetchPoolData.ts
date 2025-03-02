import axios from "axios";
import { Connection, PublicKey } from "@solana/web3.js";
import { LIQUIDITY_STATE_LAYOUT_V4 } from "@raydium-io/raydium-sdk";
import { PrismaClient } from "@prisma/client";
import { fetchMarketData } from "./fetchMarketData";
import { normalizePoolData } from "./normalizePoolData";
import { MarketCache, PoolCache } from '../cache';

const prisma = new PrismaClient();


export async function fetchPoolData(connection: Connection, poolId: string, baseMint: string) {
    console.log(`🔍 Fetching pool data for pool ID ${poolId}...`);

    try {
        // 3️⃣ Fetch full pool account info from Raydium
        const poolAccountInfo = await connection.getAccountInfo(new PublicKey(poolId));

        if (!poolAccountInfo) {
            console.log(`❌ No Raydium pool data available for ${poolId}`);
            return null;
        }

        const poolData = LIQUIDITY_STATE_LAYOUT_V4.decode(poolAccountInfo.data);

        /* const marketData = await fetchMarketData(connection, poolData.marketId.toString());

        if (!marketData) {
            console.log(`❌ No market data found for ${poolId}, skipping.`);
            return null;
        } */
        
        
        //Darren moved the pool cache save before the normalization
             
        const poolKeys = normalizePoolData(poolData, new PublicKey(baseMint));
        console.log(`Ending Base Mint: ${poolKeys.baseMint.toString()}`);
        console.log(`Ending Quote Mint: ${poolKeys.quoteMint.toString()}`);    
        console.log(`✅ Full pool data retrieved for ${poolKeys.marketId.toString()}`);

        // 4️⃣ Store Pool in DB
        await prisma.liquidityPool.upsert({
            where: { poolId },
            update: {
                tokenBaseAddress: poolKeys.baseMint.toString(),
                marketId: poolKeys.marketId.toString(),
                quoteMint: poolKeys.quoteMint.toString(),
                poolBaseVault: poolKeys.baseVault.toString(),
                poolQuoteVault: poolKeys.quoteVault.toString(),
            },
            create: {
                tokenBaseAddress: poolKeys.baseMint.toString(),
                poolId,
                marketId: poolKeys.marketId.toString(),
                quoteMint: poolKeys.quoteMint.toString(),
                poolBaseVault: poolKeys.baseVault.toString(),
                poolQuoteVault: poolKeys.quoteVault.toString(),
                createdAt: new Date(),
            },
        });

        console.log(`📌 Pool data stored in DB for ${baseMint}`);
        return poolKeys;

    } catch (error) {
        console.error(`❌ Error fetching pool data for ${baseMint}:`, error);

        // Mark as FAILED in the database
        await prisma.token.updateMany({
            where: { baseAddress: baseMint },
            data: { tokenStatus: "FAILED" },
        });

        return null;
    }
}
