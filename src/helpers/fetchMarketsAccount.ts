import { Connection, PublicKey, Commitment } from "@solana/web3.js";
import { LIQUIDITY_STATE_LAYOUT_V4, MAINNET_PROGRAM_ID } from "@raydium-io/raydium-sdk";

// Define the function signature with explicit types
export const fetchMarketAccounts = async (
  connection: Connection,
  base: PublicKey,
  quote: PublicKey,
  commitment?: Commitment
): Promise<{ id: string; data: any } | undefined> => {
  try {
    // Fetching program accounts using Solana's getProgramAccounts method
    const accounts = await connection.getProgramAccounts(MAINNET_PROGRAM_ID.AmmV4, {
      commitment,
      filters: [
        { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span }, // Filter by expected data size
        {
          memcmp: {
            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf("baseMint"),
            bytes: base.toBase58(),
          },
        },
        {
          memcmp: {
            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf("quoteMint"),
            bytes: quote.toBase58(),
          },
        },
      ],
    });

    // Map and decode the account data
    const rawData = accounts.map(({ pubkey, account }) => ({
      id: pubkey.toString(),
      data: LIQUIDITY_STATE_LAYOUT_V4.decode(account.data),
    }));

    // Return the first found market account or undefined if none found
    console.log(rawData);
    return rawData[0];
  } catch (error) {
    console.error("fetchMarketAccounts error:", error);
  }
};