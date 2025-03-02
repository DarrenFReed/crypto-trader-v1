import { Connection, PublicKey } from '@solana/web3.js';
import { PrismaClient } from '@prisma/client';
import chalk from 'chalk';
import { processTransactions } from './transaction-fetcher';
import { SubscriptionManager } from '../services/subscription-manager';

const prisma = new PrismaClient();
const activeMonitors = new Map<string, NodeJS.Timeout>();

export async function initializeTokenMetrics(connection: Connection, tokenMint: string, quoteMint: string, poolId: string) {
    console.log(chalk.yellow(`🆕 New token detected: ${tokenMint}. Initializing metrics...`));
    const historicalMetrics = await processTransactions(connection, tokenMint, quoteMint, poolId, true);
    
    await prisma.tokenMetrics.create({
        data: {
            tokenBaseAddress: tokenMint,
            ...historicalMetrics,
            createdAt: new Date(),
        },
    });

    console.log(chalk.green(`✅ Successfully initialized metrics for ${tokenMint}`));
}

export async function startTokenMonitoring(connection: Connection, tokenMint: string, quoteMint: string, poolId: string) {
    const subscriptionManager = SubscriptionManager.getInstance(connection);
    console.log(chalk.blue(`🔄 Starting WSS tracking for: ${tokenMint}`));

    let transactionQueue: string[] = [];
    let isProcessing = false;
    const BATCH_SIZE = 90;
    const BATCH_INTERVAL = 30000; // 30 seconds

    const processingTimer = setInterval(async () => {
        if (transactionQueue.length > 0 && !isProcessing) {
            console.log(chalk.blue(`⏳ Timer triggered batch processing for ${tokenMint} with ${transactionQueue.length} transactions...`));
            //await processBatch();
        }
    }, BATCH_INTERVAL);

    const solanaSubId = connection.onLogs(new PublicKey(tokenMint), async ({ logs, signature }) => {
        transactionQueue.push(signature);
    }, 'confirmed');

    await subscriptionManager.addSubscription(tokenMint, solanaSubId);
    activeMonitors.set(tokenMint, processingTimer);


    // Process a batch of transactions
    async function processBatch() {
        if (transactionQueue.length === 0 || isProcessing) return;
        isProcessing = true;
        const batch = transactionQueue.slice(0, BATCH_SIZE); // Copy the first batch
        transactionQueue = transactionQueue.slice(BATCH_SIZE); // Keep unprocessed transactions
    
        //const batch = transactionQueue.splice(0, BATCH_SIZE);
        //console.log(chalk.yellow(`📡 Processing batch of ${batch.length} transactions for ${tokenMint}...`));

        const batchResults = await processTransactions(connection, tokenMint, quoteMint, poolId, false, batch);

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
        transactionQueue = [];
        isProcessing = false;
    }
}

export async function stopTokenMonitoring(connection: Connection, tokenMint: string) {
    const subscriptionManager = SubscriptionManager.getInstance(connection);
    
    console.log(chalk.red(` Stopping token monitoring for ${tokenMint}`));

    //  Stop WebSocket log monitoring
    await subscriptionManager.removeSubscription(tokenMint);

    //  Clear timeout if exists
    if (activeMonitors.has(tokenMint)) {
        clearInterval(activeMonitors.get(tokenMint)!);
        activeMonitors.delete(tokenMint);
    }

    console.log(chalk.red(`🚨 Token monitoring stopped & token marked as FAILED: ${tokenMint}`));
}

