import { Connection, PublicKey } from '@solana/web3.js';
import { EventEmitter } from 'events';
import dotenv from 'dotenv';

dotenv.config(); // Load environment variables

export class Listeners extends EventEmitter {
  private subscriptions: number[] = [];

  constructor(private readonly connection: Connection) {
    super();
  }

  public async start(config: { walletP: PublicKey; }): Promise<void> {
    // Real-time listener logic remains here
  }

  /**
   * Fetch tokens created in the past time frame.
   * @param lookbackHours Number of hours to look back (default to env TOKEN_LOOKBACK_HOURS).
   */
  public async fetchHistoricalTokens(lookbackHours?: number): Promise<PublicKey[]> {
    const hours = lookbackHours || parseFloat(process.env.TOKEN_LOOKBACK_HOURS || '2');
    const now = new Date();
    const fromTimestamp = new Date(now.getTime() - hours * 60 * 60 * 1000);

    console.log(`Fetching tokens created since ${fromTimestamp.toISOString()}`);

    // Query recent transactions within the timeframe
    const confirmedSignatures = await this.connection.getSignaturesForAddress(
      new PublicKey(process.env.MONITORED_PROGRAM_ID),
      {
        limit: 1000,
        until: fromTimestamp.toISOString(),
      },
    );

    const tokenAccounts: PublicKey[] = [];

    for (const signatureInfo of confirmedSignatures) {
      const transaction = await this.connection.getTransaction(signatureInfo.signature);
      if (transaction) {
        // Parse transaction to identify token creation
        transaction.transaction.message.instructions.forEach((instruction) => {
          if (instruction.programId.equals(new PublicKey(process.env.TOKEN_PROGRAM_ID))) {
            // Add logic to extract token accounts
            const createdTokenAccount = new PublicKey(instruction.keys[0].pubkey);
            tokenAccounts.push(createdTokenAccount);
          }
        });
      }
    }

    console.log(`Found ${tokenAccounts.length} tokens created in the past ${hours} hours.`);
    return tokenAccounts;
  }
}
