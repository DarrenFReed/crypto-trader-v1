import { Connection, PublicKey } from '@solana/web3.js';
import { PrismaClient } from '@prisma/client';
import chalk from 'chalk';
import { SubscriptionManager } from '../services/subscription-manager';
import { LIQUIDITY_STATE_LAYOUT_V4, MAINNET_PROGRAM_ID, MARKET_STATE_LAYOUT_V3, Token } from '@raydium-io/raydium-sdk';
import fs from 'fs';

const prisma = new PrismaClient();
const activeMonitors = new Map<string, NodeJS.Timeout>();
const MIN_SOL_AMOUNT = 0.1;
const MAX_SOL_AMOUNT = 900;
const RAYDIUM_AMM_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');


// Define the mint address for wrapped SOL (WSOL)
const WSOL_MINT = 'So11111111111111111111111111111111111111112'; // Replace with the actual WSOL mint address

export async function startTokenMonitoring(
  connection: Connection,
  tokenMint: string,
  quoteMint: string
  //poolId: string,
  //baseVault: string,
  //quoteVault: string,
) {
  const subscriptionManager = SubscriptionManager.getInstance(connection);
  console.log(chalk.blue(`🔄 Starting WSS tracking for: ${tokenMint}`));

  const solanaSubId = connection.onLogs(
    new PublicKey(tokenMint),
    async ({ logs, signature }) => {
      //console.log(chalk.yellow(`📡 Processing transaction: ${signature}`));

      try {
        // Fetch the parsed transaction
        const parsedTransaction = await connection.getParsedTransaction(signature, {
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed',
        });

        if (!parsedTransaction || !parsedTransaction.meta) {
          //console.log(`⚠️ No valid transaction data found for ${signature}`);
          return;
        }

        // Save the parsed transaction to a file for debugging
        //fs.appendFileSync(`${tokenMint}.json`, JSON.stringify(parsedTransaction, null, 2));

        const transactionAccounts = parsedTransaction.transaction.message.accountKeys.map((key) =>
          key.pubkey.toBase58(),
        );

        // Check if the Raydium AMM program is involved
        if (!transactionAccounts.includes(RAYDIUM_AMM_PROGRAM_ID.toBase58())) {
         //console.log(`❌ Transaction ${signature} is NOT a Raydium swap, skipping.`);
          return;
        }

        // *** This uses the pre and post ballance methoe to determin buy or sell ****
        

        const raydiumAccount = '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1'; // Raydium Swap Account
        const preTokenBalances = parsedTransaction.meta.preTokenBalances || [];
        const postTokenBalances = parsedTransaction.meta.postTokenBalances || [];
        const baseMintBase58 = new PublicKey(tokenMint).toBase58();
        const quoteMintBase58 = new PublicKey(quoteMint).toBase58();
        
        // ✅ Filter balances to only include Raydium account
        const balanceChanges = postTokenBalances
          .filter((postBalance) => postBalance.owner === raydiumAccount) // ✅ Only process Raydium swaps
          .map((postBalance) => {
            const preBalance = preTokenBalances.find(
              (pre) => pre.mint === postBalance.mint && pre.owner === raydiumAccount // ✅ Hardcoded Raydium account
            );
        
            const preAmount = preBalance?.uiTokenAmount.uiAmount || 0;
            const postAmount = postBalance.uiTokenAmount.uiAmount || 0;
        
            return {
              transactionSignature: signature,
              account: postBalance.owner,
              mint: postBalance.mint,
              change: postAmount - preAmount, // Net change
              preAmount,
              postAmount,
            };
          });

        // Log balance changes for debugging
        //console.log('Balance Changes:', balanceChanges);
 /*        fs.appendFileSync(
          `balance_changes_${tokenMint}.json`,
          `Transaction: ${signature}\nBalance Changes:\n${JSON.stringify(balanceChanges, null, 2)}\n\n`,
        ); */

        // **Step 1: Get Token Change for Raydium Account**
        const raydiumTokenChange = balanceChanges.find(
          (b) => b.account === raydiumAccount && b.mint === baseMintBase58,
        );

        // If no token movement, skip
        if (!raydiumTokenChange || raydiumTokenChange.change === 0) {
          //console.log(`⚠️ Transaction ${signature} does not involve the token swap.`);
          return;
        }

        // **Step 2: Determine Buy or Sell**
        
        const isBuy = raydiumTokenChange.change < 0; // Negative = Tokens Left Raydium (BUY)
        const isSell = raydiumTokenChange.change > 0; // Positive = Tokens Entered Raydium (SELL)

        const txBcType = isBuy ? 'BUY' : 'SELL';
        //const txBcAmount = Math.abs(raydiumTokenChange.change);

        // **Step 3: Get WSOL Change for Raydium Account (SOL Spent/Received)**

         let solChange = balanceChanges.find(
            (b) => b.account === raydiumAccount && b.mint === 'So11111111111111111111111111111111111111112'
          )?.change || 0; 
        
      // **Step 5: Ensure SOL Amount is Correct**
        solChange = Math.abs(solChange); // Assume it's already in SOL

        // **Step 4: Skip Small Transactions**
        // || txBcAmount > MAX_SOL_AMOUNT
        if (solChange < MIN_SOL_AMOUNT) {
            //console.log(`⚠️ Transaction ${signature} involves less than ${MIN_SOL_AMOUNT} SOL, skipping.`);
             return;
        }  
        // **Step 5: Log & Save Transaction**
        console.log(`✅ Detected ${txBcType} - SOL: ${solChange}`);

        await prisma.transaction.create({
          data: {
            tokenBaseAddress: tokenMint,
            type: txBcType,
            amount: solChange,
            price: 0, // Replace with actual price calculation if needed
            timestamp: new Date(),
          },
        });

       //console.log(chalk.green(`📊 Appended metrics for transaction ${signature}`));
      } catch (error) {
        console.error(`❌ Error processing transaction ${signature}:`, error);
      }
    },
    'confirmed',
  );

  await subscriptionManager.addSubscription(tokenMint, solanaSubId);
  activeMonitors.set(tokenMint, solanaSubId); // Store the subscription ID for later cleanup
}

function lamportsToReadable(lamports: number, decimals: number): number {
  return lamports / Math.pow(10, decimals);
}

export async function stopTokenMonitoring(connection: Connection, tokenMint: string) {
  const subscriptionManager = SubscriptionManager.getInstance(connection);

  console.log(chalk.red(`🛑 Stopping token monitoring for ${tokenMint}`));

  // ❌ Stop WebSocket log monitoring
  await subscriptionManager.removeSubscription(tokenMint);

  // ❌ Clear timeout if exists
  if (activeMonitors.has(tokenMint)) {
    clearInterval(activeMonitors.get(tokenMint)!);
    activeMonitors.delete(tokenMint);
  }

  console.log(chalk.red(`🚨 Token monitoring stopped & token marked as FAILED: ${tokenMint}`));
}

async function fetchLatestPoolKeys(connection: Connection, poolId: string) {
  console.log(`🔍 Fetching latest pool data for pool ID: ${poolId}`);

  try {
    // Fetch full pool account info from Raydium
    const poolAccountInfo = await connection.getAccountInfo(new PublicKey(poolId));

    if (!poolAccountInfo) {
      console.log(`❌ No Raydium pool data available for ${poolId}`);
      return null;
    }

    // Decode pool data
    const poolData = LIQUIDITY_STATE_LAYOUT_V4.decode(poolAccountInfo.data);

    // Extract Vault Keys
    const poolKeys = {
      baseVault: new PublicKey(poolData.baseVault).toString(),
      quoteVault: new PublicKey(poolData.quoteVault).toString(),
      baseMint: new PublicKey(poolData.baseMint).toString(),
      quoteMint: new PublicKey(poolData.quoteMint).toString(),
      marketId: new PublicKey(poolData.marketId).toString(),
    };

    console.log('✅ Latest Pool Keys:', poolKeys);
    return poolKeys;
  } catch (error) {
    console.error(`❌ Error fetching latest pool data:`, error);
    return null;
  }
}

/* function extractPoolIdFromParsedTransaction(parsedTransaction) {
  if (!parsedTransaction || !parsedTransaction.transaction || !parsedTransaction.transaction.message) {
    console.log('❌ Parsed transaction is invalid');
    return null;
  }

  // Extract all account keys from the transaction
  const accountKeys = parsedTransaction.transaction.message.accountKeys.map((key) => key.toString());

  // ✅ Check if any account matches a known pool format (Raydium AMM Pool ID)
  const potentialPoolId = accountKeys.find((key) => key.startsWith('6') || key.startsWith('D'));

  if (!potentialPoolId) {
    console.log('❌ No pool ID found in transaction');
    return null;
  }

  console.log(`🔍 Extracted Pool ID from TX: ${potentialPoolId}`);
  return potentialPoolId;
} */
