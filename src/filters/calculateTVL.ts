import { Connection, PublicKey } from '@solana/web3.js';
import { LIQUIDITY_STATE_LAYOUT_V4 } from '@raydium-io/raydium-sdk';
import { AccountLayout as splAccountLayout } from '@solana/spl-token';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * Calculates the Total Value Locked (TVL) for a Raydium liquidity pool in SOL.
 * @param poolID - The public key of the Raydium liquidity pool.
 * @param connection - The Solana connection object.
 * @returns The TVL in SOL.
 */
export async function calculateTVL(poolID: PublicKey, connection: Connection): Promise<number> {
  try {
    // Fetch the pool's account data
    const poolAccountInfo = await connection.getAccountInfo(poolID);

    if (!poolAccountInfo?.data) {
      throw new Error(`No Raydium pool data available for ${poolID.toString()}`);
    }

    // Decode the pool state using Raydium's liquidity state layout
    const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(poolAccountInfo.data);

    // Identify whether WSOL is the base mint
    const isWsolBase = poolState.baseMint.toString() === WSOL_MINT;

    // Fetch the base vault and quote vault accounts
    const baseVault = new PublicKey(poolState.baseVault);
    const quoteVault = new PublicKey(poolState.quoteVault);

    // Fetch base & quote reserves
    const baseVaultInfo = await connection.getAccountInfo(baseVault);
    const quoteVaultInfo = await connection.getAccountInfo(quoteVault);

    if (!baseVaultInfo?.data || !quoteVaultInfo?.data) {
      throw new Error('Vault account data missing.');
    }

    const baseReserve = new BN(splAccountLayout.decode(baseVaultInfo.data).amount.toString();
    const quoteReserve = new BN(splAccountLayout.decode(quoteVaultInfo.data).amount.toString();

    // Convert reserves to human-readable amounts
    const baseReserveHuman = isWsolBase
      ? Number(baseReserve) / LAMPORTS_PER_SOL // Convert lamports to SOL
      : Number(baseReserve) / Math.pow(10, poolState.baseDecimal.toNumber()); // Adjust for token decimals

    const quoteReserveHuman = isWsolBase
      ? Number(quoteReserve) / Math.pow(10, poolState.quoteDecimal.toNumber()) // Adjust for token decimals
      : Number(quoteReserve) / LAMPORTS_PER_SOL; // Convert lamports to SOL

    // Calculate the current price based on reserves
    const currentPrice = isWsolBase
      ? baseReserveHuman / quoteReserveHuman // Price = SOL per token
      : quoteReserveHuman / baseReserveHuman; // Price = SOL per token

    // Calculate TVL in SOL
    const tvlInSOL = (baseReserveHuman * currentPrice) + (quoteReserveHuman * 1); // TVL = (Base Reserve * Base Token Price) + (Quote Reserve * 1)
    return tvlInSOL;
  } catch (error) {
    console.error(`⚠️ Failed to calculate TVL for pool ${poolID.toString()}:`, error);
    throw error;
  }
}