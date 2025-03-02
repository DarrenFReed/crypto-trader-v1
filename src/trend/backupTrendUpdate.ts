import { Connection, PublicKey } from '@solana/web3.js';
import { PrismaClient } from '@prisma/client';
import chalk from 'chalk';
import { processTransactions } from './transaction-fetcher';
//import { fetchHolderCount } from './holder-count';
import { SubscriptionManager } from '../services/subscription-manager';
import { TrendFilters } from '../filters/trend-filters';

const prisma = new PrismaClient();
const RESTART_THRESHOLD_MINUTES = 5;
const MONITOR_TIMEOUT_MINUTES = 15; // ⏳ Stop tracking after 15 minutes

/**
 * Initializes token metrics when a new token is detected.
 */
export async function initializeTokenMetrics(connection: Connection, tokenMint: string, quoteMint: string) {
    console.log(chalk.yellow(`🆕 New token detected: ${tokenMint}. Initializing metrics...`));

    const historicalMetrics = await processTransactions(connection, tokenMint, quoteMint);
    //const holdersCount = await fetchHolderCount(connection, tokenMint);

    await prisma.tokenMetrics.create({
        data: {
            tokenBaseAddress: tokenMint,
            ...historicalMetrics,
            //holdersCount,
            createdAt: new Date(),
        },
    });

    console.log(chalk.green(`✅ Successfully initialized metrics for ${tokenMint}`));
}

/**
 * Handles real-time transaction updates via WebSocket (WSS).
 */
export async function startTokenMonitoring(connection: Connection, tokenMint: string, quoteMint: string) {
    const subscriptionManager = SubscriptionManager.getInstance(connection);
    console.log(chalk.blue(`🔄 Starting WSS tracking for: ${tokenMint}`));

    let transactionQueue: string[] = [];
    let isProcessing = false;

    const solanaSubId = connection.onLogs(new PublicKey(tokenMint), async ({ logs, signature }) => {
        //console.log(chalk.magenta(`🆕 New transaction detected for ${tokenMint}: ${signature}`));
        transactionQueue.push(signature);
    }, 'confirmed');

    // Store subscription
    await subscriptionManager.addSubscription(tokenMint, solanaSubId);

    // 🏆 **Batch Process Every 15 Seconds (Adjustable)**
    setInterval(async () => {
        if (transactionQueue.length === 0 || isProcessing) return;
        isProcessing = true;

        console.log(chalk.yellow(`📡 Processing ${transactionQueue.length} queued transactions for ${tokenMint}...`));

        const batchResults = await processTransactions(connection, tokenMint, quoteMint, false, transactionQueue);

        if (batchResults) {
            await prisma.tokenMetrics.create({
                data: {
                    tokenBaseAddress: tokenMint,
                    ...batchResults,
                    createdAt: new Date(),
                },
            });
            console.log(chalk.green(`📊 Appended batch metrics for ${tokenMint}`));
        }

        // ✅ Clear Queue After Processing
        transactionQueue = [];
        isProcessing = false;
    }, 15000); // Every 15 seconds

    // ⏳ **Timeout to Stop Monitoring If No Activity**
    setTimeout(async () => {
        console.log(chalk.red(`🛑 Timeout reached for ${tokenMint}, stopping monitoring.`));
        await subscriptionManager.removeSubscription(tokenMint);
        await prisma.token.update({
            where: { baseAddress: tokenMint },
            data: { tokenStatus: 'FAILED' },
        });
    }, MONITOR_TIMEOUT_MINUTES * 60 * 1000);
}


/**
 * Main function to initialize and monitor all tracked tokens.
 */
async function runTrendUpdater(connection: Connection) {
    const tokens = await prisma.token.findMany();
    console.log("📊 Running initial trend evaluation on all tokens...");
    
    for (const token of tokens) {
        await initializeTokenMetrics(connection, token.baseAddress, token.quoteAddress);
        await startTokenMonitoring(connection, token.baseAddress, token.quoteAddress);
    }
}

export { runTrendUpdater };
