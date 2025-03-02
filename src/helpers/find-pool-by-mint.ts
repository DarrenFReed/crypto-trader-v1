import { Connection, PublicKey } from '@solana/web3.js';
import { LIQUIDITY_STATE_LAYOUT_V4 } from '@raydium-io/raydium-sdk';

// ✅ Hardcoded RPC Endpoint (Replace with your API key if needed)
const RPC_ENDPOINT = "https://solana.publicnode.com";
const connection = new Connection(RPC_ENDPOINT, 'confirmed');

// ✅ Raydium Program ID (Use the correct program ID for pools)
const RAYDIUM_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');

// ✅ Hardcoded Base & Quote Mints
const BASE_MINT = new PublicKey("9uojCpt1ZSFmjAwZKMDmR38bThn5FGeurr781dz3pump");  // Replace with actual token
const QUOTE_MINT = new PublicKey("So11111111111111111111111111111111111111112"); // WSOL

async function findPoolByMints() {
  try {
    console.log(`🔍 Searching for Raydium Pool for ${BASE_MINT.toBase58()} / ${QUOTE_MINT.toBase58()}...`);

    const filters = [
      {
        memcmp: {
          offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('baseMint'),
          bytes: BASE_MINT.toBase58(),
        },
      },
      {
        memcmp: {
          offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint'),
          bytes: QUOTE_MINT.toBase58(),
        },
      },
    ];

    // ✅ Fetch Pool Accounts
    const poolAccounts = await connection.getProgramAccounts(RAYDIUM_PROGRAM_ID, { filters });

    if (poolAccounts.length === 0) {
      console.log('❌ No matching pool found.');
      return;
    }

    // ✅ Decode Pool Data
    const pool = LIQUIDITY_STATE_LAYOUT_V4.decode(poolAccounts[0].account.data);

    console.log(`✅ Market ID: ${pool.marketId.toString()}`);
    console.log(`✅ Pool ID: ${pool.lpMint.toString()}`);
  } catch (error) {
    console.error("❌ Error fetching pool:", error);
  }
}

// 🔥 Run the function
findPoolByMints();
