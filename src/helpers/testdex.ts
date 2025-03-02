import axios from "axios";

/**
 * Fetches pool data from DexScreener for a given token mint.
 * @param tokenMint - The token mint address (e.g., base token mint).
 * @returns Pool details including pair address, price, liquidity, and volume.
 */
export async function FetchDexData(tokenMint: string) {
    try {
        console.log(`🔍 Fetching DexScreener Pool Info for: ${tokenMint}...`);

        // API URL for DexScreener
        const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`;

        // Fetch API response
        const response = await axios.get(url);

        // Extract data from response
        const { data } = response;

        if (!data || !data.pairs || data.pairs.length === 0) {
            console.log("❌ No pools found for this token.");
            return null;
        }

        // Select the first available pool (Raydium preferred)
        const pool = data.pairs.find(p => p.dexId === "raydium") || data.pairs[0];

        // Extract relevant information
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
        console.log(poolInfo);
        return poolInfo;
    } catch (error) {
        console.error("❌ Error fetching DexScreener pool info:", error);
        return null;
    }
}

// 🔥 Example Usage:
const TOKEN_MINT = "6dUc7Lba13xH35qJ5PvXMHCuV9yv9ATz7a42HPchpump";
FetchDexData(TOKEN_MINT);
