import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import fs from 'fs';
import chalk from 'chalk';
import path from 'path';
import { MAINNET_PROGRAM_ID } from '@raydium-io/raydium-sdk';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { EventEmitter } from 'events';
import { PrismaClient } from '@prisma/client';
import { fetchPoolData } from '../helpers/fetchPoolData';
import { fetchMarketData } from '../helpers/fetchMarketData';
import { subscribeToWalletChanges, stopWalletMonitoring } from './walletMonitor';
import { startTokenMonitoring,} from '../trend/trend-updater';
import { startHolderTracking } from '../trend/holder-count';
import bs58 from 'bs58';
import { Bot, BotConfig } from '../bot';

let logSubscriptionId: number | null = null;
let walletSubscriptionId: number | null = null;

const MAX_MONITORED_TOKENS = 1;
const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export const tokenEmitter = new EventEmitter();

const rayFee = new PublicKey('7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5');

export async function startMonitoring(connection: Connection, newTokenConnection: Connection,txConnection: Connection, walletPublicKey: PublicKey) {
  console.log(chalk.green(`🔍 Starting New Token & Wallet Monitoring...`));
  try {
    if (logSubscriptionId !== null) {
      console.log(`⚠️ Already monitoring logs, skipping duplicate listener.`);
      return;
    }

    //WSS CONNECTION ON STARTED
    logSubscriptionId = newTokenConnection.onLogs(
      rayFee,
      async ({ logs, err, signature }) => {
        try {
          if (err) {
            console.error(`connection contains error, ${err}`);
            return;
          }

          //console.log(chalk.bgGreen(`found new token signature: ${signature}`));

          const currentMonitoringCount = await prisma.token.count({
            where: { tokenStatus: { in: ['ACTIVE', 'BUY_CANDIDATE', 'WAITING_FOR_POOL', 'POOL_FOUND', 'BOUGHT'] } },
          });

          if (currentMonitoringCount >= MAX_MONITORED_TOKENS) {
            console.log(chalk.red(`🚨 Max monitored token limit reached after fetching transaction. Skipping.`));
            return;
          } else {
            console.log(chalk.bgGreen(`found new token signature: ${signature}`));
          }

          let signer = '';
          let baseAddress = '';
          let baseDecimals = 0;
          let baseLpAmount = 0;
          let quoteAddress = '';
          let quoteDecimals = 0;
          let quoteLpAmount = 0;
          let marketId = '';
          let lpMint = '';
          let poolId = '';
          let poolTokenAccount = '';
          let poolQuoteAccount = '';

          const parsedTransaction = await connection.getParsedTransaction(signature, {
            maxSupportedTransactionVersion: 0,
            commitment: 'confirmed',
          });

          if (parsedTransaction && parsedTransaction.meta && parsedTransaction.meta.err == null) {
            console.log(`successfully parsed transaction`);

            signer = parsedTransaction?.transaction.message.accountKeys[0].pubkey.toString();

            console.log(`creator, ${signer}`);

            const postTokenBalances = parsedTransaction?.meta.postTokenBalances;

            const baseInfo = postTokenBalances?.find(
              (balance) =>
                balance.owner === '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1' &&
                balance.mint !== 'So11111111111111111111111111111111111111112',
            );

            if (baseInfo) {
              baseAddress = baseInfo.mint;
              baseDecimals = baseInfo.uiTokenAmount.decimals;
              baseLpAmount = baseInfo.uiTokenAmount.uiAmount ?? 0;
              console.log(`baseAddress: , ${baseAddress}`);
            }

            if (!baseAddress.endsWith('pump')) {
              console.log(`❌ Ignoring non-Pump.fun token: ${baseAddress}`);
              return;
            }

            const quoteInfo = postTokenBalances?.find(
              (balance) =>
                balance.owner == '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1' &&
                balance.mint == 'So11111111111111111111111111111111111111112',
            );

            if (quoteInfo) {
              quoteAddress = quoteInfo.mint;
              quoteDecimals = quoteInfo.uiTokenAmount.decimals;
              quoteLpAmount = quoteInfo.uiTokenAmount.uiAmount ?? 0;
            }
            //const __filename = fileURLToPath(import.meta.url);
            //const __dirname = path.dirname(__filename);
            //const OUTPUT_FILE = path.join(__dirname, 'transaction_logs.json');

            if (parsedTransaction.meta.innerInstructions) {
              for (const instruction of parsedTransaction.meta.innerInstructions) {
                for (const log of instruction.instructions) {
                  // ✅ Detect the Allocate instruction creating a Raydium pool (Ensure 752 bytes)
                  if ('parsed' in log && log.parsed.type === 'allocate' && log.parsed.info.space === 752) {
                    const candidatePoolId = log.parsed.info.account;
                    //console.log(`✅ Possible Pool ID (Allocation Found - 752 bytes): ${candidatePoolId}`);

                    // ✅ Check if it's assigned to Raydium's AMM program
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

            // ✅ Final verification
            if (poolId) {
              console.log(`✅ Final Confirmed Pool ID: ${poolId}`);
            } else {
              console.log('❌ No Valid Pool ID found in transaction.');
            }
          }

          // ✅ Construct new token data
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
          console.log(`✅ Added New Token to Database ${baseAddress}`);
          if (!poolId || poolId.trim() === '') {
            console.log(`❌ Pool ID not yet available, delaying fetch for ${baseAddress}`);
            await sleep(500); // ✅ Wait for pool ID to become available
            return;
          }
          // Fetch pool data
          const poolData = await fetchPoolData(connection, poolId, baseAddress);
          if (!poolData) {
            console.log(`❌ No pool data found for ${baseAddress}, skipping event emission.`);
            return;
          }

          const marketData = await fetchMarketData(connection, poolData.marketId.toString());
          if (!marketData) {
            console.log(`❌ No market data found for ${baseAddress}, skipping event emission.`);
            return;
          }

          //  Log once after confirming both exist
          console.log(`✅ Successfully retrieved both Raydium pool and Market data for ${baseAddress}`);



          //await Bot(poolId, poolData);

          //startTransactionListener(connection, baseAddress, quoteAddress, poolId);
          // Emit events only when data is complete
          tokenEmitter.emit('pool', {poolId: new PublicKey(poolId), poolData});
          tokenEmitter.emit('market', { marketId: poolData.marketId.toString(), data: marketData });
          tokenEmitter.emit('newToken', newTokenData);
          //await initializeTokenMetrics(connection, baseAddress, quoteAddress, poolId); 
          startTokenMonitoring(connection, baseAddress, quoteAddress); 
          startHolderTracking(connection, baseAddress); 

        } catch (error) {
          const errorMessage = `error occured in new solana token log callback function, ${JSON.stringify(error, null, 2)}`;
          console.log(chalk.red(errorMessage));
        }
      },
      'confirmed',
    );
  } catch (error) {
    const errorMessage = `error occured in new sol lp monitor, ${JSON.stringify(error, null, 2)}`;
    console.log(chalk.red(errorMessage));
  }

  //subscribeToWalletChanges(connection, walletPublicKey);
}

export async function stopMonitoring(connection: Connection) {
  if (logSubscriptionId !== null) {
    await connection.removeOnLogsListener(logSubscriptionId);
    console.log(`🛑 Stopped monitoring new tokens.`);
    logSubscriptionId = null;
    //await stopWalletMonitoring(connection);
  }
}



  /*   if (walletSubscriptionId !== null) {
    await stopWalletMonitoring(connection);
    console.log(`🛑 Stopped monitoring wallet changes.`);
    walletSubscriptionId = null;
  }
} */

/* async function getPoolAccounts(poolId: string) {
  const poolKeys = await fetchPoolKeys(new PublicKey(poolId));
  return {
      tokenAccount: poolKeys.baseVault, // Token account in the pool
      wsolAccount: poolKeys.quoteVault, // wSOL account in the pool
  };
} */
