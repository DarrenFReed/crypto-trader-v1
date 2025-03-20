import { LIQUIDITY_STATE_LAYOUT_V4, MAINNET_PROGRAM_ID, MARKET_STATE_LAYOUT_V3, Token } from '@raydium-io/raydium-sdk';
import bs58 from 'bs58';
import { Connection, PublicKey, KeyedAccountInfo } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { EventEmitter } from 'events';
import { logger } from '../helpers/logger'; // Adjust import based on your project structure
import { PrismaClient } from '@prisma/client';

// Initialize Prisma client for database operations
const prisma = new PrismaClient();

// Define event types for better type safety
export interface PoolEvent {
  type: 'pool';
  account: KeyedAccountInfo;
  poolState: any;
  baseMint: string;
  quoteMint: string;
  marketId: string;
  poolId: string;
}

export interface MarketEvent {
  type: 'market';
  account: KeyedAccountInfo;
  marketState: any;
  baseMint: string;
  quoteMint: string;
  marketId: string;
}

export interface NewTokenEvent {
  type: 'newToken';
  baseMint: string;
  quoteMint: string;
  marketId: string;
  poolId: string;
  baseDecimals: number;
  quoteDecimals: number;
  timestamp: Date;
}

export interface WalletEvent {
  type: 'wallet';
  account: KeyedAccountInfo;
  mint: string;
  amount: number;
}

/**
 * Integrated Raydium Listeners class for monitoring various Solana events
 * with database integration
 */
export class Listeners extends EventEmitter {
  private subscriptions: { id: number; type: string }[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 2000; // Start with 2 seconds
  private isRunning = false;
  private configCache: any = null;
  
  // Cache for recent pools and markets to prevent duplicates
  private recentPoolsCache: Set<string> = new Set();
  private recentMarketsCache: Set<string> = new Set();
  private cacheExpiryTime = 3600000; // 1 hour in milliseconds

  constructor(private readonly connection: Connection) {
    super();
    
    // Set higher max listeners to avoid Node.js warnings
    this.setMaxListeners(20);
    
    // Handle WebSocket disconnections
    this.setupConnectionErrorHandling();
    
    // Clean caches periodically
    setInterval(() => this.cleanCaches(), this.cacheExpiryTime);
  }

  /**
   * Clean up expired items from caches
   */
  private cleanCaches() {
    logger.debug(`Cleaning caches. Cache sizes before - Pools: ${this.recentPoolsCache.size}, Markets: ${this.recentMarketsCache.size}`);
    // For simplicity, just clear the caches instead of tracking individual expiry times
    this.recentPoolsCache.clear();
    this.recentMarketsCache.clear();
    logger.debug('Caches cleared');
  }

  /**
   * Set up error handling and reconnection logic
   */
  private setupConnectionErrorHandling() {
    // Monitor for RPC connection issues
    this.connection.onAccountChange(new PublicKey('SysvarC1ock11111111111111111111111111111111'), 
      () => {}, 'confirmed');
      
    // Reset reconnect attempts when we know connection is working
    setInterval(() => {
      if (this.isRunning) {
        this.reconnectAttempts = 0;
      }
    }, 60000); // Reset counter every minute of successful running
  }

  /**
   * Start all configured listeners
   */
  public async start(config: {
    walletPublicKey: PublicKey;
    quoteToken: Token;
    autoSell: boolean;
    cacheNewMarkets: boolean;
  }): Promise<boolean> {
    try {
      logger.info(`Starting Raydium listeners with quote token: ${config.quoteToken.mint.toBase58()}`);
      this.isRunning = true;
      this.configCache = config; // Store config for reconnection
      
      // Validate configuration
      if (!config.quoteToken || !config.quoteToken.mint) {
        throw new Error('Invalid quote token configuration');
      }

      // Start listeners based on configuration
      if (config.cacheNewMarkets) {
        logger.info('Starting OpenBook market listener');
        const openBookSubscription = await this.subscribeToOpenBookMarkets(config);
        this.subscriptions.push({ id: openBookSubscription, type: 'openbook' });
      }

      logger.info('Starting Raydium pools listener');
      const raydiumSubscription = await this.subscribeToRaydiumPools(config);
      this.subscriptions.push({ id: raydiumSubscription, type: 'raydium' });

      if (config.autoSell) {
        logger.info('Starting wallet changes listener');
        const walletSubscription = await this.subscribeToWalletChanges(config);
        this.subscriptions.push({ id: walletSubscription, type: 'wallet' });
      }
      
      logger.info(`Successfully started ${this.subscriptions.length} listeners`);
      return true;
    } catch (error) {
      logger.error('Failed to start listeners:', error);
      this.isRunning = false;
      return false;
    }
  }

  /**
   * Subscribe to new OpenBook markets
   */
  private async subscribeToOpenBookMarkets(config: { quoteToken: Token }): Promise<number> {
    // Verify the offset before using it
    const quoteMintOffset = MARKET_STATE_LAYOUT_V3.offsetOf('quoteMint');
    logger.debug(`OpenBook market quoteMint offset: ${quoteMintOffset}`);
    
    return this.connection.onProgramAccountChange(
      MAINNET_PROGRAM_ID.OPENBOOK_MARKET,
      async (updatedAccountInfo, context) => {
        try {
          // Get the account ID
          const marketId = updatedAccountInfo.accountId.toBase58();
          
          // Check if we've seen this market recently
          if (this.recentMarketsCache.has(marketId)) {
            logger.debug(`Skipping already processed market: ${marketId}`);
            return;
          }
          
          // Add to cache
          this.recentMarketsCache.add(marketId);
          
          // Decode the market data
          const marketData = MARKET_STATE_LAYOUT_V3.decode(updatedAccountInfo.accountInfo.data);
          
          // Get the base and quote mints
          const baseMint = marketData.baseMint.toBase58();
          const quoteMint = marketData.quoteMint.toBase58();
          
          logger.info(`New OpenBook market detected! Market ID: ${marketId}, Base: ${baseMint}, Quote: ${quoteMint}`);
          
          // Store in database
          try {
            await prisma.market.upsert({
              where: { marketId },
              update: {
                baseMint,
                quoteMint,
                lastUpdated: new Date()
              },
              create: {
                marketId,
                baseMint,
                quoteMint,
                createdAt: new Date(),
                lastUpdated: new Date()
              }
            });
            logger.debug(`Market ${marketId} saved to database`);
          } catch (dbError) {
            logger.error(`Error saving market to database: ${dbError}`);
          }
          
          // Emit the market event with decoded data
          this.emit('market', {
            type: 'market',
            account: updatedAccountInfo,
            marketState: marketData,
            baseMint,
            quoteMint,
            marketId
          } as MarketEvent);
        } catch (error) {
          logger.error('Error processing OpenBook market update:', error);
        }
      },
      'confirmed', // Use confirmed commitment for more reliable updates
      [
        { dataSize: MARKET_STATE_LAYOUT_V3.span },
        {
          memcmp: {
            offset: quoteMintOffset,
            bytes: config.quoteToken.mint.toBase58(),
          },
        },
      ],
    );
  }

  /**
   * Subscribe to new Raydium liquidity pools
   */
  private async subscribeToRaydiumPools(config: { quoteToken: Token }): Promise<number> {
    // Verify offsets before using them
    const quoteMintOffset = LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint');
    const marketProgramIdOffset = LIQUIDITY_STATE_LAYOUT_V4.offsetOf('marketProgramId');
    const statusOffset = LIQUIDITY_STATE_LAYOUT_V4.offsetOf('status');
    
    logger.debug(`Raydium pool offsets - quoteMint: ${quoteMintOffset}, marketProgramId: ${marketProgramIdOffset}, status: ${statusOffset}`);
    logger.debug(`Checking for pools with quote token: ${config.quoteToken.mint.toBase58()}`);
    
    // Status 6 indicates a normal, active pool
    const statusBytes = bs58.encode(Buffer.from([6, 0, 0, 0, 0, 0, 0, 0]));
    
    return this.connection.onProgramAccountChange(
      MAINNET_PROGRAM_ID.AmmV4,
      async (updatedAccountInfo, context) => {
        try {
          // Get the pool ID
          const poolId = updatedAccountInfo.accountId.toBase58();
          
          // Check if we've seen this pool recently
          if (this.recentPoolsCache.has(poolId)) {
            logger.debug(`Skipping already processed pool: ${poolId}`);
            return;
          }
          
          // Add to cache
          this.recentPoolsCache.add(poolId);
          
          // Decode the pool data
          const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(updatedAccountInfo.accountInfo.data);
          
          // Extract key information
          const baseMint = poolState.baseMint.toBase58();
          const quoteMint = poolState.quoteMint.toBase58();
          const marketId = poolState.marketId.toBase58();
          //const baseDecimals = poolState.baseDecimal;
          //const quoteDecimals = poolState.quoteDecimal;
          
          logger.info(`New Raydium pool detected! Pool ID: ${poolId}, Base: ${baseMint}, Quote: ${quoteMint}, Market: ${marketId}`);
          
          const baseDecimals = poolState.baseDecimal.toNumber();
          const quoteDecimals = poolState.quoteDecimal.toNumber();

          // Store pool in database
          try {
            await prisma.pool.upsert({
              where: { poolId },
              update: {
                baseMint,
                quoteMint,
                marketId,
                baseDecimals,
                quoteDecimals,
                lastUpdated: new Date()
              },
              create: {
                poolId,
                baseMint,
                quoteMint,
                marketId,
                baseDecimals,
                quoteDecimals,
                createdAt: new Date(),
                lastUpdated: new Date()
              }
            });
            logger.debug(`Pool ${poolId} saved to database`);
          } catch (dbError) {
            logger.error(`Error saving pool to database: ${dbError}`);
          }
          
          // Create token record if it doesn't exist
          try {
            const existingToken = await prisma.token.findUnique({
              where: { baseAddress: baseMint }
            });
            
            if (!existingToken) {
              // This is a new token
              await prisma.token.create({
                data: {
                  baseAddress: baseMint,
                  baseDecimals: baseDecimals.toNumber(), // Convert BN to number
                  quoteAddress: quoteMint,              // Add quote mint address
                  quoteDecimals: quoteDecimals.toNumber(), // Add quote decimals (convert BN to number)
                  poolId: poolId,                       // Use poolId instead of firstPoolId
                  marketId: marketId,                   // Use marketId instead of firstMarketId
                  createdAt: new Date(),
                  tokenStatus: 'DISCOVERED'
                }
              });
              
              logger.info(`New token discovered and saved to database: ${baseMint}`);
              
              // Emit new token event
              this.emit('newToken', {
                type: 'newToken',
                baseMint,
                quoteMint,
                marketId,
                poolId,
                baseDecimals: baseDecimals,
                quoteDecimals: quoteDecimals,
                timestamp: new Date()
              } as NewTokenEvent);
            }
          } catch (tokenDbError) {
            logger.error(`Error processing token database entry: ${tokenDbError}`);
          }
          
          // Emit the pool event with decoded data
          this.emit('pool', {
            type: 'pool',
            account: updatedAccountInfo,
            poolState,
            baseMint,
            quoteMint,
            marketId,
            poolId
          } as PoolEvent);
        } catch (error) {
          logger.error('Error processing Raydium pool update:', error);
        }
      },
      'confirmed', // Use confirmed commitment for more reliable updates
      [
        { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
        {
          memcmp: {
            offset: quoteMintOffset,
            bytes: config.quoteToken.mint.toBase58(),
          },
        },
        {
          memcmp: {
            offset: marketProgramIdOffset,
            bytes: MAINNET_PROGRAM_ID.OPENBOOK_MARKET.toBase58(),
          },
        },
        {
          memcmp: {
            offset: statusOffset,
            bytes: statusBytes,
          },
        },
      ],
    );
  }

  /**
   * Subscribe to changes in the wallet's token balances
   */
  private async subscribeToWalletChanges(config: { walletPublicKey: PublicKey }): Promise<number> {
    return this.connection.onProgramAccountChange(
      TOKEN_PROGRAM_ID,
      async (updatedAccountInfo, context) => {
        try {
          // Extract token information from the account data
          const data = updatedAccountInfo.accountInfo.data;
          const mint = new PublicKey(data.slice(0, 32)).toBase58();
          
          // Calculate the token amount from the data
          const amount = Buffer.from(data.slice(64, 72)).readBigUInt64LE();
          
          logger.debug(`Wallet token change detected: Mint ${mint}, Amount: ${amount}`);
          
          // Emit the wallet event with extracted data
          this.emit('wallet', {
            type: 'wallet',
            account: updatedAccountInfo,
            mint,
            amount: Number(amount)
          } as WalletEvent);
        } catch (error) {
          logger.error('Error processing wallet update:', error);
        }
      },
      'confirmed', // Use confirmed commitment for more reliable updates
      [
        {
          dataSize: 165, // Size of token account data
        },
        {
          memcmp: {
            offset: 32,
            bytes: config.walletPublicKey.toBase58(),
          },
        },
      ],
    );
  }

  /**
   * Stop all listeners and clean up
   */
  public async stop(): Promise<void> {
    logger.info(`Stopping ${this.subscriptions.length} listeners...`);
    
    for (const sub of this.subscriptions) {
      try {
        await this.connection.removeAccountChangeListener(sub.id);
        logger.debug(`Removed ${sub.type} listener with ID ${sub.id}`);
      } catch (error) {
        logger.error(`Error removing listener ${sub.id}:`, error);
      }
    }
    
    this.subscriptions = [];
    this.isRunning = false;
    logger.info('All listeners stopped');
  }

  /**
   * Handle reconnection when WebSocket connection fails
   */
  private async attemptReconnect(): Promise<void> {
    if (!this.configCache) {
      logger.error('Cannot reconnect: no cached configuration available');
      return;
    }
    
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error(`Failed to reconnect after ${this.maxReconnectAttempts} attempts`);
      return;
    }
    
    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts);
    this.reconnectAttempts++;
    
    logger.info(`Connection lost. Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
    
    await new Promise(resolve => setTimeout(resolve, delay));
    
    try {
      // Clean up existing subscriptions
      await this.stop();
      
      // Start fresh subscriptions
      const success = await this.start(this.configCache);
      
      if (success) {
        logger.info('Successfully reconnected');
        this.reconnectAttempts = 0;
      }
    } catch (error) {
      logger.error('Failed to reconnect:', error);
      this.attemptReconnect();
    }
  }

  /**
   * Check if a specific pool already exists
   */
  public async checkExistingPool(baseMint: string, quoteMint: string): Promise<boolean> {
    try {
      // First check the database
      const existingPool = await prisma.pool.findFirst({
        where: {
          baseMint,
          quoteMint
        }
      });
      
      if (existingPool) {
        return true;
      }
      
      // If not in database, check on-chain
      const ammProgramId = MAINNET_PROGRAM_ID.AmmV4;
      const quoteMintOffset = LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint');
      const baseMintOffset = LIQUIDITY_STATE_LAYOUT_V4.offsetOf('baseMint');
      
      // Search for pools with both the base and quote mints
      const accounts = await this.connection.getProgramAccounts(
        ammProgramId,
        {
          filters: [
            { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
            {
              memcmp: {
                offset: baseMintOffset,
                bytes: baseMint,
              },
            },
            {
              memcmp: {
                offset: quoteMintOffset,
                bytes: quoteMint,
              },
            },
          ],
        }
      );
      
      return accounts.length > 0;
    } catch (error) {
      logger.error('Error checking existing pool:', error);
      return false;
    }
  }

  /**
   * Get pool details by pool ID
   */
  public async getPoolDetails(poolId: string): Promise<any> {
    try {
      // First check the database
      const poolInfo = await prisma.pool.findUnique({
        where: { poolId }
      });
      
      if (poolInfo) {
        return poolInfo;
      }
      
      // If not in database, fetch from chain
      const poolAccount = await this.connection.getAccountInfo(new PublicKey(poolId));
      
      if (!poolAccount) {
        throw new Error(`Pool ${poolId} not found on chain`);
      }
      
      const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(poolAccount.data);
      
      return {
        poolId,
        baseMint: poolState.baseMint.toBase58(),
        quoteMint: poolState.quoteMint.toBase58(),
        marketId: poolState.marketId.toBase58(),
        baseDecimals: poolState.baseDecimal,
        quoteDecimals: poolState.quoteDecimal
      };
    } catch (error) {
      logger.error(`Error getting pool details for ${poolId}:`, error);
      throw error;
    }
  }

  /**
   * Find pools for a specific token
   */
  public async findPoolsForToken(tokenMint: string): Promise<any[]> {
    try {
      // First check the database
      const dbPools = await prisma.pool.findMany({
        where: {
          OR: [
            { baseMint: tokenMint },
            { quoteMint: tokenMint }
          ]
        }
      });
      
      if (dbPools.length > 0) {
        return dbPools;
      }
      
      // If not in database, check on-chain
      const baseMintOffset = LIQUIDITY_STATE_LAYOUT_V4.offsetOf('baseMint');
      const quoteMintOffset = LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint');
      
      // Get pools where token is base mint
      const basePoolAccounts = await this.connection.getProgramAccounts(
        MAINNET_PROGRAM_ID.AmmV4,
        {
          filters: [
            { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
            { memcmp: { offset: baseMintOffset, bytes: tokenMint } }
          ]
        }
      );
      
      // Get pools where token is quote mint
      const quotePoolAccounts = await this.connection.getProgramAccounts(
        MAINNET_PROGRAM_ID.AmmV4,
        {
          filters: [
            { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
            { memcmp: { offset: quoteMintOffset, bytes: tokenMint } }
          ]
        }
      );
      
      const allAccounts = [...basePoolAccounts, ...quotePoolAccounts];
      
      return allAccounts.map(account => {
        const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(account.account.data);
        return {
          poolId: account.pubkey.toString(),
          baseMint: poolState.baseMint.toBase58(),
          quoteMint: poolState.quoteMint.toBase58(),
          marketId: poolState.marketId.toBase58(),
          baseDecimals: poolState.baseDecimal,
          quoteDecimals: poolState.quoteDecimal,
          isBaseToken: poolState.baseMint.toBase58() === tokenMint
        };
      });
    } catch (error) {
      logger.error(`Error finding pools for token ${tokenMint}:`, error);
      return [];
    }
  }
}

/**
 * Setup function to start enhanced token monitoring
 */
export async function startEnhancedMonitoring(
  connection: Connection, 
  newTokenConnection: Connection, 
  txConnection: Connection, 
  walletPublicKey: PublicKey
) {
  try {
    logger.info('🔍 Starting Enhanced Pump.fun Token Monitoring...');
    
    // Set up the USDC quote token
    const usdcMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    const quoteToken = new Token(TOKEN_PROGRAM_ID, usdcMint, 6);
    
    // Create and start listeners
    const listeners = new Listeners(newTokenConnection);
    
    // Set up event handlers
    listeners.on('newToken', async (event: NewTokenEvent) => {
      logger.info(`🎯 New Token Detected: ${event.baseMint}`);
      logger.info(`Pool ID: ${event.poolId}, Market ID: ${event.marketId}`);
      
      // Here you can add any additional processing for new tokens
      // such as triggering your buy logic
    });
    
    listeners.on('pool', async (event: PoolEvent) => {
      logger.debug(`Pool event: ${event.poolId}`);
      // Additional pool event handling if needed
    });
    
    listeners.on('market', async (event: MarketEvent) => {
      logger.debug(`Market event: ${event.marketId}`);
      // Additional market event handling if needed
    });
    
    // Start the listeners
    await listeners.start({
      walletPublicKey,
      quoteToken,
      autoSell: true,
      cacheNewMarkets: true
    });
    
    logger.info('✅ Enhanced monitoring setup complete with multiple monitoring points');
    
    return listeners; // Return the listeners instance so it can be stopped if needed
    
  } catch (error) {
    logger.error('Error setting up enhanced monitoring:', error);
    throw error;
  }
}