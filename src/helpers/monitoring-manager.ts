import { Connection } from '@solana/web3.js';
import { stopHolderTracking } from '../trend/holder-count';
import { stopTokenMonitoring } from '../trend/trend-updater';
import { SubscriptionManager } from '../services/subscription-manager';
import { PrismaClient } from '@prisma/client';
import chalk from 'chalk';

const prisma = new PrismaClient();

/**
 * Stops all monitoring (pool, trend, and holder tracking) for a given token.
 */
export async function stopMonitoring(connection: Connection, tokenMint: string) {
    console.log(chalk.red(`🛑 Stopping ALL monitoring for ${tokenMint}.`));

    // Get SubscriptionManager instance with connection
    const subscriptionManager = SubscriptionManager.getInstance(connection);

    //  Stop WebSocket log monitoring
    await subscriptionManager.removeSubscription(tokenMint);

    //  Stop trend monitoring
    stopTokenMonitoring(connection,tokenMint);

    //  Stop holder tracking
    stopHolderTracking(tokenMint);

    //  Mark token as FAILED in database
    await prisma.token.update({
        where: { baseAddress: tokenMint },
        data: { tokenStatus: 'FAILED' },
    });

    console.log(chalk.red(`🚨 Monitoring stopped & token marked as FAILED: ${tokenMint}`));
}
