import { Connection, PublicKey } from "@solana/web3.js";
import { LIQUIDITY_STATE_LAYOUT_V4 } from "@raydium-io/raydium-sdk";

// Your QuickNode RPC endpoint
const QUICKNODE_RPC = "https://compatible-maximum-shape.solana-mainnet.quiknode.pro/22a4d0e420c016165a9a45257ec45af9da308db3";
const connection = new Connection(QUICKNODE_RPC, "confirmed");

// Replace with your base mint address
const BASE_MINT = "FZsyzC4gVk8qJbi8kFaLbH5CPjjbXfau34UFGzWVpump";

async function getPoolId(baseMint: string) {
    console.log(`🔍 Fetching liquidity pool for base mint: ${baseMint}`);

    // Step 1: Get the pool account from Raydium
    const filters = [
        {
            dataSize: 560, // Liquidity pool account size in bytes (Raydium specific)
        },
        {
            memcmp: {
                offset: 8, // Offset where base mint address is stored
                bytes: baseMint,
            },
        },
    ];

    const accounts = await connection.getProgramAccounts(
        new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"), // Raydium Program ID
        { filters }
    );

    if (accounts.length === 0) {
        console.log(`❌ No pool found for ${baseMint}`);
        return null;
    }

    // Step 2: Decode the liquidity state to extract the pool ID
    const poolAccountInfo = accounts[0];
    const poolData = LIQUIDITY_STATE_LAYOUT_V4.decode(poolAccountInfo.account.data);

    console.log(`✅ Pool found! Pool ID: ${poolAccountInfo.pubkey.toString()}`);
    console.log(`📌 Market ID: ${poolData.marketId.toString()}`);
    console.log(`💰 Quote Mint: ${poolData.quoteMint.toString()}`);
    console.log(`🔄 LP Mint: ${poolData.lpMint.toString()}`);

    return poolAccountInfo.pubkey.toString();
}

// Run the function
getPoolId(BASE_MINT);
