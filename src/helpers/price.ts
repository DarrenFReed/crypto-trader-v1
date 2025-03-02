import { Token, TokenAmount, Percent, Price, Liquidity, LIQUIDITY_STATE_LAYOUT_V4, MAINNET_PROGRAM_ID, LiquidityPoolKeys } from "@raydium-io/raydium-sdk";
import { Connection, PublicKey } from "@solana/web3.js";

// Define your RPC connection
const connection = new Connection("https://api.mainnet-beta.solana.com");

// Function to check bonding curve status for pump.fun tokens
async function checkBondingCurveStatus(mintAddress: string): Promise<boolean> {
    try {
        const response = await fetch(`https://api.pump.fun/v1/tokens/${mintAddress}/bonding-status`);
        const data = await response.json();

        if (data.status === "bonded") {
            return true;
        } else {
            return false;
        }
    } catch (error) {
        console.error("Error checking bonding curve status:", error);
        return false;
    }
}










// Example: Fetching price for a token
async function fetchTokenPriceRaydium(mintAddress: string): Promise<number | null> {
    try {
        // Check bonding curve status
        const isBonded = await checkBondingCurveStatus(mintAddress);
        if (!isBonded) {
            console.log("Token is not yet bonded.");
            return null;
        }

        // Fetch liquidity pools
        const pools = await fetchLiquidityPools();
        const pool = pools.find(p => p.baseMint.toBase58() === mintAddress || p.quoteMint.toBase58() === mintAddress);

        if (!pool) {
            console.error("Liquidity pool not found for token.");
            return null;
        }

        // Fetch pool account data
        const poolInfo = await connection.getAccountInfo(pool.id);
        if (!poolInfo) {
            console.error("Failed to fetch pool data.");
            return null;
        }

        // Parse pool data
        const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(poolInfo.data);

        const baseReserve = new TokenAmount(new Token(0, pool.baseMint, pool.baseDecimals), poolState.baseReserve.toNumber());
        const quoteReserve = new TokenAmount(new Token(0, pool.quoteMint, pool.quoteDecimals), poolState.quoteReserve.toNumber());

        // Compute price
        const price = new Price(baseReserve.token, quoteReserve.token, baseReserve.raw, quoteReserve.raw);
        return price.toFixed();

    } catch (error) {
        console.error("Error fetching token price:", error);
        return null;
    }
}

// Helper function to fetch liquidity pools
async function fetchLiquidityPools(): Promise<LiquidityPoolKeys[]> {
    const response = await fetch("https://api.raydium.io/v2/sdk/liquidity/mainnet.json");
    const data = await response.json();
    return data.pools;
}

// Example usage
const MINT_ADDRESS = "2Bs4MW8NKBDy6Bsn2RmGLNYNn4ofccVWMHEiRcVvpump"; // Replace with actual mint address
fetchTokenPriceRaydium(MINT_ADDRESS).then(price => {
    if (price) {
        console.log(`Token price: ${price}`);
    } else {
        console.log("Failed to fetch token price.");
    }
});
