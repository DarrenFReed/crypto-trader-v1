import { Connection, PublicKey } from '@solana/web3.js';
import { EventEmitter } from 'events';
import bs58 from 'bs58';

// Constants
const RPC_ENDPOINT = 'https://mainnet.helius-rpc.com/?api-key=d3b9094d-91fa-4531-9f6c-019cebcedead';

// Raydium AMM Program ID
const RAYDIUM_AMM_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');

// Liquidity Pool Layout (simplified)
const offsets = {
  status: 0,
  baseMint: 8,
  quoteMint: 40,
  marketProgramId: 72,
};

const LIQUIDITY_STATE_LAYOUT_V4 = {
  span: 752,
  offsetOf: (field: keyof typeof offsets) => {
    return offsets[field];
  },
};

// Stablecoins to filter out (to focus on meme coins)
const knownStablecoins = new Set([
  'So11111111111111111111111111111111111111112', // SOL
  '8L8jsjVmhz3Z2sr8FbA3tRrKwi2L4nduYx6A9vBsCjFu', // USDC (Wormhole)
  'Es9vMFrzaCERKa4DhQe8nu6kHaqeq2otg9gEj8Lrxtgo', // USDT (SPL)
]);

// Listener Class
export class RaydiumPoolListener extends EventEmitter {
  private connection: Connection;
  private subscriptionId: number | null = null;
  private seenPools: Set<string> = new Set(); // Track detected pools

  constructor() {
    super();
    this.connection = new Connection(RPC_ENDPOINT, 'confirmed');
  }

  // Start listening for new Raydium pools
  public async start(quoteTokenMint?: string) {
    console.log('Starting Raydium Pool Listener...');

    const filters = [
      { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
      {
        memcmp: {
          offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('status'),
          bytes: bs58.encode(Uint8Array.from([6, 0, 0, 0, 0, 0, 0, 0])), // Ensure correct encoding
        },
      },
    ];

    if (quoteTokenMint) {
      filters.push({
        memcmp: {
          offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint'),
          bytes: bs58.encode(new PublicKey(quoteTokenMint).toBytes()),
        },
      });
    }

    // Subscribe to program account changes
    this.subscriptionId = this.connection.onProgramAccountChange(
      RAYDIUM_AMM_PROGRAM_ID,
      async (updatedAccountInfo) => {
        try {
          const poolId = updatedAccountInfo.accountId.toBase58();
          
          // Check if we've already seen this pool
          if (this.seenPools.has(poolId)) return;
          this.seenPools.add(poolId); // Mark as seen
    
          const poolData = updatedAccountInfo.accountInfo.data;
          const baseMint = new PublicKey(
            poolData.subarray(
              LIQUIDITY_STATE_LAYOUT_V4.offsetOf('baseMint'),
              LIQUIDITY_STATE_LAYOUT_V4.offsetOf('baseMint') + 32
            )
          ).toBase58();
          
          const quoteMint = new PublicKey(
            poolData.subarray(
              LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint'),
              LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint') + 32
            )
          ).toBase58();
          
    
          // Skip stablecoin pairs (we want meme coins)

    
          console.log('New Raydium Pool Detected:');
          console.log('Base Mint:', baseMint);
          console.log('Quote Mint:', quoteMint);
    
          // Emit the new pool event
          this.emit('newPool', {
            baseMint,
            quoteMint,
            accountId: poolId,
          });
        } catch (error) {
          console.error('Error processing pool data:', error);
          this.emit('error', error);
        }
      },
      {
        commitment: 'confirmed', // New format
        filters, // New format
      }
    );
    

    console.log('Listener started successfully.');
  }

  // Stop listening
  public async stop() {
    if (this.subscriptionId !== null) {
      await this.connection.removeProgramAccountChangeListener(this.subscriptionId);
      this.subscriptionId = null;
      console.log('Listener stopped successfully.');
    }
  }
}
