import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import chalk from 'chalk';
import { EventEmitter } from 'events';
import { PrismaClient } from '@prisma/client';
import { fetchPoolData } from '../helpers/fetchPoolData';
import { fetchMarketData } from '../helpers/fetchMarketData';
import { startHolderTracking } from '../trend/holder-count';

// Define key monitoring addresses
const MONITORING_POINTS = {
  // Main original monitoring point
  RAY_FEE: new PublicKey('7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5'),
  
  // Additional monitoring points
  RAYDIUM_AMM: new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'),
  RAYDIUM_LP_POOL: new PublicKey('5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1'),
  
  // Solana token program
  TOKEN_PROGRAM: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
};

// Configuration
const MAX_MONITORED_TOKENS = 1; // Keep your original limit
const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export const tokenEmitter = new EventEmitter();

// Store subscription IDs for cleanup
const subscriptionIds: { [key: string]: number | null } = {
  rayFee: null,
  ammProgram: null,
  liquidityPool: null
};

// Recently processed transaction signatures to avoid duplicates
const processedSignatures = new Set<string>();

export async function startEnhancedMonitoring(
  connection: Connection, 
  newTokenConnection: Connection,
  txConnection: Connection, 
  walletPublicKey: PublicKey
) {
  console.log(chalk.green(`🔍 Starting Enhanced Pump.fun Token Monitoring...`));
  
  try {
    // Check if we're already monitoring
    if (subscriptionIds.rayFee !== null) {
      console.log(`⚠️ Already monitoring logs, skipping duplicate listener.`);
      return;
    }

    // 1. MAIN MONITOR: Ray Fee (your original implementation)
    subscriptionIds.rayFee = newTokenConnection.onLogs(
      MONITORING_POINTS.RAY_FEE,
      async ({ logs, err, signature }) => {
        try {
          if (err) {
            console.error(`Connection error: ${err}`);
            return;
          }

          // Skip if already processed
          if (processedSignatures.has(signature)) {
            return;
          }
          processedSignatures.add(signature);

          // Check token limit
          const currentMonitoringCount = await prisma.token.count({
            where: { tokenStatus: { in: ['ACTIVE', 'BUY_CANDIDATE', 'WAITING_FOR_POOL', 'POOL_FOUND', 'BOUGHT'] } },
          });

          if (currentMonitoringCount >= MAX_MONITORED_TOKENS) {
            console.log(chalk.red(`🚨 Max monitored token limit reached. Skipping.`));
            return;
          }

          console.log(chalk.bgGreen(`Found new potential token signature (RAY_FEE): ${signature}`));
          
          // Process the transaction to extract token info
          await processTransaction(connection, signature, logs);
          
        } catch (error) {
          console.log(chalk.red(`Error in Ray Fee monitor: ${JSON.stringify(error, null, 2)}`));
        }
      },
      'confirmed',
    );

    // 2. ADDITIONAL MONITOR: Raydium AMM Program
    subscriptionIds.ammProgram = newTokenConnection.onLogs(
      MONITORING_POINTS.RAYDIUM_AMM,
      async ({ logs, err, signature }) => {
        try {
          if (err) {
            console.error(`Connection error in AMM monitor: ${err}`);
            return;
          }

          // Skip if already processed
          if (processedSignatures.has(signature)) {
            return;
          }
          
          // Quick check for pump.fun token
          if (!logs.some(log => log.includes('.pump'))) {
            return; // Ignore if not a pump token
          }
          
          // Check for pool creation patterns
          if (!logs.some(log => 
            log.includes('Instruction: InitializePool') || 
            log.includes('Program log: Create pool') ||
            log.includes('Program log: Initialize the AMM')
          )) {
            return; // Not a pool creation
          }
          
          processedSignatures.add(signature);
          console.log(chalk.bgCyan(`Found new potential token signature (AMM_PROGRAM): ${signature}`));
          
          // Check token limit
          const currentMonitoringCount = await prisma.token.count({
            where: { tokenStatus: { in: ['ACTIVE', 'BUY_CANDIDATE', 'WAITING_FOR_POOL', 'POOL_FOUND', 'BOUGHT'] } },
          });

          if (currentMonitoringCount >= MAX_MONITORED_TOKENS) {
            console.log(chalk.red(`🚨 Max monitored token limit reached. Skipping.`));
            return;
          }
          
          // Process the transaction
          await processTransaction(connection, signature, logs);
          
        } catch (error) {
          console.log(chalk.red(`Error in AMM monitor: ${JSON.stringify(error, null, 2)}`));
        }
      },
      'confirmed',
    );

    // 3. ADDITIONAL MONITOR: Raydium Liquidity Pool
    subscriptionIds.liquidityPool = newTokenConnection.onLogs(
      MONITORING_POINTS.RAYDIUM_LP_POOL,
      async ({ logs, err, signature }) => {
        try {
          if (err) {
            console.error(`Connection error in LP Pool monitor: ${err}`);
            return;
          }

          // Skip if already processed
          if (processedSignatures.has(signature)) {
            return;
          }
          
          // Quick check for pump.fun token
          if (!logs.some(log => log.includes('.pump'))) {
            return; // Ignore if not a pump token
          }
          
          processedSignatures.add(signature);
          console.log(chalk.bgMagenta(`Found new potential token signature (LP_POOL): ${signature}`));
          
          // Check token limit
          const currentMonitoringCount = await prisma.token.count({
            where: { tokenStatus: { in: ['ACTIVE', 'BUY_CANDIDATE', 'WAITING_FOR_POOL', 'POOL_FOUND', 'BOUGHT'] } },
          });

          if (currentMonitoringCount >= MAX_MONITORED_TOKENS) {
            console.log(chalk.red(`🚨 Max monitored token limit reached. Skipping.`));
            return;
          }
          
          // Process the transaction
          await processTransaction(connection, signature, logs);
          
        } catch (error) {
          console.log(chalk.red(`Error in LP Pool monitor: ${JSON.stringify(error, null, 2)}`));
        }
      },
      'confirmed',
    );
    
    // Manage signature cache size
    setInterval(() => {
      // Keep cache size reasonable (last ~5000 transactions)
      if (processedSignatures.size > 5000) {
        const toRemove = processedSignatures.size - 5000;
        let count = 0;
        for (const sig of processedSignatures) {
          processedSignatures.delete(sig);
          count++;
          if (count >= toRemove) break;
        }
      }
    }, 60000); // Every minute
    
    console.log(chalk.green(`✅ Enhanced monitoring setup complete with multiple monitoring points`));
    
  } catch (error) {
    const errorMessage = `Error occurred in enhanced monitor setup: ${JSON.stringify(error, null, 2)}`;
    console.log(chalk.red(errorMessage));
  }
}

async function processTransaction(connection: Connection, signature: string, logs: string[]) {
  try {
    let signer = '';
    let baseAddress = '';
    let baseDecimals = 0;
    let baseLpAmount = 0;
    let quoteAddress = '';
    let quoteDecimals = 0;
    let quoteLpAmount = 0;
    let poolId = '';

    const parsedTransaction = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });

    if (!parsedTransaction || !parsedTransaction.meta || parsedTransaction.meta.err) {
      console.log(`Transaction failed or couldn't be parsed: ${signature}`);
      return;
    }

    console.log(`Successfully parsed transaction: ${signature}`);

    // Extract signer
    signer = parsedTransaction.transaction.message.accountKeys[0].pubkey.toString();
    console.log(`Creator: ${signer}`);

    // Extract token information
    const postTokenBalances = parsedTransaction.meta.postTokenBalances;

    // Find base token (non-SOL token in LP pool)
    const baseInfo = postTokenBalances?.find(
      (balance) =>
        balance.owner === '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1' &&
        balance.mint !== 'So11111111111111111111111111111111111111112',
    );

    if (baseInfo) {
      baseAddress = baseInfo.mint;
      baseDecimals = baseInfo.uiTokenAmount.decimals;
      baseLpAmount = baseInfo.uiTokenAmount.uiAmount ?? 0;
      console.log(`Base Address: ${baseAddress}`);
    } else {
      console.log(`No base token found in transaction: ${signature}`);
      return;
    }

    // Verify it's a Pump.fun token
    if (!baseAddress.endsWith('pump')) {
      console.log(`❌ Ignoring non-Pump.fun token: ${baseAddress}`);
      return;
    }

    // Find quote token (SOL)
    const quoteInfo = postTokenBalances?.find(
      (balance) =>
        balance.owner === '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1' &&
        balance.mint === 'So11111111111111111111111111111111111111112',
    );

    if (quoteInfo) {
      quoteAddress = quoteInfo.mint;
      quoteDecimals = quoteInfo.uiTokenAmount.decimals;
      quoteLpAmount = quoteInfo.uiTokenAmount.uiAmount ?? 0;
    }

    // Extract pool ID (using your original method)
    if (parsedTransaction.meta.innerInstructions) {
      for (const instruction of parsedTransaction.meta.innerInstructions) {
        for (const log of instruction.instructions) {
          // Detect the Allocate instruction creating a Raydium pool (Ensure 752 bytes)
          if ('parsed' in log && log.parsed.type === 'allocate' && log.parsed.info.space === 752) {
            const candidatePoolId = log.parsed.info.account;

            // Check if it's assigned to Raydium's AMM program
            const assignedToRaydium = instruction.instructions.find(
              (innerLog) =>
                'parsed' in innerLog &&
                innerLog.parsed.type === 'assign' &&
                innerLog.parsed.info.account === candidatePoolId &&
                innerLog.parsed.info.owner === '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
            );

            if (assignedToRaydium) {
              poolId = candidatePoolId;
              break; // Stop processing once we confirm a valid pool
            }
          }
        }
        if (poolId) break;
      }
    }

    // Final verification of pool ID
    if (poolId) {
      console.log(`✅ Final Confirmed Pool ID: ${poolId}`);
    } else {
      console.log('❌ No Valid Pool ID found in transaction.');
      
      // Additional pool ID extraction attempt from logs
      for (const log of logs) {
        if (log.includes('Initialize pool:')) {
          const match = /Initialize pool: ([A-Za-z0-9]{32,})/.exec(log);
          if (match && match[1]) {
            poolId = match[1];
            console.log(`✅ Found Pool ID from logs: ${poolId}`);
            break;
          }
        }
      }
    }

    // Construct new token data (maintain your original format)
    const newTokenData = {
      lpSignature: signature,
      creator: signer,
      timestamp: new Date().toString(),
      baseInfo: {
        baseAddress,
        baseDecimals,
        baseLpAmount,
      },
      quoteInfo: {
        quoteAddress,
        quoteDecimals,
        quoteLpAmount,
      },
      logs: logs,
    };

    // Database update (as in your original code)
    await prisma.token.upsert({
      where: { baseAddress },
      update: {
        baseDecimals,
        baseLpAmount,
        quoteAddress,
        quoteDecimals,
        quoteLpAmount,
        tokenStatus: 'WAITING_FOR_POOL',
      },
      create: {
        baseAddress,
        baseDecimals,
        baseLpAmount,
        quoteAddress,
        quoteDecimals,
        quoteLpAmount,
        tokenStatus: 'WAITING_FOR_POOL',
        createdAt: new Date(),
      },
    });
    
    console.log(`✅ Added New Token to Database: ${baseAddress}`);

    // Check if we need to wait for pool ID
    if (!poolId || poolId.trim() === '') {
      console.log(`❌ Pool ID not yet available, delaying fetch for ${baseAddress}`);
      await sleep(500);
      return;
    }

    // Fetch pool data (maintain your original flow)
    const poolData = await fetchPoolData(connection, poolId, baseAddress);
    if (!poolData) {
      console.log(`❌ No pool data found for ${baseAddress}, skipping event emission.`);
      
      // Update attempts to find pool data
      await prisma.token.update({
        where: { baseAddress },
        data: {
          poolFetchAttempts: { increment: 1 }
        }
      });
      
      return;
    }

    // Fetch market data
    const marketData = await fetchMarketData(connection, poolData.marketId.toString());
    if (!marketData) {
      console.log(`❌ No market data found for ${baseAddress}, skipping event emission.`);
      return;
    }

    // Log success
    console.log(`✅ Successfully retrieved both Raydium pool and Market data for ${baseAddress}`);

    // Emit events (maintain your original events)
    tokenEmitter.emit('pool', { poolId: new PublicKey(poolId), poolData });
    tokenEmitter.emit('market', { marketId: poolData.marketId.toString(), data: marketData });
    tokenEmitter.emit('newToken', newTokenData);
    
    // Update token status in database
    await prisma.token.update({
      where: { baseAddress },
      data: {
        tokenStatus: 'ACTIVE', 
        marketId: poolData.marketId.toString()
      }
    });

    // Start additional monitoring (as in your original code)
    startHolderTracking(connection, baseAddress);
    
  } catch (error) {
    console.log(chalk.red(`Error processing transaction: ${JSON.stringify(error, null, 2)}`));
  }
}

export async function stopEnhancedMonitoring(connection: Connection) {
  for (const [key, id] of Object.entries(subscriptionIds)) {
    if (id !== null) {
      await connection.removeOnLogsListener(id);
      console.log(`🛑 Stopped ${key} monitoring.`);
      subscriptionIds[key] = null;
    }
  }
  console.log(`🛑 All enhanced monitoring stopped.`);
}