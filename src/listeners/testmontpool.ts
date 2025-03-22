import { Connection, PublicKey } from '@solana/web3.js';
import { AccountInfo, Context } from '@solana/web3.js';
import { LIQUIDITY_STATE_LAYOUT_V4, MAINNET_PROGRAM_ID, MARKET_STATE_LAYOUT_V3, Token } from '@raydium-io/raydium-sdk';
import { EventEmitter } from 'events';
import bs58 from 'bs58';
import BN from 'bn.js';
import { Buffer } from 'buffer';

/**
 * Token interface
 */
interface Token {
  mint: PublicKey;
  decimals: number;
}

/**
 * Raydium pool monitor
 */
class RaydiumPoolMonitor extends EventEmitter {
  private connection: Connection;
  private runTimestamp: number;
  private seenPools: Set<string>; // Track seen pools to avoid duplicates

  constructor(endpoint: string) {
    super();
    this.connection = new Connection(endpoint, 'confirmed');
    console.log('Connected to Helius RPC endpoint');
    
    // Initialize the set to track seen pools
    this.seenPools = new Set<string>();
    
    // Set the runtime timestamp
    this.runTimestamp = Math.floor(new Date().getTime() / 1000);
    console.log(`Runtime timestamp: ${this.runTimestamp} (${new Date().toISOString()})`);
  }

  /**
   * Subscribe to Raydium pools
   */
  async subscribeToRaydiumPools(config: { quoteToken: Token }) {
    console.log(`Subscribing to Raydium pools with quote token: ${config.quoteToken.mint.toBase58()}`);
    
    return this.connection.onProgramAccountChange(
      MAINNET_PROGRAM_ID.AmmV4,
      async (updatedAccountInfo) => {
        const accountId = updatedAccountInfo.accountId.toBase58();
        
        // Skip if we've already seen this pool
        if (this.seenPools.has(accountId)) {
          return;
        }
        
        // Add to seen pools set
        this.seenPools.add(accountId);
        
        // Decode the pool state
        try {
          const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(updatedAccountInfo.accountInfo.data);
          
          // Extract poolOpenTime and convert to number
          const poolOpenTime = poolState.poolOpenTime.toNumber();
          
          // Only emit for pools created after our runtime
          if (poolOpenTime > this.runTimestamp) {
            console.log('⭐ NEW POOL DETECTED! ⭐');
            console.log(`Base mint: ${poolState.baseMint.toString()}`);
            this.emit('pool', updatedAccountInfo, poolState);
          }
        } catch (error) {
          console.error('Error decoding pool data:', error);
          // Still emit the raw data in case of decoding error
          this.emit('pool-error', updatedAccountInfo, error);
        }
      },
      this.connection.commitment,
      [
        { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
        {
          memcmp: {
            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint'),
            bytes: config.quoteToken.mint.toBase58(),
          },
        },
        {
          memcmp: {
            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('marketProgramId'),
            bytes: MAINNET_PROGRAM_ID.OPENBOOK_MARKET.toBase58(),
          },
        },
        {
          memcmp: {
            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('status'),
            bytes: bs58.encode(Buffer.from([6, 0, 0, 0, 0, 0, 0, 0])),
          },
        },
      ],
    );
  }

  /**
   * Close the connection
   */
  async close() {
    try {
      await this.connection.removeProgramAccountChangeListener(1); 
      console.log('Connection closed');
      console.log(`Total unique pools monitored: ${this.seenPools.size}`);
    } catch (error) {
      console.error('Error closing connection:', error);
    }
  }
}

/**
 * Main function to run the monitor
 */
async function main() {
  // Use WSOL as quote token (Mainnet Wrapped SOL mint address)
  const WSOL: Token = {
    mint: new PublicKey('So11111111111111111111111111111111111111112'),
    decimals: 9
  };

  // Create monitor with Helius RPC endpoint
  // Replace with your actual Helius API key
  const monitor = new RaydiumPoolMonitor('https://mainnet.helius-rpc.com/?api-key=d4a0e249-aecd-4f2f-9e05-a0985a90650a');
  
  // Set up event listener for new pools
  monitor.on('pool', (info, poolState) => {
    try {
      console.log('----- NEW POOL DETAILS -----');
      console.log(`Account ID: ${info.accountId.toBase58()}`);
      console.log(`Base Mint: ${poolState.baseMint.toString()}`);
      console.log(`Quote Mint: ${poolState.quoteMint.toString()}`);
      console.log(`LP Mint: ${poolState.lpMint.toString()}`);
      console.log(`Market ID: ${poolState.marketId.toString()}`);
      console.log(`Market Program ID: ${poolState.marketProgramId.toString()}`);
      console.log('----------------------------');
      
      // Here you could add code to buy tokens or perform other actions
    } catch (error) {
      console.error('Error processing pool event:', error);
    }
  });
  
  // Set up listener for decoding errors
  monitor.on('pool-error', (info, error) => {
    console.error(`Failed to decode pool at ${info.accountId.toBase58()}:`, error);
  });

  // Subscribe to pools with WSOL as quote token
  await monitor.subscribeToRaydiumPools({ quoteToken: WSOL });
  console.log('Subscription started. Listening for new pool updates...');

  // Keep the process running
  console.log('Press Ctrl+C to exit');
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('Shutting down...');
    await monitor.close();
    process.exit(0);
  });
}

// Run the main function
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});