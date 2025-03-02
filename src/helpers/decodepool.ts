import { Connection, PublicKey } from "@solana/web3.js";
import { LIQUIDITY_STATE_LAYOUT_V4 } from "@raydium-io/raydium-sdk";

const connection = new Connection("https://solana.publicnode.com", "confirmed");

// ✅ Use the confirmed liquidity pool address
const POOL_ADDRESS = new PublicKey("5CbVTTdJcLjyCxRT5XaHhNkKXMsbSiTANGSH9gg5V5Y3");

async function decodeRaydiumPool() {
  try {
    console.log(`🔍 Fetching and decoding Raydium Pool: ${POOL_ADDRESS.toBase58()}`);

    const accountInfo = await connection.getAccountInfo(POOL_ADDRESS);

    if (!accountInfo) {
      console.log("❌ No data found for this pool. It may be inactive.");
      return;
    }

    // ✅ Decode the pool data using Raydium's layout
    const poolData = LIQUIDITY_STATE_LAYOUT_V4.decode(accountInfo.data);

    console.log("✅ Decoded Pool Data:", poolData);
  } catch (error) {
    console.error("❌ Error decoding Raydium pool data:", error);
  }
}

// 🔥 Run the function
decodeRaydiumPool();
