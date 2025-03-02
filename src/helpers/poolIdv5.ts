import { Connection, PublicKey, Commitment } from "@solana/web3.js";
import {
  LIQUIDITY_STATE_LAYOUT_V4,
  MARKET_STATE_LAYOUT_V3,
  MAINNET_PROGRAM_ID,
} from "@raydium-io/raydium-sdk";

// Helius RPC Connection
const HELIUS_RPC_URL = "https://mainnet.helius-rpc.com/?api-key=d3b9094d-91fa-4531-9f6c-019cebcedead";
const connection = new Connection(HELIUS_RPC_URL, "confirmed");

// Fetch and decode OpenBook accounts
async function fetchOpenBookAccounts(
  baseMint: PublicKey,
  quoteMint: PublicKey,
  commitment: Commitment = "confirmed"
): Promise<any[]> {
  const accounts = await connection.getProgramAccounts(MAINNET_PROGRAM_ID.OPENBOOK_MARKET, {
    commitment,
    filters: [
      { dataSize: MARKET_STATE_LAYOUT_V3.span },
      {
        memcmp: {
          offset: MARKET_STATE_LAYOUT_V3.offsetOf("baseMint"),
          bytes: baseMint.toBase58(),
        },
      },
      {
        memcmp: {
          offset: MARKET_STATE_LAYOUT_V3.offsetOf("quoteMint"),
          bytes: quoteMint.toBase58(),
        },
      },
    ],
  });

  return accounts.map(({ account }) => MARKET_STATE_LAYOUT_V3.decode(account.data));
}

// Fetch and decode Market accounts
async function fetchMarketAccounts(
  baseMint: PublicKey,
  quoteMint: PublicKey,
  commitment: Commitment = "confirmed"
): Promise<any[]> {
  const accounts = await connection.getProgramAccounts(MAINNET_PROGRAM_ID.AMM_V4, {
    commitment,
    filters: [
      { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
      {
        memcmp: {
          offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf("baseMint"),
          bytes: baseMint.toBase58(),
        },
      },
      {
        memcmp: {
          offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf("quoteMint"),
          bytes: quoteMint.toBase58(),
        },
      },
    ],
  });

  return accounts.map(({ pubkey, account }) => ({
    id: pubkey.toString(),
    ...LIQUIDITY_STATE_LAYOUT_V4.decode(account.data),
  }));
}

// Example Usage
(async () => {
  try {
    // Replace with actual token mints
    const baseMint = new PublicKey("So11111111111111111111111111111111111111112"); // WSOL
    const quoteMint = new PublicKey("Sa7mxdXXRk7SgaPyvK5nCpYtSFgdvQNucDA4w8bpump"); // Example Meme Coin

    console.log("Fetching OpenBook Accounts...");
    const openBookAccounts = await fetchOpenBookAccounts(baseMint, quoteMint);
    console.log("OpenBook Accounts:", openBookAccounts);

    console.log("Fetching Market Accounts...");
    const marketAccounts = await fetchMarketAccounts(baseMint, quoteMint);
    console.log("Market Accounts:", marketAccounts);
  } catch (error) {
    console.error("Error:", error);
  }
})();
