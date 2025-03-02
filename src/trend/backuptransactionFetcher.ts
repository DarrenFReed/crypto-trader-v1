import { Connection, PublicKey } from '@solana/web3.js';
import { PrismaClient } from '@prisma/client';
import chalk from 'chalk';

const prisma = new PrismaClient();
const MIN_TRADE_AMOUNT_SOL = 0.1;
const FETCH_LIMIT = 25;

/**
 * Processes transactions for a token, either fetching historical transactions or batch processing real-time WSS transactions.
 */
export async function processTransactions(
    connection: Connection,
    tokenMint: string,
    quoteMint: string,
    historical?: boolean,
    transactionSignatures?: string[]
) {
    try {
        if (historical) {
            const tokenPublicKey = new PublicKey(tokenMint);
            const signatures = await connection.getSignaturesForAddress(tokenPublicKey, {
                limit: FETCH_LIMIT,
            });
            console.log(chalk.yellow(`📡 Fetching Historical batch of ${signatures.length} transactions for ${tokenMint}...`));

            if (!signatures.length) {
                console.log(chalk.gray(`⚠️ No new historical transactions found for ${tokenMint}.`));
                return null;
            }

            transactionSignatures = signatures.map((tx) => tx.signature);
        }

        if (!transactionSignatures || transactionSignatures.length === 0) {
            console.log(chalk.gray(`⚠️ No transaction signatures to process for ${tokenMint}.`));
            return null;
        }

        console.log(chalk.yellow(`📡 Processing batch of ${transactionSignatures.length} transactions for ${tokenMint}...`));

        const parsedTransactions = await connection.getParsedTransactions(transactionSignatures, {
            maxSupportedTransactionVersion: 1,
        });

        if (!parsedTransactions || parsedTransactions.length === 0) {
            console.log(chalk.gray(`⚠️ No valid transactions found for ${tokenMint}.`));
            return null;
        }

        console.log(chalk.green(`🔍 Retrieved ${parsedTransactions.length} transactions for ${tokenMint}.`));

        let buyCount = 0;
        let sellCount = 0;
        let buyVolume = 0;
        let sellVolume = 0;
        let tradeFrequency = 0;
        let lastTransactionSignature = '';

        for (let i = 0; i < parsedTransactions.length; i++) {
            const parsedTx = parsedTransactions[i];
            const signature = transactionSignatures[i];

            if (!parsedTx || !parsedTx.meta) {
                console.log(chalk.gray(`⚠️ Skipping transaction - No meta data found.`));
                continue;
            }

            const { meta } = parsedTx;
            const postTokenBalances = meta.postTokenBalances;
            const preTokenBalances = meta.preTokenBalances;

            if (!postTokenBalances || !preTokenBalances) {
                console.log(chalk.gray(`⚠️ Skipping transaction - No token balances found.`));
                continue;
            }

            const basePre = preTokenBalances.find((b) => b.mint === tokenMint);
            const basePost = postTokenBalances.find((b) => b.mint === tokenMint);
            const quotePre = preTokenBalances.find((b) => b.mint === quoteMint);
            const quotePost = postTokenBalances.find((b) => b.mint === quoteMint);

            if (!basePre || !basePost || !quotePre || !quotePost) continue;

            const baseAmountBefore = basePre.uiTokenAmount.uiAmount ?? 0;
            const baseAmountAfter = basePost.uiTokenAmount.uiAmount ?? 0;
            const baseDiff = baseAmountAfter - baseAmountBefore;

            const quoteAmountBefore = quotePre.uiTokenAmount.uiAmount ?? 0;
            const quoteAmountAfter = quotePost.uiTokenAmount.uiAmount ?? 0;
            const quoteDiff = quoteAmountBefore - quoteAmountAfter;

            if (Math.abs(baseDiff) < MIN_TRADE_AMOUNT_SOL) continue;

            if (baseDiff > 0 && quoteDiff < 0) {
                buyCount++;
                buyVolume += baseDiff;
                tradeFrequency++;
            } else if (baseDiff < 0 && quoteDiff > 0) {
                sellCount++;
                sellVolume += Math.abs(baseDiff);
                tradeFrequency++;
            } else {
                continue;
            }

            lastTransactionSignature = signature;
        }

        if (tradeFrequency === 0) {
            console.log(`⚠️ Skipping DB insert for ${tokenMint} - No valid trades detected.`);
            return null;
        }

        console.log(chalk.blue(`📊 Token: ${tokenMint} | Buys: ${buyCount} | Sells: ${sellCount} | Buy Volume: ${buyVolume} | Sell Volume: ${sellVolume} | Trades: ${tradeFrequency}`));

        return {
            buyCount,
            sellCount,
            buyVolume,
            sellVolume,
            tradeFrequency,
            lastTransactionSignature,
        };
    } catch (error) {
        console.error(`❌ Error processing transactions for ${tokenMint}:`, error);
        return null;
    }
}