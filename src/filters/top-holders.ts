import { Connection, PublicKey } from '@solana/web3.js';
import { MintLayout } from '@solana/spl-token';
import { Filter, FilterResult } from './pool-filters'; // Import the Filter and FilterResult interfaces
import chalk from 'chalk';


const RAYDIUM_AUTHORITY = new PublicKey('5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1');

export class TopHolderFilter implements Filter {
  constructor(
    private readonly connection: Connection,
    private readonly thresholdPercentage: number
  ) {}

  // Initial one-time check to see if the top 10 holders hold less than the minimum threshold
  async initialCheck(poolKeys: { baseMint: PublicKey }, minimumThresholdPercentage: number): Promise<FilterResult> {
    try {
      const top10CombinedPercentage = await this.getTop10CombinedPercentage(poolKeys);
      console.log(`Top 10 holders hold ${top10CombinedPercentage.toFixed(2)}% of the total supply.`);
      if (top10CombinedPercentage < minimumThresholdPercentage) {
        console.log(chalk.yellow(`Top 10 holders hold ${top10CombinedPercentage}% of the total supply.`));
        return {
          ok: false,
          message: `Top 10 holders (excluding Raydium-owned accounts) hold less than ${minimumThresholdPercentage}% of the total supply. Token not worth monitoring.`,
        };
      }

      return { ok: true, message: 'Initial top holder check passed.' };
    } catch (error) {
      console.error('Error during initial top holder check:', error);
      return { ok: false, message: 'Error during initial top holder check.' };
    }
  }

  // Regular monitoring of the top 10 holders
  async execute(poolKeys: { baseMint: PublicKey }): Promise<FilterResult> {
    try {
      const top10CombinedPercentage = await this.getTop10CombinedPercentage(poolKeys);
      console.log(chalk.yellow(`Top 10 holders hold ${top10CombinedPercentage.toFixed(2)}% of the total supply.`));  
      if (top10CombinedPercentage > this.thresholdPercentage) {
        return {
          ok: false,
          message: `Top 10 holders (excluding Raydium-owned accounts) have more than ${this.thresholdPercentage}% of the total supply.`,
        };
      }

      return {
        ok: true,
        message: `Top 10 holders (excluding Raydium-owned accounts) have less than or equal to ${this.thresholdPercentage}% of the total supply.`,
      };
    } catch (error) {
      console.error('Error checking top 10 holders:', error);
      return { ok: false, message: 'Error checking top 10 holders.' };
    }
  }

  // Helper method to calculate the combined percentage of the top 10 holders
  private async getTop10CombinedPercentage(poolKeys: { baseMint: PublicKey }): Promise<number> {
    // Fetch the largest token holders (top 20)
    const largestAccounts = await this.connection.getTokenLargestAccounts(poolKeys.baseMint);
    if (largestAccounts.value.length === 0) {
      throw new Error('No token holders found.');
    }

    // Fetch the total supply of the token
    const mintAccountInfo = await this.connection.getAccountInfo(poolKeys.baseMint);
    if (!mintAccountInfo) {
      throw new Error('Mint account not found.');
    }

    // Decode the mint account to get the total supply
    const mintData = MintLayout.decode(mintAccountInfo.data);
    const totalSupply = BigInt(mintData.supply.toString()); // Ensure totalSupply is a BigInt

    // Array to store filtered top holders
    const top10Holders: { address: PublicKey; amount: string }[] = [];

    // Flag to track if the Raydium authority account has been found and excluded
    let raydiumAccountExcluded = false;

    // Loop through the top 20 holders
    for (const account of largestAccounts.value) {
      // If the Raydium authority account has already been excluded, skip owner checks
      if (!raydiumAccountExcluded) {
        // Fetch the parsed account info
        const accountInfo = await this.connection.getParsedAccountInfo(account.address);
        if (!accountInfo.value || !('parsed' in accountInfo.value.data)) {
          console.warn(`Account info not found for address: ${account.address.toString()}`);
          continue;
        }

        // Check if the owner is the Raydium authority
        const owner = new PublicKey(accountInfo.value.data.parsed.info.owner);
        if (owner.equals(RAYDIUM_AUTHORITY)) {
          console.log(`Excluding Raydium-owned account: ${account.address.toString()}`);
          raydiumAccountExcluded = true; // Mark as excluded
          continue; // Skip this account
        }
      }

      // Add the account to the top holders list
      top10Holders.push({
        address: account.address,
        amount: account.amount,
      });

      // Stop once we have 10 holders
      if (top10Holders.length >= 10) {
        break;
      }
    }

    // Calculate the combined balance of the top 10 holders (excluding Raydium-owned accounts)
    const top10CombinedBalance = top10Holders.reduce(
      (sum, account) => sum + BigInt(account.amount),
      BigInt(0)
    );

    // Calculate the combined percentage held by the top 10 holders
    return (Number(top10CombinedBalance) / Number(totalSupply)) * 100;
  }
}