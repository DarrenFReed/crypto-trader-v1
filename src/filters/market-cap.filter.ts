import { Connection } from '@solana/web3.js';
import { Liquidity, LiquidityPoolKeysV4, Percent, Token, TokenAmount } from '@raydium-io/raydium-sdk';
import { Filter, FilterResult } from './pool-filters';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { stopMonitoring } from '../helpers/monitoring-manager';


export class MarketCapFilter {
  constructor(
    private readonly connection: Connection,
    private readonly minMarketCap?: number,
    private readonly maxMarketCap?: number,
  ) {}

  public async execute(poolKeys: LiquidityPoolKeysV4): Promise<FilterResult> {
    // Fetch total supply
    const baseTotalSupply = (await this.connection.getTokenSupply(poolKeys.baseMint)).value.uiAmount;
    if (!baseTotalSupply) {
      return { ok: false, message: `Failed to fetch total supply for ${poolKeys.baseMint}` };
    }

    // Fetch token price
    const baseTokenPrice = await this.getTokenPrice(poolKeys);
    if (!baseTokenPrice) {
      return { ok: false, message: `Failed to fetch price for base token ${poolKeys.baseMint}` };
    }

    // Calculate market cap
    const marketCap = baseTotalSupply * baseTokenPrice * 211;
    if (this.minMarketCap && marketCap < this.minMarketCap) {
      return { ok: false, message: `Market cap ${marketCap} below minimum: ${this.minMarketCap}` };
    }

    if (this.maxMarketCap && marketCap > this.maxMarketCap) {
      return { ok: false, message: `Market cap ${marketCap} above maximum: ${this.maxMarketCap}` };
    }

    return { ok: true };
  }


  public async getTokenPrice(poolKeys: LiquidityPoolKeysV4): Promise<number | null> {
    try {
      const baseVaultInfo = await this.connection.getTokenAccountBalance(poolKeys.baseVault);
      const quoteVaultInfo = await this.connection.getTokenAccountBalance(poolKeys.quoteVault);
  
      const baseReserve = parseFloat(baseVaultInfo.value.uiAmountString || '0');
      const quoteReserve = parseFloat(quoteVaultInfo.value.uiAmountString || '0');
  
      if (baseReserve === 0 || quoteReserve === 0) {
        throw new Error('Invalid pool reserves');
      }
  
      const price = (quoteReserve / baseReserve);
      console.log(`Manual Price: ${price}`);
      return price;
    } catch (error) {
      console.error('Failed to manually calculate token price:', error);
      return null;
    }
  }

    
}
  
