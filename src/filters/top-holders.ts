import { Connection, PublicKey } from '@solana/web3.js';
import { MintLayout } from '@solana/spl-token';
import { Filter, FilterResult } from './pool-filters'; // Import the Filter and FilterResult interfaces
import { stopMonitoring } from '../helpers/monitoring-manager';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const RAYDIUM_AUTHORITY = new PublicKey('5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1');

export class TopHolderFilter implements Filter {
  constructor(
    private readonly connection: Connection,
    private readonly thresholdPercentage: number,
  ) {}

  async execute(poolKeys: { baseMint: PublicKey }): Promise<FilterResult> {
    try {
      // Fetch the largest token holders (top 20)
      const largestAccounts = await this.connection.getTokenLargestAccounts(poolKeys.baseMint);
      if (largestAccounts.value.length === 0) {
        return { ok: false, message: 'No token holders found.' };
      }

      // Fetch the total supply of the token
      const mintAccountInfo = await this.connection.getAccountInfo(poolKeys.baseMint);
      if (!mintAccountInfo) {
        return { ok: false, message: 'Mint account not found.' };
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
      const top10CombinedBalance = top10Holders.reduce((sum, account) => sum + BigInt(account.amount), BigInt(0));

      // Calculate the combined percentage held by the top 10 holders
      const top10CombinedPercentage = (Number(top10CombinedBalance) / Number(totalSupply)) * 100;

      console.log(`Top 10 Combined Balance (excluding Raydium-owned accounts): ${top10CombinedBalance}`);
      console.log(`Total Supply: ${totalSupply}`);
      console.log(`Top 10 Combined Percentage: ${top10CombinedPercentage.toFixed(2)}%`);

      // Check if the combined percentage exceeds the threshold
      if (top10CombinedPercentage > this.thresholdPercentage) {
        return {
          ok: false,
          message: `Top 10 holders (excluding Raydium-owned accounts) have more than ${this.thresholdPercentage}% of the total supply.`,
        };
      } else if (top10CombinedPercentage < 5) {
        await prisma.token.update({
          where: { baseAddress: poolKeys.baseMint.toString() },
          data: { tokenStatus: 'FAILED' },
        });
        return {
            ok: false,
            message: `Top 10 holders (excluding Raydium-owned accounts) have less than 5 % of the total supply.`,
          };
        await stopMonitoring(this.connection, poolKeys.baseMint.toString());
      } else {
        return {
          ok: true,
          message: `Top 10 holders (excluding Raydium-owned accounts) have less than or equal to ${this.thresholdPercentage}% of the total supply.`,
        };
      }
    } catch (error) {
      console.error('Error checking top 10 holders:', error);
      return { ok: false, message: 'Error checking top 10 holders.' };
    }
  }
}
