import { PrismaClient } from '@prisma/client';
import chalk from 'chalk';
import * as ss from 'simple-statistics';

const prisma = new PrismaClient();

// Configurable trend analysis settings
const TREND_WINDOW_MINUTES = 3; // Analyze transactions from the last 5 minutes
const MIN_BUY_PARTICIPATION = 0.4; // Require at least 40% buy transactions
const SELL_RATIO_PENALTY_THRESHOLD = 1.5; // Penalize if sells exceed buys by 50%
const MIN_TRANSACTIONS = 10; // Minimum transactions required for trend detection
const MIN_SELL_PARTICIPATION = 0.02;

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

    // Fetch transactions from the last TREND_WINDOW_MINUTES
    const now = new Date();
    const startTime = new Date(now.getTime() - TREND_WINDOW_MINUTES * 60000);

    const transactions = await prisma.transaction.findMany({
      where: {
        tokenBaseAddress: tokenMint,
        timestamp: { gte: startTime },
      },
      orderBy: { timestamp: 'asc' },
    });

    if (transactions.length < MIN_TRANSACTIONS) {
      console.log(`⚠️ Not enough transactions for ${tokenMint}, skipping trend analysis.`);
      return false;
    }

    // Calculate metrics from raw transactions
    const buyCount = transactions.filter((tx) => tx.type === 'BUY').length;
    const sellCount = transactions.filter((tx) => tx.type === 'SELL').length;
    const buyVolume = transactions.filter((tx) => tx.type === 'BUY').reduce((sum, tx) => sum + tx.amount, 0);
    const sellVolume = transactions.filter((tx) => tx.type === 'SELL').reduce((sum, tx) => sum + tx.amount, 0);
    const totalVolume = buyVolume + sellVolume;

    // Buy/Sell Transaction Ratio
    //const buySellTxRatio = sellCount > 0 ? buyCount / sellCount : buyCount; // Avoid division by zero
    // Ratio
    //const buySellTxRatio =
    //  (buyCount * (buyVolume / (buyVolume + sellVolume))) / (sellCount * (sellVolume / (buyVolume + sellVolume)));
   
    const buySellTxRatio = sellCount > 0 
    ? (buyCount * (buyVolume / totalVolume)) / 
      (sellCount * (sellVolume / totalVolume)) 
    : buyCount; 
   
      //Slope
    const slopeBuySellTxRatio = this.calculateSlope(
      transactions.map((tx) => (tx.type === 'BUY' ? tx.amount / totalVolume : -(tx.amount / totalVolume))),
    );

    //Buy Sell Volume Ratio and Slope
    //const buySellVolumeRatio = totalVolume > 0 ? buyVolume / totalVolume / (sellVolume / totalVolume) : 1;
    const buySellVolumeRatio = sellVolume > 0 
    ? (buyVolume / totalVolume) / (sellVolume / totalVolume) 
    : buyVolume > 0 ? 1 : 0; 
    
    
    // ✅ Buy/Sell Volume Slope (Now Normalized)
    const slopeBuySellVolume = this.calculateSlope(
      transactions.map((tx) => {
        const weight = Math.abs(tx.amount) / totalVolume; // Normalize by total volume
        return tx.type === 'BUY' ? weight : -weight;
      }),
    );

    // Holder Counts
    const holderRecords = await prisma.tokenHolders.findMany({
      where: { tokenBaseAddress: tokenMint },
      orderBy: { createdAt: 'asc' },
    });

    const holdersCounts = holderRecords.length ? holderRecords.map((h) => h.holdersCount) : [];
    //const slopeHolders = this.calculateSlope(holdersCounts);
    const slopeHolders = this.calculateSlope(holdersCounts);
    // Sell participation ratio
    
    const totalTrades = buyCount + sellCount;
    const sellParticipationRatio = totalTrades > 0 ? sellCount / totalTrades : 0;
    
    
    //const sellParticipationRatio = sellCount > 0 ? sellCount / buyCount : 0;
    //const sellParticipationRatio = totalVolume > 0 ? sellVolume / totalVolume : 0;

    //const liquidityValues = transactions.map((tx) => tx.liquidity || 0); // Use liquidity from transactions if available

    // Determine if the trend is increasing
    const trendScore =
      (slopeBuySellTxRatio > 0 ? 1 : 0) +
      (slopeBuySellVolume > 0 ? 2 : 0) + // Volume Slope is weighted higher
      (slopeHolders > 0 ? 1 : 0);

    const isTrendingUp = trendScore >= 3; // Require at least 3 points

    console.log(`📊 Slope Buy/Sell Tx: ${slopeBuySellTxRatio}`);
    console.log(`📊 Slope Buy/Sell Volume: ${slopeBuySellVolume}`);
    console.log(`📊 Slope Holders: ${slopeHolders}`);
    console.log(`📊 Buy/Sell TX Ratio: ${buySellTxRatio}`);
    console.log(`📊 Buy/Sell Volume Ratio: ${buySellVolumeRatio}`);
    console.log(`📊 Sell Participation Ratio: ${sellParticipationRatio}`);
    console.log(`📊 Trend Score: ${trendScore}`);
    console.log(`📈 Trending Up: ${isTrendingUp}`);

    // ✅ Final Trend Decision (With Sell Participation Check)
    const hasStrongBuyInterest =
      //buySellTxRatio > 0 &&
      buySellVolumeRatio > 0 &&
      holdersCounts[holdersCounts.length - 1] > 50 &&
      isTrendingUp
      //sellParticipationRatio > MIN_SELL_PARTICIPATION; // Prevent Honeypots

    if (hasStrongBuyInterest) {
      console.log(`🚀 ${tokenMint} is trending up! Marking as BUY_CANDIDATE.`);
      await prisma.token.update({
        where: { baseAddress: tokenMint },
        data: { tokenStatus: 'BUY_CANDIDATE' },
      });
      return true;
    } else {
      console.log(`⏳ ${tokenMint} is not trending up.`);
      return false;
    }
  }

  private static calculateSlope(data: number[]): number {
    if (data.length < 2) return 0; // Not enough data points to calculate a slope
  
    // Skip smoothing if there are fewer than 5 data points
    const smoothedData = data.length < 5 ? data : data.map((_, i, arr) => {
      const windowSize = 2; // Adjust window size as needed
      const window = arr.slice(Math.max(0, i - windowSize), Math.min(i + windowSize + 1, arr.length));
      return window.reduce((sum, val) => sum + val, 0) / window.length;
    });
  
    // Calculate slope using linear regression
    const xValues = smoothedData.map((_, i) => i);
    const pairedData = xValues.map((x, i) => [x, smoothedData[i]]);
  
    const regression = ss.linearRegression(pairedData);
    return regression.m; // Return slope (m)
  }
}
