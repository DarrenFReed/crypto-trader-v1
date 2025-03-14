import { Filter, FilterResult } from './pool-filters';
import { Connection, PublicKey } from '@solana/web3.js';
import { LiquidityPoolKeysV4 } from '@raydium-io/raydium-sdk';
import { logger } from '../helpers';

export class BurnFilter implements Filter {
  constructor(private readonly connection: Connection) {}

  async execute(poolKeys: LiquidityPoolKeysV4): Promise<FilterResult> {
    try {
      // Check if LP tokens are burned
      const amount = await this.connection.getTokenSupply(poolKeys.lpMint, this.connection.commitment);
      const burned = amount.value.uiAmount === 0;

      if (burned) {
        return { ok: true, message: 'LP tokens are burned.' };
      }

      // Check if LP tokens are locked
      const isLocked = await this.isLiquidityLocked(poolKeys.lpMint);
      if (isLocked) {
        return { ok: true, message: 'LP tokens are locked.' };
      }

      return { ok: false, message: "LP tokens are not burned or locked." };
    } catch (e: any) {
      if (e.code == -32602) {
        return { ok: true };
      }

      logger.error({ mint: poolKeys.baseMint }, `Failed to check if LP is burned or locked`);
    }

    return { ok: false, message: 'Failed to check if LP is burned or locked' };
  }

  // Function to check if liquidity is locked
  private async isLiquidityLocked(lpMint: PublicKey): Promise<boolean> {
    try {
      // Fetch the largest LP token holders
      const largestAccounts = await this.connection.getTokenLargestAccounts(lpMint);

      // Iterate through the largest holders
      for (const account of largestAccounts.value) {
        const address = account.address;
        const amount = account.amount;

        // Check if the holder is a contract or secure wallet
        const accountInfo = await this.connection.getAccountInfo(address);
        if (accountInfo && accountInfo.executable) {
          console.log(`LP tokens are locked in a contract: ${address.toBase58()}`);
          return true;
        }
      }

      console.log('LP tokens are not locked.');
      return false;
    } catch (error) {
      console.error('Error checking if liquidity is locked:', error);
      return false;
    }
  }
}