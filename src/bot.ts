import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  getAccount,
  getAssociatedTokenAddress,
  RawAccount,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Liquidity, LiquidityPoolKeysV4, LiquidityStateV4,LIQUIDITY_STATE_LAYOUT_V4, Percent, Token, TokenAmount,SplAccountLayout } from '@raydium-io/raydium-sdk';
import { MarketCache, PoolCache, SnipeListCache } from './cache';
import { PoolFilters } from './filters';
import { TransactionExecutor } from './transactions';
import { createPoolKeys, logger, NETWORK, sleep } from './helpers';
import { Mutex } from 'async-mutex';
import BN from 'bn.js';
import { WarpTransactionExecutor } from './transactions/warp-transaction-executor';
import { JitoTransactionExecutor } from './transactions/jito-rpc-transaction-executor';
import { TrendFilters } from './filters/trend-filters';
//import { runTrendUpdater } from './trend/trend-updater';
import { SubscriptionManager } from './services/subscription-manager'; // Manages WebSocket subscriptions
import { PrismaClient } from '@prisma/client'; // Database ORM
import { MarketCapFilter } from './filters/market-cap.filter';
import { stopMonitoring } from './helpers/monitoring-manager';
import { MAINNET_PROGRAM_ID, MARKET_STATE_LAYOUT_V3 } from '@raydium-io/raydium-sdk';
import { fetchPoolData } from './helpers/fetchPoolData';
import { raySwapBuy, raySwapSell } from './trading/raySwap';
import { AccountType, splAccountLayout } from '@raydium-io/raydium-sdk-v2';

const prisma = new PrismaClient();


export interface BotConfig {
  wallet: Keypair;
  checkRenounced: boolean;
  checkFreezable: boolean;
  checkBurned: boolean;
  minPoolSize: TokenAmount;
  maxPoolSize: TokenAmount;
  minMarketCap?: number; // Add this
  maxMarketCap?: number; // Add this
  quoteToken: Token;
  quoteAmount: TokenAmount;
  quoteAta: PublicKey;
  oneTokenAtATime: boolean;
  useSnipeList: boolean;
  autoSell: boolean;
  useTGFeed: boolean; // Add this
  autoBuyDelay: number;
  autoSellDelay: number;
  maxBuyRetries: number;
  maxSellRetries: number;
  unitLimit: number;
  unitPrice: number;
  takeProfit: number;
  stopLoss: number;
  buySlippage: number;
  sellSlippage: number;
  priceCheckInterval: number;
  priceCheckDuration: number;
  filterCheckInterval: number;
  filterCheckDuration: number;
  consecutiveMatchCount: number;
}

export class Bot {
  private readonly poolFilters: PoolFilters;

  // snipe list
  private readonly snipeListCache?: SnipeListCache;

  // one token at the time
  private readonly mutex: Mutex;
  private sellExecutionCount = 0;
  public readonly isWarp: boolean = false;
  public readonly isJito: boolean = false;

  constructor(
    private readonly connection: Connection,
    private readonly marketStorage: MarketCache,
    private readonly poolStorage: PoolCache,
    private readonly txExecutor: TransactionExecutor,
    readonly config: BotConfig,
  ) {

    

    this.isWarp = txExecutor instanceof WarpTransactionExecutor;
    this.isJito = txExecutor instanceof JitoTransactionExecutor;

    this.mutex = new Mutex();
    this.poolFilters = new PoolFilters(connection, {
      quoteToken: this.config.quoteToken,
      minPoolSize: this.config.minPoolSize,
      maxPoolSize: this.config.maxPoolSize,
      minMarketCap: this.config.minMarketCap, // Add minMarketCap
      maxMarketCap: this.config.maxMarketCap, // Add maxMarketCap
    });

    if (this.config.useSnipeList) {
      this.snipeListCache = new SnipeListCache();
      this.snipeListCache.init();
    }

    //runTrendUpdater(this.connection).catch((err) => {
    //  logger.error(`⚠️ Failed to start trend-updater: ${err}`);
    //});

  }

  async validate() {
    try {
      await getAccount(this.connection, this.config.quoteAta, this.connection.commitment);
    } catch (error) {
      logger.error(
        `${this.config.quoteToken.symbol} token account not found in wallet: ${this.config.wallet.publicKey.toString()}`,
      );
      return false;
    }

    return true;
  }

  public async buy(accountId: PublicKey, poolState: LiquidityStateV4) {
    logger.trace({ mint: poolState.baseMint }, `Processing new pool...`);

    if (this.config.useSnipeList && !this.snipeListCache?.isInList(poolState.baseMint.toString())) {
      logger.debug({ mint: poolState.baseMint.toString() }, `Skipping buy because token is not in a snipe list`);
      return;
    }

    if (this.config.autoBuyDelay > 0) {
      logger.debug({ mint: poolState.baseMint }, `Waiting for ${this.config.autoBuyDelay} ms before buy`);
      await sleep(this.config.autoBuyDelay);
    }

    if (this.config.oneTokenAtATime) {
      if (this.mutex.isLocked() || this.sellExecutionCount > 0) {
        logger.debug(
          { mint: poolState.baseMint.toString() },
          `Skipping buy because one token at a time is turned on and token is already being processed`,
        );
        return;
      }

      await this.mutex.acquire();
    }

    try {
      const [market, mintAta] = await Promise.all([
        this.marketStorage.get(poolState.marketId.toString()),
        getAssociatedTokenAddress(poolState.baseMint, this.config.wallet.publicKey),
      ]);
      
     //filter match
      const poolKeys: LiquidityPoolKeysV4 = createPoolKeys(accountId, poolState, market);

      if (!this.config.useSnipeList || !this.config.useTGFeed) {
        const match = await this.filterMatch(poolKeys);

        if (!match) {
          logger.trace({ mint: poolKeys.baseMint.toString() }, `Skipping buy because pool doesn't match filters`);
          return;
        }
      }

//set this to newPollKeys for test
      for (let i = 0; i < this.config.maxBuyRetries; i++) {
        try {
          logger.info(
            { mint: poolState.baseMint.toString() },
            `Send buy transaction attempt: ${i + 1}/${this.config.maxBuyRetries}`,
          );
          const tokenOut = new Token(TOKEN_PROGRAM_ID, poolKeys.baseMint, poolKeys.baseDecimals);
          
//SWAP CALLED HERE
          //const lamports = Number(this.config.quoteAmount) * 1_000_000_000; // Multiply using bigint
          const lamports = 1000000
         
          const swapResult = await raySwapBuy(this.connection, poolKeys.quoteMint.toString(), poolKeys.baseMint.toString(), lamports);
          console.log("Transaction IDs:", swapResult);
          
          if (swapResult.confirmed) {
            await prisma.token.update({
              where: { baseAddress: poolState.baseMint.toString() },
              data: { tokenStatus: 'BOUGHT' },
            });
        
            break;
          }else {
            console.error("❌ Swap failed, skipping database update.");
          }

/*           logger.info(
            {
              mint: poolState.baseMint.toString(),
              signature: result.signature,
              error: result.error,
            },
            `Error confirming buy tx`,
          ); */
        } catch (error) {
          logger.debug({ mint: poolState.baseMint.toString(), error }, `Error confirming buy transaction`);
        }
      }
    } catch (error) {
      logger.error({ mint: poolState.baseMint.toString(), error }, `Failed to buy token`);
    } finally {
      if (this.config.oneTokenAtATime) {
        this.mutex.release();
      }
    }
  }


  //RawAccount is comming from the wallet
  public async sell(accountId: PublicKey, rawAccount: RawAccount) {
    if (this.config.oneTokenAtATime) {
      this.sellExecutionCount++;
    }

    try {
      logger.trace({ mint: rawAccount.mint }, `Processing new token...`);

      const poolData = await this.poolStorage.get(rawAccount.mint.toString());

      if (!poolData) {
        logger.trace({ mint: rawAccount.mint.toString() }, `Token pool data is not found, can't sell`);
        return;
      }

      const tokenIn = new Token(TOKEN_PROGRAM_ID, poolData.state.baseMint, poolData.state.baseDecimal.toNumber());
      const tokenAmountIn = new TokenAmount(tokenIn, rawAccount.amount, true);

      if (tokenAmountIn.isZero()) {
        logger.info({ mint: rawAccount.mint.toString() }, `Empty balance, can't sell`);
        return;
      }

      if (this.config.autoSellDelay > 0) {
        logger.debug({ mint: rawAccount.mint }, `Waiting for ${this.config.autoSellDelay} ms before sell`);
        await sleep(this.config.autoSellDelay);
      }

      const market = await this.marketStorage.get(poolData.state.marketId.toString());

      const poolKeys: LiquidityPoolKeysV4 = createPoolKeys(new PublicKey(poolData.id), poolData.state, market);

      const priceCheckResult = await this.priceMatchV1(tokenAmountIn, new PublicKey(poolData.id), rawAccount.mint.toString());
      //await this.priceMatchV1(tokenAmountIn, new PublicKey(poolData.id),rawAccount.mint.toString());



      for (let i = 0; i < this.config.maxSellRetries; i++) {
        try {
          logger.info(
            { mint: rawAccount.mint },
            `Send sell transaction attempt: ${i + 1}/${this.config.maxSellRetries}`,
          );

          const sellTokenAmount = rawAccount.amount;

          const swapResult = await raySwapSell(this.connection, poolKeys.baseMint.toString(), poolKeys.quoteMint.toString(), Number(sellTokenAmount), accountId.toString());
          console.log("Transaction IDs:", swapResult);
          
          if (swapResult.confirmed) {
            const subscriptionManager = SubscriptionManager.getInstance(this.connection);
            await subscriptionManager.removeSubscription(rawAccount.mint.toString());
            logger.info(`🛑 Stopped monitoring ${rawAccount.mint.toString()} after sell.`);

            // 🗑 **Delete Active Subscription from DB**
            await prisma.activeSubscription.deleteMany({
                where: { tokenBaseAddress: rawAccount.mint.toString() },
            });
            break;
          }else {
            console.error("❌ Swap failed, skipping database update.");
          }



/*           const result = await this.swap(
            poolKeys,
            accountId,
            this.config.quoteAta,
            tokenIn,
            this.config.quoteToken,
            tokenAmountIn,
            this.config.sellSlippage,
            this.config.wallet,
            'sell',
          ); */

  /*         if (result.confirmed) {
            logger.info(
              {
                dex: `https://dexscreener.com/solana/${rawAccount.mint.toString()}?maker=${this.config.wallet.publicKey}`,
                mint: rawAccount.mint.toString(),
                signature: result.signature,
                url: `https://solscan.io/tx/${result.signature}?cluster=${NETWORK}`,
              },
              `Confirmed sell tx`,
            ); 

            const subscriptionManager = SubscriptionManager.getInstance(this.connection);
            await subscriptionManager.removeSubscription(rawAccount.mint.toString());
            logger.info(`🛑 Stopped monitoring ${rawAccount.mint.toString()} after sell.`);

            // 🗑 **Delete Active Subscription from DB**
            await prisma.activeSubscription.deleteMany({
                where: { tokenBaseAddress: rawAccount.mint.toString() },
            });

            await prisma.token.update({
              where: { baseAddress: rawAccount.mint.toString() },
              data: { tokenStatus: 'SOLD' },
            });

            break;
          } */

/*           logger.info(
            {
              mint: rawAccount.mint.toString(),
              signature: result.signature,
              error: result.error,
            },
            `Error confirming sell tx`,
          ); */
        } catch (error) {
          logger.debug({ mint: rawAccount.mint.toString(), error }, `Error confirming sell transaction`);
        }
      }
    } catch (error) {
      logger.error({ mint: rawAccount.mint.toString(), error }, `Failed to sell token`);
    } finally {
      if (this.config.oneTokenAtATime) {
        this.sellExecutionCount--;
      }
    }
  }

  // noinspection JSUnusedLocalSymbols
  private async swap(
    poolKeys: LiquidityPoolKeysV4,
    ataIn: PublicKey,
    ataOut: PublicKey,
    tokenIn: Token,
    tokenOut: Token,
    amountIn: TokenAmount,
    slippage: number,
    wallet: Keypair,
    direction: 'buy' | 'sell',
  ) {
    const slippagePercent = new Percent(slippage, 100);
    
    
    //Darren added to as possible fix
   

    //poolKeys.id = new PublicKey(poolKeys.id);
  
    const [market, mintAta] = await Promise.all([
      this.marketStorage.get(poolKeys.marketId.toString()),
      getAssociatedTokenAddress(poolKeys.baseMint, this.config.wallet.publicKey),
    ]);
    
   //filter match
    
    const poolInfo = await Liquidity.fetchInfo({
      connection: this.connection,
      poolKeys,
    });


    const computedAmountOut = Liquidity.computeAmountOut({
      poolKeys,
      poolInfo,
      amountIn,
      currencyOut: tokenOut,
      slippage: slippagePercent,
    });

    const latestBlockhash = await this.connection.getLatestBlockhash();
    const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
      {
        poolKeys: poolKeys,
        userKeys: {
          tokenAccountIn: ataIn,
          tokenAccountOut: ataOut,
          owner: wallet.publicKey,
        },
        amountIn: amountIn.raw,
        minAmountOut: computedAmountOut.minAmountOut.raw,
      },
      poolKeys.version,
    );

    const messageV0 = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [
        ...(this.isWarp || this.isJito
          ? []
          : [
              ComputeBudgetProgram.setComputeUnitPrice({ microLamports: this.config.unitPrice }),
              ComputeBudgetProgram.setComputeUnitLimit({ units: this.config.unitLimit }),
            ]),
        ...(direction === 'buy'
          ? [
              createAssociatedTokenAccountIdempotentInstruction(
                wallet.publicKey,
                ataOut,
                wallet.publicKey,
                tokenOut.mint,
              ),
            ]
          : []),
        ...innerTransaction.instructions,
        ...(direction === 'sell' ? [createCloseAccountInstruction(ataIn, wallet.publicKey, wallet.publicKey)] : []),
      ],
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([wallet, ...innerTransaction.signers]);

    return this.txExecutor.executeAndConfirm(transaction, wallet, latestBlockhash);
  }
  
  private async filterMatch(poolKeys: LiquidityPoolKeysV4) {
    if (this.config.filterCheckInterval === 0 || this.config.filterCheckDuration === 0) {
        return true;
    }

    const timesToCheck = this.config.filterCheckDuration / this.config.filterCheckInterval;
    let timesChecked = 0;
    let poolPassed = false;
    let trendPassed = false;

    const marketCapFilter = new MarketCapFilter(this.connection, this.config.minMarketCap, this.config.maxMarketCap);
    const marketCapResult = await marketCapFilter.execute(poolKeys);

    if (!marketCapResult.ok) {
        logger.trace(`❌ Market cap check failed for ${poolKeys.baseMint}. Stopping monitoring.`);
        await prisma.token.update({
          where: { baseAddress: poolKeys.baseMint.toString() },
          data: { tokenStatus: 'FAILED' },
        });
        await stopMonitoring(this.connection, poolKeys.baseMint.toString());  // ✅ Stops all monitoring immediately
        return false;
    }

    logger.trace(`✅ Market cap check passed, continuing with other filters.`);


    do {
        try {
            // ✅ Check pool filters, but don’t consume iteration if they fail
            if (!poolPassed) {
                poolPassed = await this.poolFilters.execute(poolKeys);
                if (!poolPassed) {
                    logger.trace(`⏳ Pool filters failed. Retrying... (${timesChecked + 1}/${timesToCheck})`);
                    await sleep(this.config.filterCheckInterval);
                    timesChecked++;
                    continue;
                }
                logger.trace(`✅ Pool filters passed, now checking trend filters.`);
            }

            // ✅ Check trend filters, but don’t consume iteration if they fail
            if (!trendPassed) {
              trendPassed = (await TrendFilters.evaluateToken(poolKeys.baseMint.toString())) ?? false;
              if (!trendPassed) {
                  logger.trace(`⏳ Trend filters not passing yet. Retrying... (${timesChecked + 1}/${timesToCheck})`);
                  await sleep(this.config.filterCheckInterval);
                  timesChecked++;
                  continue;
              }
              logger.trace(`✅ Trend filters passed.`);
          }

            // ✅ If both have passed, we exit successfully
            if (poolPassed && trendPassed) {
                logger.debug(
                    { mint: poolKeys.baseMint.toString() },
                    `✅ Token passed both pool & trend filters. Ready for buy.`
                );
                await prisma.token.update({
                  where: { baseAddress: poolKeys.baseMint.toString() },
                  data: { tokenStatus: 'BUY_CANDIDATE' },
              });
              await stopMonitoring(this.connection, poolKeys.baseMint.toString());
              return true;
            }
        } catch (error) {
            logger.error(`⚠️ Error running filters`, error);
        }

        await sleep(this.config.filterCheckInterval);
        timesChecked++;
    } while (timesChecked < timesToCheck);

    logger.trace(`❌ Token failed all filter retries. Skipping.`);
    await prisma.token.update({
      where: { baseAddress: poolKeys.baseMint.toString() },
      data: { tokenStatus: 'FAILED' },
    });
    await stopMonitoring(this.connection, poolKeys.baseMint.toString());
    return false;
}


private async priceMatchV1(
  amountIn: TokenAmount,
  poolID: PublicKey,
  baseAddress: string
): Promise<'take-profit' | 'stop-loss' | 'timeout'> {
  if (this.config.priceCheckDuration === 0 || this.config.priceCheckInterval === 0) {
    return 'take-profit'; // Skip price check if not configured
  }

  const WSOL_MINT = 'So11111111111111111111111111111111111111112';

  // Fetch the last trade price from the database
  const maxRetries = 5;
  const delayMs = 1000; // 1 second retry delay
  let lastTrade: { price: number } | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    lastTrade = await prisma.trade.findFirst({
      where: { tokenBaseAddress: baseAddress },
      orderBy: { executedAt: 'desc' },
      select: { price: true },
    });

    if (lastTrade) {
      console.log(`✅ Trade record found in database for ${baseAddress} after ${attempt} attempt(s).`);
      break;
    }

    console.log(`⏳ Waiting for trade record... Attempt ${attempt}/${maxRetries}`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  if (!lastTrade) {
    console.error("❌ No trade history found. Exiting price check.");
    return 'timeout';
  }

  const purchasePrice = lastTrade.price; // ✅ Directly using float value
  const takeProfitMultiplier = 1 + this.config.takeProfit / 100; // Example: 10% → 1.1
  const stopLossMultiplier = 1 - this.config.stopLoss / 100; // Example: 10% → 0.9

  let timesChecked = 0;

  do {
    try {
      // Fetch the pool's account data
      const poolAccountInfo = await this.connection.getAccountInfo(poolID);

      if (!poolAccountInfo?.data) {
        console.error(`❌ No Raydium pool data available for ${poolID.toString()}`);
        return 'timeout';
      }

      // Decode the pool state using Raydium's liquidity state layout
      const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(poolAccountInfo.data);

      // Identify whether WSOL is the base mint
      const isWsolBase = poolState.baseMint.toString() === WSOL_MINT;

      // Fetch the base vault and quote vault accounts
      const baseVault = new PublicKey(poolState.baseVault);
      const quoteVault = new PublicKey(poolState.quoteVault);

      // Fetch base & quote reserves
      const baseVaultInfo = await this.connection.getAccountInfo(baseVault);
      const quoteVaultInfo = await this.connection.getAccountInfo(quoteVault);

      if (!baseVaultInfo?.data || !quoteVaultInfo?.data) {
        throw new Error('Vault account data missing.');
      }

      const baseReserve = new BN(splAccountLayout.decode(baseVaultInfo.data).amount.toString());
      const quoteReserve = new BN(splAccountLayout.decode(quoteVaultInfo.data).amount.toString());

      // Calculate the current price based on reserves
      let currentPrice: number;
      if (isWsolBase) {
        currentPrice = baseReserve.toNumber() / quoteReserve.toNumber();
      } else {
        currentPrice = quoteReserve.toNumber() / baseReserve.toNumber();
      }

      console.log(`📈 Current Price: ${currentPrice} | Purchase Price: ${purchasePrice}`);

      // Calculate price change percentage
      const priceChange = (currentPrice / purchasePrice) - 1;
      const profitPercent = priceChange * 100;

      console.log(`📊 Profit/Loss %: ${profitPercent.toFixed(2)}%`);

      if (currentPrice >= purchasePrice * takeProfitMultiplier) {
        console.log(`✅ Take profit triggered! Sold at ${currentPrice}`);
        return 'take-profit';
      }

      if (currentPrice <= purchasePrice * stopLossMultiplier) {
        console.log(`❌ Stop loss triggered! Sold at ${currentPrice}`);
        return 'stop-loss';
      }

      await sleep(this.config.priceCheckInterval);
    } catch (e) {
      console.error(`⚠️ Failed to check token price for ${poolID.toString()}`, e);
    } finally {
      timesChecked++;
    }
  } while (timesChecked < this.config.priceCheckDuration / this.config.priceCheckInterval);

  console.log("⏳ Price check completed. No action triggered.");
  return 'timeout';
}















  private async priceMatch(amountIn: TokenAmount, poolKeys: LiquidityPoolKeysV4) {
    if (this.config.priceCheckDuration === 0 || this.config.priceCheckInterval === 0) {
      return;
    }

    const timesToCheck = this.config.priceCheckDuration / this.config.priceCheckInterval;
    const profitFraction = this.config.quoteAmount.mul(this.config.takeProfit).numerator.div(new BN(100));
    const profitAmount = new TokenAmount(this.config.quoteToken, profitFraction, true);
    const takeProfit = this.config.quoteAmount.add(profitAmount);

    const lossFraction = this.config.quoteAmount.mul(this.config.stopLoss).numerator.div(new BN(100));
    const lossAmount = new TokenAmount(this.config.quoteToken, lossFraction, true);
    const stopLoss = this.config.quoteAmount.subtract(lossAmount);
    const slippage = new Percent(this.config.sellSlippage, 100);
    let timesChecked = 0;

    do {
      try {

        const poolAccountInfo = await this.connection.getAccountInfo(new PublicKey(poolKeyas.id));

        if (!poolAccountInfo) {
            console.log(`❌ No Raydium pool data available for ${poolKeys.id.toString()}`);
            return null;
        }

        const poolData = LIQUIDITY_STATE_LAYOUT_V4.decode(poolAccountInfo.data);



        const poolInfo = await Liquidity.fetchInfo({
          connection: this.connection,
          poolKeys,
        });

        const amountOut = Liquidity.computeAmountOut({
          poolKeys,
          poolInfo,
          amountIn: amountIn,
          currencyOut: this.config.quoteToken,
          slippage,
        }).amountOut;



        logger.debug(
          { mint: poolKeys.baseMint.toString() },
          `Take profit: ${takeProfit.toFixed()} | Stop loss: ${stopLoss.toFixed()} | Current: ${amountOut.toFixed()}`,
        );

        if (amountOut.lt(stopLoss)) {
          break;
        }

        if (amountOut.gt(takeProfit)) {
          break;
        }

        await sleep(this.config.priceCheckInterval);
      } catch (e) {
        logger.trace({ mint: poolKeys.baseMint.toString(), e }, `Failed to check token price`);
      } finally {
        timesChecked++;
      }
    } while (timesChecked < timesToCheck);
  }
}
