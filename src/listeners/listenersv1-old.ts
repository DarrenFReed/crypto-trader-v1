import { Connection, PublicKey } from '@solana/web3.js';
import chalk from 'chalk';
import { EventEmitter } from 'events';
import { fetchMarketData } from '../helpers/fetch-market-data';
import { fetchPoolData } from '../helpers/fetch-pool-data';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

export const tokenEmitter = new EventEmitter();

const RAYDIUM_OWNER = '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1';

export class ListenerV1 {
  private subscriptions: number[] = [];

  constructor(private readonly connection: Connection) {}

  public async start(config: { walletPublicKey: PublicKey; autoSell: boolean; cacheNewMarkets: boolean }) {
    console.log(chalk.green(`🎧 Monitoring new Solana tokens...`));

    // ✅ Start monitoring new tokens
    const tokenSubscription = await this.monitorNewTokens(config);
    this.subscriptions.push(tokenSubscription);

    if (config.autoSell) {
      // ✅ Track wallet changes for auto-sell
      const walletSubscription = await this.subscribeToWalletChanges(config);
      this.subscriptions.push(walletSubscription);
    }

  }

  private async monitorNewTokens(config: { walletPublicKey: PublicKey }) {
    return this.connection.onLogs(
      new PublicKey('7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5'),
      async ({ logs, err, signature }) => {
        if (err) {
          console.error(`⚠️ Connection error: ${err}`);
          return;
        }

        console.log(chalk.bgGreen(`✅ Found new token signature: ${signature}`));

        try {
          const parsedTransaction = await this.connection.getParsedTransaction(signature, {
            maxSupportedTransactionVersion: 0,
            commitment: 'confirmed',
          });

          if (!parsedTransaction || !parsedTransaction.meta || parsedTransaction.meta.err !== null) {
            console.error(`❌ Transaction parsing failed.`);
            return;
          }

          console.log(`✅ Successfully parsed transaction`);

          const signer = parsedTransaction.transaction.message.accountKeys[0].pubkey.toString();
          console.log(`👤 Creator: ${signer}`);

          const postTokenBalances = parsedTransaction.meta.postTokenBalances;

          // Extract Base Token Info
          const baseInfo = postTokenBalances?.find((balance) => balance.owner === RAYDIUM_OWNER);

          if (!baseInfo) return;

          const baseAddress = baseInfo.mint;

          if (!baseAddress.endsWith('pump')) {
            console.log(`❌ Ignoring non-Pump.fun token: ${baseAddress}`);
            return;
          }

          const baseDecimals = baseInfo.uiTokenAmount.decimals;
          const baseLpAmount = baseInfo.uiTokenAmount.uiAmount ?? 0;

          console.log(`🏆 Base Address: ${baseAddress}, LP Amount: ${baseLpAmount}`);

          // **Extract Market Address from Account Keys**
          const marketAddress = parsedTransaction.transaction.message.accountKeys
            .find((key) => key.pubkey.toString() !== baseAddress)
            ?.pubkey.toString();

          if (!marketAddress) {
            console.log(`❌ No market address found in transaction.`);
            return;
          }

          console.log(`📊 Market Address: ${marketAddress}`);

          // **Extract Pool Address from Account Keys**
          const poolAddress = parsedTransaction.transaction.message.accountKeys
            .find((key) => key.pubkey.toString() !== baseAddress && key.pubkey.toString() !== marketAddress)
            ?.pubkey.toString();

          if (!poolAddress) {
            console.log(`❌ No pool address found in transaction.`);
            return;
          }

          console.log(`🌊 Pool Address: ${poolAddress}`);

          const marketState = await fetchMarketData(this.connection, marketAddress);
          const poolState = await fetchPoolData(this.connection, poolAddress);

          if (!marketState || !poolState) {
            console.log(`❌ Market or Pool data missing for ${baseAddress}`);
            return;
          }
          

          tokenEmitter.emit('market', {
            accountId: new PublicKey(baseAddress),
            accountInfo: { data: marketState },
          });

          // ✅ Emit Pool Event
          tokenEmitter.emit('pool', {
            accountId: new PublicKey(baseAddress),
            accountInfo: { data: poolState },
          });
          console.log(chalk.blue(`🚀 Emitted event for token: ${baseAddress}`));
        } catch (error) {
          console.error(`❌ Error processing transaction: ${error}`);
        }
      },
      'confirmed',
    );
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



// Start monitoring
//monitorNewTokens(solanaConnection);
