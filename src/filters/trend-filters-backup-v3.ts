import { PrismaClient } from '@prisma/client';
import chalk from 'chalk';
import * as ss from 'simple-statistics';

const prisma = new PrismaClient();

// Configurable trend analysis settings
//const TREND_LOOKBACK = 5; // Number of historical records to analyze
const MIN_BUY_PARTICIPATION = 0.4; // 🚨 Require at least 40% buy transactions
const SELL_RATIO_PENALTY_THRESHOLD = 1.5; // 🚨 Penalize if sells exceed buys by 50%
const MIN_TRANSACTIONS = 3; // Minimum transactions required for trend detection
const MIN_SELL_PARTICIPATION = 0.25;


export class TrendFilters {
    /**
     * Runs trend analysis for ALL tokens in the database.
     * This is called on system restart.
     */
    static async evaluateTokens() {
        console.log(`🔍 Running batch trend evaluation for all tokens...`);

        const tokens = await prisma.token.findMany();

        for (const token of tokens) {
            await this.evaluateToken(token.baseAddress);
        }

        console.log(`✅ Trend evaluation complete.`);
    }

    /**
     * Runs trend analysis for a specific token (called after new transactions).
     */
    static async evaluateToken(tokenMint: string) {
        console.log(`🔍 Running trend evaluation for ${tokenMint}...`);

        const metrics = await prisma.tokenMetrics.findMany({
            where: { tokenBaseAddress: tokenMint },
            orderBy: { createdAt: 'asc' },
        });

        if (!metrics.length || metrics.length < MIN_TRANSACTIONS) {
            console.log(`⚠️ Not enough historical data for ${tokenMint}, skipping trend analysis.`);
            return false;
        }

        const holderRecords = await prisma.tokenHolders.findMany({
            where: { tokenBaseAddress: tokenMint },
            orderBy: { createdAt: 'asc' },
        });

        const holdersCounts = holderRecords.length ? holderRecords.map((h) => h.holdersCount) : [];

        // Perform trend calculations
        const buySellTxRatios = metrics.map((m) => m.buySellTxRatio);
        const buySellVolumeRatios = metrics.map((m) => m.buySellVolumeRatio);
        const liquidityValues = metrics.map((m) => m.liquidity);
        const buyCounts = metrics.map((m) => m.buyCount);
        const sellCounts = metrics.map((m) => m.sellCount);

        //Calculate Sell Participation Ratio
        const totalBuys = metrics.reduce((sum, m) => sum + m.buyCount, 0);
        const totalSells = metrics.reduce((sum, m) => sum + m.sellCount, 0);
        const sellParticipationRatio = totalSells > 0 ? totalSells / totalBuys : 0;
        

        // 🚀 **New: Calculate trend slopes using linear regression**
        const slopeBuySellTxRatio = this.calculateSlope(buySellTxRatios);
        const slopeBuySellVolume = this.calculateSlope(buySellVolumeRatios);
        const slopeLiquidity = this.calculateSlope(liquidityValues);
        const slopeHolders = this.calculateSlope(holdersCounts);

        // 🚀 **Determine if the trend is increasing**
        const isBuySellTxRatioIncreasing = slopeBuySellTxRatio > 0;
        const isBuySellVolumeIncreasing = slopeBuySellVolume > 0;
        const isLiquidityIncreasing = slopeLiquidity > 0;
        const isHoldersIncreasing = slopeHolders > 0;
        const isTrendingUp = isBuySellTxRatioIncreasing && isBuySellVolumeIncreasing  && isHoldersIncreasing;  //&& isLiquidityIncreasing;


        console.log(`📊 Slope Buy Sell Tx: ${slopeBuySellTxRatio}`);
        console.log(`📊 Slope Buy Sell Volume: ${slopeBuySellVolume}`);
        console.log(`📊 Slope Liquidity: ${slopeLiquidity}`);
        console.log(`📊 Holders Increasing: ${isHoldersIncreasing}`);
        console.log(`📊 Last Buy Sell TX Ration: ${buySellTxRatios[buySellTxRatios.length - 1]}`);
        console.log(`📊 Last Buy Sell Volume Ratio: ${buySellVolumeRatios[buySellVolumeRatios.length - 1]}`);
        console.log(`📊 Last Liquidity: ${liquidityValues[liquidityValues.length - 1]}`);
        console.log(`📊 Last Holders: ${holdersCounts[holdersCounts.length - 1]}`);
        
        // 🚀 NEW: Adjust Buy Interest with Sell Penalty
        const hasStrongBuyInterest = buySellTxRatios[buySellTxRatios.length - 1] > 1.5 &&
                                     buySellVolumeRatios[buySellVolumeRatios.length - 1] > 1.5 &&
                                     //liquidityValues[liquidityValues.length - 1] > 10000 &&
                                     holdersCounts[holdersCounts.length - 1] > 100 &&
                                     isTrendingUp;

        if (hasStrongBuyInterest) {
            console.log(`🚀 ${tokenMint} is trending up! Marking as BUY_CANDIDATE.`);
            await prisma.token.update({
                where: { baseAddress: tokenMint },
                data: { tokenStatus: 'BUY_CANDIDATE' },
            });
            return true;
        } else {
            console.log(`⏳ ${tokenMint} is not trending up.`);
        }      
    }

    private static calculateSlope(data: number[]): number {
        if (data.length < 2) return 0; // Not enough data points

        const xValues = [...Array(data.length).keys()]; // Generate X values [0, 1, 2, ...]
        const pairedData = xValues.map((x, i) => [x, data[i]]); // Manually create paired data

        const regression = ss.linearRegression(pairedData);
        
        return regression.m; // Return slope (m)
    }
}