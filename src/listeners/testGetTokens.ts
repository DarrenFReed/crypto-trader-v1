import { Connection } from '@solana/web3.js';
import WebSocket from 'ws';
import fetch from 'node-fetch';

// Configuration - replace with your Helius API key
const HELIUS_RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=d4a0e249-aecd-4f2f-9e05-a0985a90650a';
const HELIUS_WS_URL = 'wss://mainnet.helius-rpc.com/?api-key=d4a0e249-aecd-4f2f-9e05-a0985a90650a';
const RAYDIUM_API_URL = 'https://api.raydium.io/v2/main/pairs';

// WSOL token mint address
const WSOL_MINT = 'So11111111111111111111111111111111111111112';

// Raydium program IDs
const RAYDIUM_V4_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
const RAYDIUM_LIQUIDITY_PROGRAM_IDS = [
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium V4
  '9rpQHSyFVM1dkkHFQ2TtTzPEW7DVmEyPmN8wVniqJtuC', // Raydium V3
  '7quYjk3XkdZUfJ9w2yX8G2RUkpjshfpdJYGjL9uYZ8gK', // Liquidity pools
  '27haf8L6oxUeXrHrgEgsexjSY5hbVUWEmvv9Nyxg8vQv', // Farms
];

// Track tokens we've already alerted on to avoid duplicates
const alertedTokens = new Set();

interface TokenInfo {
  symbol: string;
  name: string;
  mint: string;
  decimals: number;
  liquidity?: number;
  price?: number;
  volume24h?: number;
  discoveredAt: number;
}

interface RaydiumPair {
  name: string;
  liquidity: number;
  volume24h: number;
  price: number;
  lpMint: string;
  base: {
    symbol: string;
    name: string;
    mint: string;
    decimals: number;
  };
  quote: {
    symbol: string;
    name: string;
    mint: string;
    decimals: number;
  };
}

class RaydiumTokenDiscovery {
  private connection: Connection;
  private ws: WebSocket | null = null;
  private isWsConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectDelay: number = 5000; // 5 seconds
  private transactionsProcessed: number = 0;

  constructor() {
    this.connection = new Connection(HELIUS_RPC_URL);
  }

  private setupWebSocketConnection(): void {
    console.log('Establishing WebSocket connection...');
    
    this.ws = new WebSocket(HELIUS_WS_URL);
    
    this.ws.on('open', () => {
      console.log('✅ WebSocket connection established');
      this.isWsConnected = true;
      this.reconnectAttempts = 0;
      
      // Subscribe to all program transactions for Raydium programs
      const subscribeMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'programSubscribe',
        params: [
          RAYDIUM_V4_PROGRAM_ID,
          {
            commitment: 'confirmed',
            encoding: 'jsonParsed'
          }
        ]
      };
      
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(subscribeMessage));
        console.log(`Subscribed to Raydium program: ${RAYDIUM_V4_PROGRAM_ID}`);
      }
    });

    this.ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        // Handle subscription confirmation
        if (message.method === 'programNotification') {
          const transaction = message.params.result;
          this.transactionsProcessed++;
          
          // Log progress every 100 transactions
          if (this.transactionsProcessed % 100 === 0) {
            console.log(`Processed ${this.transactionsProcessed} transactions so far`);
          }
          
          await this.processTransaction(transaction);
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
      }
    });

    this.ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });

    this.ws.on('close', () => {
      this.isWsConnected = false;
      
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * this.reconnectAttempts;
        console.log(`WebSocket connection closed. Reconnecting in ${delay/1000} seconds... (Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        setTimeout(() => this.setupWebSocketConnection(), delay);
      } else {
        console.error('Maximum reconnection attempts reached. Please restart the application.');
      }
    });
  }

  private async processTransaction(transaction: any): Promise<void> {
    try {
      // Extract information from transaction
      const logs = transaction?.meta?.logMessages || [];
      const accounts = transaction?.transaction?.message?.accountKeys || [];
      
      // Look for pool creation events
      const isPoolEvent = logs.some(log => 
        log.includes('CreatePool') || 
        log.includes('Instruction: initialize') ||
        log.includes('Instruction: addLiquidity')
      );
      
      if (isPoolEvent) {
        // Check if WSOL is involved
        const wsolInvolved = accounts.some(account => {
          if (typeof account === 'string') {
            return account === WSOL_MINT;
          } else if (account && account.pubkey) {
            return account.pubkey === WSOL_MINT;
          }
          return false;
        });
        
        if (wsolInvolved) {
          console.log('WSOL involved in potential pool transaction');
          
          // Extract all token accounts from the transaction
          const tokenMints = this.extractTokenMintsFromTransaction(transaction);
          
          if (tokenMints.length > 0) {
            console.log(`Found ${tokenMints.length} token mints in transaction`);
            
            // Get non-WSOL tokens
            const otherTokens = tokenMints.filter(mint => mint !== WSOL_MINT);
            
            if (otherTokens.length > 0) {
              console.log(`Found ${otherTokens.length} non-WSOL tokens in transaction`);
              
              // For each non-WSOL token, check if we have a new pair
              for (const tokenMint of otherTokens) {
                // Skip if we've already alerted for this token
                if (!alertedTokens.has(tokenMint)) {
                  // New potential token - fetch details from Raydium API
                  const isPairConfirmed = await this.checkAndAlertNewWsolPair(tokenMint);
                  
                  if (isPairConfirmed) {
                    // Mark as alerted to avoid duplicates
                    alertedTokens.add(tokenMint);
                  }
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error processing transaction:', error);
    }
  }
  
  private extractTokenMintsFromTransaction(transaction: any): string[] {
    const mints: Set<string> = new Set();
    
    try {
      // Extract account keys from transaction
      const accountKeys = transaction?.transaction?.message?.accountKeys || [];
      
      // Look for token program accounts
      const tokenProgramId = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
      
      // Extract data from transaction logs or parsed data
      const logs = transaction?.meta?.logMessages || [];
      const instructions = transaction?.meta?.innerInstructions || [];
      
      // Check for token-related instructions
      for (const log of logs) {
        if (log.includes('Instruction: InitializeMint') || 
            log.includes('Instruction: MintTo') ||
            log.includes('Instruction: Transfer') ||
            log.includes('spl-token')) {
          
          // Extract potential token mints from account keys
          for (const account of accountKeys) {
            if (typeof account === 'string' && 
                account !== tokenProgramId &&
                !account.startsWith('11111111') && // Filter out system program
                !RAYDIUM_LIQUIDITY_PROGRAM_IDS.includes(account)) {
              mints.add(account);
            } else if (typeof account === 'object' && account.pubkey) {
              mints.add(account.pubkey);
            }
          }
          
          // Also check inner instructions for token accounts
          for (const innerInst of instructions) {
            for (const inst of innerInst.instructions || []) {
              if (inst.programId === tokenProgramId) {
                for (const account of inst.accounts || []) {
                  mints.add(account);
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error extracting token mints:', error);
    }
    
    return Array.from(mints);
  }

  private async checkAndAlertNewWsolPair(tokenMint: string): Promise<boolean> {
    try {
      // Fetch pair details from Raydium API
      const pairs = await this.fetchRaydiumPairs();
      
      // Find the pair with WSOL and our token
      const wsolPair = pairs.find(pair => 
        (pair.base.mint === WSOL_MINT && pair.quote.mint === tokenMint) ||
        (pair.quote.mint === WSOL_MINT && pair.base.mint === tokenMint)
      );
      
      if (wsolPair) {
        // Found the WSOL pair - create token info
        let tokenInfo: TokenInfo;
        
        if (wsolPair.base.mint === WSOL_MINT) {
          tokenInfo = {
            symbol: wsolPair.quote.symbol,
            name: wsolPair.quote.name,
            mint: wsolPair.quote.mint,
            decimals: wsolPair.quote.decimals,
            liquidity: wsolPair.liquidity / wsolPair.price,
            price: 1 / wsolPair.price,
            volume24h: wsolPair.volume24h,
            discoveredAt: Date.now()
          };
        } else {
          tokenInfo = {
            symbol: wsolPair.base.symbol,
            name: wsolPair.base.name,
            mint: wsolPair.base.mint,
            decimals: wsolPair.base.decimals,
            liquidity: wsolPair.liquidity,
            price: wsolPair.price,
            volume24h: wsolPair.volume24h,
            discoveredAt: Date.now()
          };
        }
        
        // Alert for the new token
        this.printNewTokenAlert(tokenInfo, wsolPair);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Error checking for WSOL pair:', error);
      return false;
    }
  }

  private printNewTokenAlert(token: TokenInfo, pair: RaydiumPair): void {
    console.log('\n');
    console.log('🚨 NEW WSOL PAIR DETECTED 🚨');
    console.log('==============================');
    console.log(`Symbol: ${token.symbol}`);
    console.log(`Name: ${token.name}`);
    console.log(`Mint Address: ${token.mint}`);
    console.log(`Decimals: ${token.decimals}`);
    console.log(`Price: $${token.price?.toFixed(6)}`);
    console.log(`Liquidity: $${token.liquidity?.toFixed(2)}`);
    console.log(`Volume 24h: $${token.volume24h?.toFixed(2)}`);
    console.log(`Discovered at: ${new Date(token.discoveredAt).toLocaleString()}`);
    console.log(`Pair Name: ${pair.name}`);
    console.log(`LP Mint: ${pair.lpMint}`);
    console.log('==============================\n');
  }

  async fetchRaydiumPairs(): Promise<RaydiumPair[]> {
    try {
      const response = await fetch(RAYDIUM_API_URL);
      const data = await response.json();
      return data.data;
    } catch (error) {
      console.error('Error fetching Raydium pairs:', error);
      return [];
    }
  }

  // Start the discovery process
  async start(): Promise<void> {
    console.log('Starting Raydium WSOL pair discovery...');
    console.log('======================================');
    
    // Setup WebSocket connection for real-time transaction monitoring
    this.setupWebSocketConnection();
    
    console.log('Listening for new WSOL pairs...');
  }

  // Cleanup resources
  close(): void {
    if (this.ws && this.isWsConnected) {
      this.ws.close();
    }
    console.log(`Total transactions processed: ${this.transactionsProcessed}`);
    console.log(`Total new WSOL pairs detected: ${alertedTokens.size}`);
  }
}

// Standalone script
(async () => {
  try {
    console.log('📊 Raydium WSOL Pair Discovery Tool 📊');
    console.log('====================================');
    
    const tokenDiscovery = new RaydiumTokenDiscovery();
    await tokenDiscovery.start();
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\nShutting down...');
      tokenDiscovery.close();
      process.exit(0);
    });
    
    // Keep the process running
    console.log('\nToken discovery running. Press Ctrl+C to exit.');
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
})();