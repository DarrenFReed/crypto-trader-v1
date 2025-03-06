import { Connection, PublicKey } from '@solana/web3.js';
import { PrismaClient } from '@prisma/client';
import chalk from 'chalk';
import { fetchHolderCount } from './holderCount'; // Import the holders updater

const prisma = new PrismaClient();
const UPDATE_INTERVAL = 10_000; // Update every 10 seconds

/**
 * Fetches aggregated buy/sell count and volume for a given token.
 */
async function fetchTradeMetrics(tokenMint: string) {
    const buyCount = await prisma.trade.count({ where: { tokenBaseAddress: tokenMint, tradeStatus: 'SUCCESS', amount: { gt: 0 } } });
    const sellCount = await prisma.trade.count({ where: { tokenBaseAddress: tokenMint, tradeStatus: 'SUCCESS', amount: { lt: 0 } } });

    const buyVolume = await prisma.trade.aggregate({ where: { tokenBaseAddress: tokenMint, amount: { gt: 0 } }, _sum: { amount: true } });
    const sellVolume = await prisma.trade.aggregate({ where: { tokenBaseAddress: tokenMint, amount: { lt: 0 } }, _sum: { amount: true } });

    return {
        buyCount,
        sellCount,
        buyVolume: buyVolume._sum.amount || 0,
        sellVolume: sellVolume._sum.amount || 0,
    };
}

/**
 * Computes Buy/Sell Ratios.
 */
function calculateRatios(buyCount: number, sellCount: number, buyVolume: number, sellVolume: number) {
    const buySellTxRatio = sellCount === 0 ? buyCount : buyCount / sellCount;
    const buySellVolumeRatio = sellVolume === 0 ? buyVolume : buyVolume / sellVolume;

    return { buySellTxRatio, buySellVolumeRatio };
}

/**
 * Updates the token metrics in a single timestamped entry.
 */
async function updateTokenMetrics(connection: Connection, tokenMint: string) {
    try {
        console.log(chalk.yellow(`📊 Updating metrics for token: ${tokenMint}...`));

        // Pass `connection` to fetchHolderCount
        const holdersCount = await fetchHolderCount(connection, tokenMint);
        const { buyCount, sellCount, buyVolume, sellVolume } = await fetchTradeMetrics(tokenMint);
        const { buySellTxRatio, buySellVolumeRatio } = calculateRatios(buyCount, sellCount, buyVolume, sellVolume);

        await prisma.tokenMetrics.upsert({
            where: { tokenBaseAddress: tokenMint },
            update: {
                buyCount: buyCount,
                sellCount: sellCount,
                buyVolume: buyVolume,
                sellVolume: sellVolume,
                buySellTxRatio: buySellTxRatio,
                buySellVolumeRatio: buySellVolumeRatio,
                createdAt: new Date(), // Ensures single timestamp per update
            },
            create: {
                tokenBaseAddress: tokenMint,
                buyCount: buyCount,
                sellCount: sellCount,
                buyVolume: buyVolume,
                sellVolume: sellVolume,
                buySellTxRatio: buySellTxRatio,
                buySellVolumeRatio: buySellVolumeRatio,
                createdAt: new Date(),
            },
        });

        console.log(chalk.green(`✅ Updated token metrics for ${tokenMint}`));
    } catch (error) {
        console.error(`❌ Error updating token metrics:`, error);
    }
}

/**
 * Runs the trend update process for all tracked tokens.
 */
async function runTrendUpdater(connection: Connection) {
    const tokens = await prisma.token.findMany();

    for (const token of tokens) {
        await updateTokenMetrics(connection, token.baseAddress);
    }
}

// Export the trend updater function
export { runTrendUpdater };
