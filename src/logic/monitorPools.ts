// Refined Listeners for Raydium Pools
import { Connection, PublicKey } from '@solana/web3.js';
import { LIQUIDITY_STATE_LAYOUT_V4, MAINNET_PROGRAM_ID } from '@raydium-io/raydium-sdk';
import bs58 from 'bs58';

// Caching mechanism
const seenPools = new Set<string>();

// Custom filters for pools
import { applyFilters } from '../filters/pool-filters';

export class Listeners {
  private readonly connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  public async monitorRaydiumPools(quoteTokenMint: PublicKey): Promise<void> {
    console.log('Starting to monitor Raydium pools...');

    await this.connection.onProgramAccountChange(
      MAINNET_PROGRAM_ID.AmmV4,
      async (updatedAccountInfo, context) => {
        const pubkey = updatedAccountInfo.accountId.toBase58();
        if (seenPools.has(pubkey)) return; // Skip already processed pools

        seenPools.add(pubkey);
        console.log(`New Pool Detected: ${pubkey}`);

        try {
          const accountData = updatedAccountInfo.accountInfo.data;
          const parsedData = LIQUIDITY_STATE_LAYOUT_V4.decode(accountData);

          const baseMint = new PublicKey(parsedData.baseMint).toBase58();
          const quoteMint = new PublicKey(parsedData.quoteMint).toBase58();

          const isValid = applyFilters({ baseMint, quoteMint, parsedData });
          if (!isValid) {
            console.warn(`Filtered out pool: ${pubkey}`);
            return;
          }

          console.log('Base Mint:', baseMint);
          console.log('Quote Mint:', quoteMint);
        } catch (error) {
          console.error(`Failed to decode pool data for account: ${pubkey}`);
        }
      },
      this.connection.commitment,
      [
        { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
        {
          memcmp: {
            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint'),
            bytes: quoteTokenMint.toBase58(),
          },
        },
        {
          memcmp: {
            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('status'),
            bytes: bs58.encode([6, 0, 0, 0, 0, 0, 0, 0]),
          },
        },
      ]
    );

    console.log('Subscribed to Raydium pools.');
  }
}

// Filters/pool-filters.ts
export function applyFilters(pool: { baseMint: string; quoteMint: string; parsedData: any }): boolean {
  // Example: Skip pools with default mint values
  if (
    pool.baseMint === '11111111111111111111111111111111' ||
    pool.quoteMint === '11111111111111111111111111111111'
  ) {
    return false;
  }

  // Check for burn status
  if (pool.parsedData.isBurned) {
    console.warn('Filtered out burned pool.');
    return false;
  }

  // Check for mutability
  if (!pool.parsedData.isMutable) {
    console.warn('Filtered out immutable pool.');
    return false;
  }

  // Check for renounced mint authority
  if (pool.parsedData.mintAuthority === null) {
    console.warn('Filtered out pool with renounced mint authority.');
    return false;
  }

  // Additional pool size filter (example: size > 1000 tokens)
  if (pool.parsedData.liquiditySize < 1000) {
    console.warn('Filtered out small pool.');
    return false;
  }

  return true;
}

// Entry Point Example
(async () => {
  const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
  const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qKfpJmCmd48iaaBog43KMeP3X');

  const listeners = new Listeners(connection);
  await listeners.monitorRaydiumPools(USDC_MINT);
})();
