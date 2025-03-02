import { Connection, PublicKey } from '@solana/web3.js';
import { PrismaClient } from '@prisma/client';
import chalk from 'chalk';

const prisma = new PrismaClient();

export class SubscriptionManager {
    private static instance: SubscriptionManager;
    private connection: Connection;
    private subscriptions: Map<string, number>;

    private constructor(connection: Connection) {
        this.connection = connection;
        this.subscriptions = new Map();
    }

    // Singleton Instance Getter
    public static getInstance(connection?: Connection): SubscriptionManager {
        if (!SubscriptionManager.instance) {
            if (!connection) {
                throw new Error("Connection must be provided when initializing SubscriptionManager for the first time.");
            }
            SubscriptionManager.instance = new SubscriptionManager(connection);
        }
        return SubscriptionManager.instance;
    }
    /**
     * Adds a new subscription to track WebSocket updates.
     */
    public async addSubscription(tokenMint: string, solanaSubId: number) {
        console.log(chalk.green(`📌 Tracking subscription for ${tokenMint} (Solana ID: ${solanaSubId})`));

        this.subscriptions.set(tokenMint, solanaSubId);

        // Store active subscription in the database
        await prisma.activeSubscription.create({
            data: {
                tokenBaseAddress: tokenMint,
                solanaSubId,
                createdAt: new Date(),
            },
        });
    }

    /**
     * Removes a subscription when tracking is no longer needed.
     */
    public async removeSubscription(tokenMint: string) {
        if (this.subscriptions.has(tokenMint)) {
            const solanaSubId = this.subscriptions.get(tokenMint);
            console.log(chalk.red(`🛑 Removing subscription for ${tokenMint} (Solana ID: ${solanaSubId})`));

            this.connection.removeOnLogsListener(solanaSubId!);
            this.subscriptions.delete(tokenMint);

            // Remove from the database
            await prisma.activeSubscription.deleteMany({ where: { tokenBaseAddress: tokenMint } });
        }
    }

    /**
     * Clears all subscriptions (useful during shutdown).
     */
    public async clearAllSubscriptions() {
        console.log(chalk.yellow(`🔄 Clearing all active subscriptions...`));

        for (const [tokenMint, solanaSubId] of this.subscriptions.entries()) {
            this.connection.removeOnLogsListener(solanaSubId);
        }
        this.subscriptions.clear();

        // Clear database records
        await prisma.activeSubscription.deleteMany({});
    }

    /**
     * Reloads subscriptions from the database on system restart.
     */
    public async reloadSubscriptions() {
        console.log(chalk.blue(`🔄 Reloading active subscriptions from database...`));

        const activeSubscriptions = await prisma.activeSubscription.findMany();
        for (const sub of activeSubscriptions) {
            this.subscriptions.set(sub.tokenBaseAddress, sub.solanaSubId);
        }
    }
}
