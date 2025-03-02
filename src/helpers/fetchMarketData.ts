import { Connection, PublicKey } from '@solana/web3.js';
import { MARKET_STATE_LAYOUT_V3 } from '@raydium-io/raydium-sdk';

export async function fetchMarketData(connection: Connection, marketId: string) {
    try {
        console.log(`🔍 Fetching Market Data for Market ID: ${marketId}`);

        const marketAccountInfo = await connection.getAccountInfo(new PublicKey(marketId));

        if (!marketAccountInfo) {
            console.log(`❌ No market data available for ${marketId}`);
            return null;
        }

        const marketData = MARKET_STATE_LAYOUT_V3.decode(marketAccountInfo.data);

        console.log(`✅ Market Data Retrieved for ${marketId}`);
        return { marketId, data: marketData };
    } catch (error) {
        console.error(`⚠️ Error fetching market data for ${marketId}:`, error);
        return null;
    }
}
