import axios from 'axios';
import { PublicKey } from '@solana/web3.js';

const TOKEN_MINT = "9uojCpt1ZSFmjAwZKMDmR38bThn5FGeurr781dz3pump"; // ✅ Your hardcoded token mint
const QUOTE_MINT = "So11111111111111111111111111111111111111112"; // ✅ WSOL as the quote token

async function fetchRaydiumPoolInfo(tokenMint: string, quoteMint: string) {
    const poolType = "standard";
    const poolSortField = "default";
    const sortType = "desc";
    const pageSize = 100;
    const page = 1;

    const url = `https://api-v3.raydium.io/pools/info/mint?mint1=${tokenMint}&mint2=${quoteMint}&poolType=${poolType}&poolSortField=${poolSortField}&sortType=${sortType}&pageSize=${pageSize}&page=${page}`;

    try {
        console.log(`🔍 Fetching Raydium Pool for Token Mint: ${tokenMint}...`);
        const response = await axios.get(url);

        if (!response.data || !response.data.data || !Array.isArray(response.data.data)) {
            console.log("❌ No valid data found in the response.");
            return null;
        }

        return response.data.data; // ✅ Return the array of pool data
    } catch (error) {
        console.error("❌ Error fetching pool info:", error);
        return null;
    }
}

async function getRaydiumPool(tokenMint: string, quoteMint: string) {
    const poolData = await fetchRaydiumPoolInfo(tokenMint, quoteMint);

    if (!poolData || poolData.length === 0) {
        console.log("❌ No pool found for the given mint pair.");
        return null;
    }

    // ✅ Find the correct pool
    const tokenPool = poolData.find(p => 
        p.mintA.address === tokenMint || p.mintB.address === tokenMint
    );

    if (!tokenPool) {
        console.log("❌ No matching pool found.");
        return null;
    }

    // ✅ Extract Pool ID
    const poolId = new PublicKey(tokenPool.id);
    console.log(`✅ Found Raydium Pool ID: ${poolId.toBase58()}`);

    return poolId;
}

// 🔥 Run the function
getRaydiumPool(TOKEN_MINT, QUOTE_MINT);
