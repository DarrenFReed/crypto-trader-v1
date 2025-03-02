import { Connection, PublicKey } from '@solana/web3.js';
import chalk from 'chalk';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

/**
 * Fetches unique wallet count (holders) for a given token.
 */
async function fetchHolderCount(connection: Connection, tokenMint: string): Promise<number> {
    try {
        console.log(chalk.green(`🔍 Fetching holders for token: ${tokenMint}...`));

        const accounts = await connection.getProgramAccounts(TOKEN_PROGRAM_ID, {
            filters: [
                { dataSize: 165 }, // SPL Token account size
                { memcmp: { offset: 0, bytes: tokenMint } } // Match token mint
            ]
        });

        const uniqueWallets = new Set<string>();

        for (const account of accounts) {
            const ownerAddress = account.account.owner.toString();
            uniqueWallets.add(ownerAddress);
        }

        console.log(chalk.blue(`📊 Token: ${tokenMint} | Unique Holders: ${uniqueWallets.size}`));

        return uniqueWallets.size;
    } catch (error) {
        console.error(`❌ Error fetching holder count:`, error);
        return 0;
    }
}

// Export the function so other modules can use it
export { fetchHolderCount };
