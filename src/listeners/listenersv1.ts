import { tokenEmitter as newTokens } from './new-tokens'; // Import the old listener
import { fetchMarketData } from '../helpers/fetch-market-data';
import { fetchPoolData } from '../helpers/fetch-pool-data';
import { Connection, PublicKey } from '@solana/web3.js';
import chalk from 'chalk';
import { EventEmitter } from 'events';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { FetchDexData } from '../helpers/dexData';


export const tokenEmitter = new EventEmitter();

export class ListenerV1 {
  private subscriptions: number[] = [];

  constructor(private readonly connection: Connection) {}

  public async start(config: { walletPublicKey: PublicKey; autoSell: boolean }) {
    console.log(chalk.green(`🎧 Using Old Listener to Monitor New Solana Tokens...`));

    // ✅ Listen for new token events from the old listener
    newTokens.on('newToken', async (newTokenData) => {
      const baseAddress = newTokenData.baseInfo.baseAddress;
      const marketId = newTokenData.marketId; // Extract Market ID
      const lpMint = newTokenData.lpMint;
      const quoteAddress = newTokenData.quoteInfo.quoteAddress;

    console.log(`🏆 Detected New Token from Old Listener: ${baseAddress}`);

  

      // ✅ Emit market and pool events for the bot
/*       tokenEmitter.emit('market', {
        accountId: new PublicKey(baseAddress),
        accountInfo: { data: marketState },
      }); */

   //   tokenEmitter.emit('pool', {
   //     accountId: new PublicKey(baseAddress),
   ///     accountInfo: { data: poolState },
   //   });

   //   console.log(chalk.blue(`🚀 Emitted Market & Pool Data for ${baseAddress}`));
    });

    if (config.autoSell) {
      // ✅ Track wallet changes for auto-sell
      const walletSubscription = await this.subscribeToWalletChanges(config);
      this.subscriptions.push(walletSubscription);
    }
  }

  private async subscribeToWalletChanges(config: { walletPublicKey: PublicKey }) {
    return this.connection.onProgramAccountChange(
      TOKEN_PROGRAM_ID,
      async (updatedAccountInfo) => {
        tokenEmitter.emit('wallet', updatedAccountInfo);
      },
      this.connection.commitment,
      [
        {
          dataSize: 165,
        },
        {
          memcmp: {
            offset: 32,
            bytes: config.walletPublicKey.toBase58(),
          },
        },
      ],
    );
  }

  public async stop() {
    for (let i = this.subscriptions.length - 1; i >= 0; i--) {
      const subscription = this.subscriptions[i];
      await this.connection.removeAccountChangeListener(subscription);
      this.subscriptions.splice(i, 1);
    }
    console.log("🛑 Stopped all listeners.");
  }
}
