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
import { initializeTokenMetrics, startTokenMonitoring, startTransactionListener } from '../trend/trend-updater';
import { startHolderTracking } from '../trend/holder-count';

let logSubscriptionId: number | null = null;
let walletSubscriptionId: number | null = null;

const MAX_MONITORED_TOKENS = 1;
const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export const tokenEmitter = new EventEmitter();

const rayFee = new PublicKey('7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5');

export async function startMonitoring(connection: Connection, walletPublicKey: PublicKey) {
  console.log(chalk.green(`🔍 Starting New Token & Wallet Monitoring...`));
  try {
    if (logSubscriptionId !== null) {
      console.log(`⚠️ Already monitoring logs, skipping duplicate listener.`);
      return;
    }

    //WSS CONNECTION ON STARTED
    logSubscriptionId = connection.onLogs(
      rayFee,
      async ({ logs, err, signature }) => {
        try {
          if (err) {
            console.error(`connection contains error, ${err}`);
            return;
          }

          //Skip if we reached our monitoring limit
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

          // Run Get Parsed Transaction
          const parsedTransaction = await connection.getParsedTransaction(signature, {
            maxSupportedTransactionVersion: 0,
            commitment: 'confirmed',
          });

          if (parsedTransaction && parsedTransaction.meta && parsedTransaction.meta.err == null) {
            console.log(`successfully parsed transaction`);

            //LOGIC TO CHECK IF ACTIVE POOL ID, IF SO PARSE OUT BUYS AND SELLS AND STORE IN DB AND RETURN TO SKIP NEW TOKEN CHECKING
            const postTokenBalances = parsedTransaction.meta.postTokenBalances;




            // Extract poolId from transaction
            const poolInfo = postTokenBalances?.find((balance) => balance.owner !== null);
            if (poolInfo) {
              poolId = poolInfo.owner;
            }

            if (!poolId) return;
            
            // Fetch active tokens and their associated pool IDs
            const activeTokensWithPools = await prisma.token.findMany({
              where: { tokenStatus: 'ACTIVE' },
              select: {
                baseAddress: true,
                pools: { select: { poolId: true, tokenBaseAddress: true } },
              },
            });

            // Check if transaction poolId matches an active token pool
            const matchedToken = activeTokensWithPools.find((token) =>
              token.pools.some((pool) => pool.poolId === poolId),
            );

            if (matchedToken) {
              console.log(chalk.blue(`🔄 Trade detected for tracked token: ${matchedToken.baseAddress}`));



              // Extract buy/sell information from postTokenBalances
            const tx = parsedTransaction.transaction;
            
            let txType = '' 
            let txAmoutn = 0 

            if (ts.source !== "RAYDIUM" || tx.type !== "SWAP" || !tx.tokenTransfers || tx.tokenTransfers.length < 2) return;
            //debug code
            if (tx.tokenTransfers.length > 3) {
                console.log(`⚠️ More than 3 tokenTransfers detected in TX: ${tx.signature}`);
                console.log(`🔍 Full Token Transfers:`, JSON.stringify(tx.tokenTransfers, null, 2));
            }

            let soldToken, receivedToken;
            if (tx.tokenTransfers.length === 2) {
                // Standard case: 2 tokenTransfers
                soldToken = tx.tokenTransfers[0];
                receivedToken = tx.tokenTransfers[1];
            } else {
                // If more than 2 tokenTransfers, skip the first one
                soldToken = tx.tokenTransfers[1];
                receivedToken = tx.tokenTransfers[2];
            }
            // **BUY Condition:** Swapped SOL for Token
            if (soldToken.mint === "So11111111111111111111111111111111111111112" && soldToken.tokenAmount >= MIN_TRADE_AMOUNT_SOL) {
                txType = 'BUY'
                txAmount = receivedToken.tokenAmount;
            } 
            // **SELL Condition:** Swapped Token for SOL
            else if (receivedToken.mint === "So11111111111111111111111111111111111111112" && receivedToken.tokenAmount >= MIN_TRADE_AMOUNT_SOL) {
                txType = 'SELL'
                txAmount = soldToken.tokenAmount;             
            }

              await prisma.transaction.create({
                data: {
                  tokenBaseAddress: matchedToken.baseAddress,
                  type: txType,
                  amount: txAmount,
                  price: 0, // Placeholder for price
                  timestamp: new Date(),
                },
              });

              console.log(`✅ Recorded ${tradeType} transaction for ${matchedToken.baseAddress}`);
              return;
            }

            // End new logic


            
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
              tokenStatus: 'ACTIVE',
            },
            create: {
              baseAddress,
              baseDecimals,
              baseLpAmount,
              quoteAddress,
              quoteDecimals,
              quoteLpAmount,
              tokenStatus: 'ACTIVE',
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

          //await initializeTokenMetrics(connection, baseAddress, quoteAddress, poolId);
          //startTokenMonitoring(connection, baseAddress, quoteAddress, poolId);
          //startHolderTracking(connection, baseAddress);
          //startTransactionListener(connection, baseAddress, quoteAddress, poolId);
          // Emit events only when data is complete
          tokenEmitter.emit('pool', poolData);
          tokenEmitter.emit('market', { marketId: poolData.marketId.toString(), data: marketData });
          tokenEmitter.emit('newToken', newTokenData);
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

  await subscribeToWalletChanges(connection, walletPublicKey);
}

export async function stopMonitoring(connection: Connection) {
  if (logSubscriptionId !== null) {
    await connection.removeOnLogsListener(logSubscriptionId);
    console.log(`🛑 Stopped monitoring new tokens.`);
    logSubscriptionId = null;
  }

  if (walletSubscriptionId !== null) {
    await stopWalletMonitoring(connection);
    console.log(`🛑 Stopped monitoring wallet changes.`);
    walletSubscriptionId = null;
  }
}
