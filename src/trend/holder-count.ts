import { Connection, PublicKey } from '@solana/web3.js';
import { PrismaClient } from '@prisma/client';
import chalk from 'chalk';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

const prisma = new PrismaClient();
const UPDATE_INTERVAL_MS = 10000; // ⏳

/**
 * Fetches unique wallet count (holders) for a given token.
 */
async function fetchHolderCount(connection: Connection, tokenMint: string): Promise<number> {
    try {
        const accounts = await connection.getProgramAccounts(TOKEN_PROGRAM_ID, {
            filters: [
                { dataSize: 165 }, // SPL Token account size
                { memcmp: { offset: 0, bytes: tokenMint } } // Match token mint
            ]
        });

        const uniqueWallets = new Set<string>();

        for (const account of accounts) {
            const accountInfo = account.account.data;
            const ownerAddress = new PublicKey(Uint8Array.prototype.slice.call(accountInfo, 32, 64)).toString();
            uniqueWallets.add(ownerAddress);
        }

        return uniqueWallets.size;
    } catch (error) {
        console.error(`❌ Error fetching holder count for ${tokenMint}:`, error);
        return 0;
    }
}

/**
 * Continuously updates the holder count for a token until it is marked as FAILED.
 */
const trackingProcesses = new Map<string, boolean>();

export async function startHolderTracking(connection: Connection, tokenMint: string) {
    console.log(chalk.yellow(`📊 Starting holder tracking for ${tokenMint}...`));

    // Mark this token as actively tracked
    trackingProcesses.set(tokenMint, true);

    while (trackingProcesses.get(tokenMint)) {
        // 🔍 Check if token is still active
        const token = await prisma.token.findUnique({
            where: { baseAddress: tokenMint },
            select: { tokenStatus: true }
        });

        if (!token || token.tokenStatus === 'FAILED') {
            console.log(chalk.red(`🛑 Stopping holder tracking for ${tokenMint} (marked as FAILED).`));
            trackingProcesses.delete(tokenMint); //Remove from active tracking
            return; // 🚀 Exit the function COMPLETELY
        }

        // 🔄 Fetch latest holder count
        const holderCount = await fetchHolderCount(connection, tokenMint);

        // 📝 Store new holder count record
        await prisma.tokenHolders.create({
            data: {
                tokenBaseAddress: tokenMint,
                holdersCount: holderCount,
                createdAt: new Date()
            }
        });

        console.log(chalk.green(`✅ Updated holder count for ${tokenMint}: ${holderCount} holders.`));

        // ⏳ Wait before next update
        await new Promise(resolve => setTimeout(resolve, UPDATE_INTERVAL_MS));
    }
}

/**
 * Stops holder tracking for a specific token.
 */
export function stopHolderTracking(tokenMint: string) {
    if (trackingProcesses.has(tokenMint)) {
        console.log(chalk.red(`🛑 Manually stopping holder tracking for ${tokenMint}.`));
        trackingProcesses.set(tokenMint, false); // Mark as stopped
        trackingProcesses.delete(tokenMint); // Remove tracking completely
    }
}
