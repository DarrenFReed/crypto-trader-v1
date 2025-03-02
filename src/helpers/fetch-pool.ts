import { Connection, PublicKey } from '@solana/web3.js';
import { LIQUIDITY_STATE_LAYOUT_V4, LiquidityPoolKeys } from '@raydium-io/raydium-sdk';

// Fetch all Raydium pools
async function fetchAllRaydiumPools(connection: Connection): Promise<LiquidityPoolKeys[]> {
  const RAYDIUM_LIQUIDITY_PROGRAM_ID = new PublicKey('RAYDIUM_PROGRAM_ID_HERE'); // Replace with actual program ID

  // Fetch all program accounts related to the liquidity pools
  const accounts = await connection.getProgramAccounts(RAYDIUM_LIQUIDITY_PROGRAM_ID, {
    filters: [
      { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span }, // Filter for Raydium pool accounts only
    ],
  });

  // Decode and return pool keys
  return accounts.map(({ pubkey, account }) => ({
    id: pubkey, // Pool public key
    ...LIQUIDITY_STATE_LAYOUT_V4.decode(account.data), // Decode the on-chain data
  }));
}