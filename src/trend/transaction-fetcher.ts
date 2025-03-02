import chalk from 'chalk';
import fs from 'fs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const MIN_TRADE_AMOUNT_SOL = 0.1;
const MAX_RATIO_CAP = 5; // Define a reasonable maximum cap for the ratio

interface TransactionStats {
    buyCount: number;
    sellCount: number;
    buyVolume: number;
    sellVolume: number;
    tradeFrequency: number;
    buySellTxRatio: number;
    buySellVolumeRatio: number;
    lastTransactionSignature: string;
}

/**
 * Processes transactions and extracts trade metrics.
 * 
 * @param transactions - Parsed transactions from Helius API.
 * @param tokenMint - The base token being analyzed.
 * @param quoteMint - The quote token used in the pool.
 * @param poolId - The pool ID where the trades occurred.
 * @returns Processed transaction metrics.
 */
export async function processTransactions(
    transactions: any[],
    tokenMint: string,
    quoteMint: string,
    poolId: string
): Promise<TransactionStats | null> {
    try {
        if (!transactions || transactions.length === 0) {
            console.log(chalk.gray(`⚠️ No valid transactions found for ${tokenMint}.`));
            return null;
        }

        //console.log(chalk.green(`🔍 Processing ${transactions.length} transactions for ${tokenMint}.`));

        let buyCount = 0;
        let sellCount = 0;
        let buyVolume = 0;
        let sellVolume = 0;
        let tradeFrequency = 0;
        let lastTransactionSignature = '';

        for (const tx of transactions) {
            if (tx.source !== "RAYDIUM" || tx.type !== "SWAP" || !tx.tokenTransfers || tx.tokenTransfers.length < 2) continue;
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
                buyCount++;
                buyVolume += receivedToken.tokenAmount;
            } 
            // **SELL Condition:** Swapped Token for SOL
            else if (receivedToken.mint === "So11111111111111111111111111111111111111112" && receivedToken.tokenAmount >= MIN_TRADE_AMOUNT_SOL) {
                sellCount++;
                sellVolume += soldToken.tokenAmount;
            }
            lastTransactionSignature = tx.signature;
        }

        tradeFrequency = buyCount + sellCount;

        if (tradeFrequency === 0) {
            console.log(`⚠️ Skipping DB insert for ${tokenMint} - No valid trades detected.`);
            return null;
        }

        const buySellTxRatio = sellCount === 0 ? buyCount : buyCount / sellCount;
        const rawVolumeRatio = sellVolume === 0 ? buyVolume : buyVolume / sellVolume;
        const buySellVolumeRatio = Math.min(rawVolumeRatio, MAX_RATIO_CAP);

        console.log(chalk.blue(`📊 Token: ${tokenMint} | Buys: ${buyCount} | Sells: ${sellCount} | Buy Volume: ${buyVolume} | Sell Volume: ${sellVolume} | Trades: ${tradeFrequency}`));

        // Save processed transactions to a local file for debugging
        fs.appendFileSync(`helius_transactions_${tokenMint}.json`, JSON.stringify(transactions, null, 2));

        return {
            buyCount,
            sellCount,
            buyVolume,
            sellVolume,
            tradeFrequency,
            buySellTxRatio,
            buySellVolumeRatio,
            lastTransactionSignature,
        };
    } catch (error) {
        if (error instanceof Error) {
            console.error(chalk.red(`❌ Error processing transactions for ${tokenMint}: ${error.message}`));
        } else {
            console.error(chalk.red(`❌ Error processing transactions for ${tokenMint}: ${error}`));
        }
        return null;
    }
}
