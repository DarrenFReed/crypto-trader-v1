import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { Token, TokenAmount, LiquidityPoolKeysV4, Liquidity, Percent } from '@raydium-io/raydium-sdk';
import { logger, sleep, NETWORK } from './helpers';
import { TransactionExecutor } from './transactions';
import { createPoolKeys } from './helpers';
import BN from 'bn.js';

export class TelegramBot {
  private activeTrades = new Map<string, boolean>(); // Track active trades by mint

  constructor(
    private readonly connection: Connection,
    private readonly txExecutor: TransactionExecutor,
    private readonly config: any, // Should use your existing BotConfig type
  ) {}

  public async buyToken(baseMint: string) {
    logger.info({ mint: baseMint }, 'Attempting to buy token from Telegram signal...');

    if (this.activeTrades.has(baseMint)) {
      logger.info({ mint: baseMint }, `Skipping buy. Already trading this token.`);
      return;
    }

    this.activeTrades.set(baseMint, true); // Mark token as being traded

    const baseMintPubKey = new PublicKey(baseMint);
    const quoteAta = this.config.quoteAta;
    const wallet = this.config.wallet;

    const poolKeys: LiquidityPoolKeysV4 = {
      id: baseMintPubKey,
      baseMint: baseMintPubKey,
      quoteMint: this.config.quoteToken.mint,
      baseDecimals: 9,
      quoteDecimals: this.config.quoteToken.decimals,
      version: 4,
      programId: new PublicKey(''), // Replace with Raydium program ID
      marketId: new PublicKey(''),
      openOrders: new PublicKey(''),
      targetOrders: new PublicKey(''),
      baseVault: new PublicKey(''),
      quoteVault: new PublicKey(''),
      withdrawQueue: new PublicKey(''),
      lpMint: new PublicKey(''),
      authority: new PublicKey(''),
    };

    for (let i = 0; i < this.config.maxBuyRetries; i++) {
      try {
        logger.info(`Sending buy transaction attempt ${i + 1}/${this.config.maxBuyRetries}`);
        
        const tokenOut = new Token(this.config.quoteToken.programId, baseMintPubKey, 9);
        const result = await this.swap(
          poolKeys,
          quoteAta,
          wallet.publicKey,
          this.config.quoteToken,
          tokenOut,
          this.config.quoteAmount,
          this.config.buySlippage,
          wallet,
          'buy',
        );

        if (result.confirmed) {
          logger.info(
            { mint: baseMint, signature: result.signature },
            `Confirmed buy transaction. URL: https://solscan.io/tx/${result.signature}?cluster=${NETWORK}`
          );

          // Start monitoring price for take-profit / stop-loss
          this.monitorPrice(new TokenAmount(tokenOut, this.config.quoteAmount.raw, true), poolKeys);
          break;
        }

        logger.warn({ mint: baseMint, error: result.error }, `Error confirming buy tx`);
      } catch (error) {
        logger.error({ mint: baseMint, error }, `Failed to buy token`);
      }
    }
  }

  private async monitorPrice(amountIn: TokenAmount, poolKeys: LiquidityPoolKeysV4) {
    logger.info({ mint: poolKeys.baseMint.toString() }, 'Monitoring token for take-profit/stop-loss...');

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
          logger.info({ mint: poolKeys.baseMint.toString() }, 'Stop loss triggered. Selling token...');
          await this.sellToken(poolKeys.baseMint.toString());
          break;
        }

        if (amountOut.gt(takeProfit)) {
          logger.info({ mint: poolKeys.baseMint.toString() }, 'Take profit triggered. Selling token...');
          await this.sellToken(poolKeys.baseMint.toString());
          break;
        }

        await sleep(this.config.priceCheckInterval);
      } catch (e) {
        logger.trace({ mint: poolKeys.baseMint.toString(), e }, `Failed to check token price`);
      } finally {
        timesChecked++;
      }
    } while (timesChecked < timesToCheck);

    this.activeTrades.delete(poolKeys.baseMint.toString());
  }

  public async sellToken(baseMint: string) {
    logger.info({ mint: baseMint }, `Attempting to sell token...`);

    const baseMintPubKey = new PublicKey(baseMint);
    const quoteAta = this.config.quoteAta;
    const wallet = this.config.wallet;

    const poolKeys: LiquidityPoolKeysV4 = {
      id: baseMintPubKey,
      baseMint: baseMintPubKey,
      quoteMint: this.config.quoteToken.mint,
      baseDecimals: 9,
      quoteDecimals: this.config.quoteToken.decimals,
      version: 4,
      programId: new PublicKey(''), // Replace with Raydium program ID
      marketId: new PublicKey(''),
      openOrders: new PublicKey(''),
      targetOrders: new PublicKey(''),
      baseVault: new PublicKey(''),
      quoteVault: new PublicKey(''),
      withdrawQueue: new PublicKey(''),
      lpMint: new PublicKey(''),
      authority: new PublicKey(''),
    };

    const tokenIn = new Token(this.config.quoteToken.programId, baseMintPubKey, 9);
    const tokenAmountIn = this.config.quoteAmount;

    for (let i = 0; i < this.config.maxSellRetries; i++) {
      try {
        logger.info(`Sending sell transaction attempt ${i + 1}/${this.config.maxSellRetries}`);

        const result = await this.swap(
          poolKeys,
          wallet.publicKey,
          quoteAta,
          tokenIn,
          this.config.quoteToken,
          tokenAmountIn,
          this.config.sellSlippage,
          wallet,
          'sell',
        );

        if (result.confirmed) {
          logger.info(
            { mint: baseMint, signature: result.signature },
            `Confirmed sell transaction. URL: https://solscan.io/tx/${result.signature}?cluster=${NETWORK}`
          );
          break;
        }

        logger.warn({ mint: baseMint, error: result.error }, `Error confirming sell tx`);
      } catch (error) {
        logger.error({ mint: baseMint, error }, `Failed to sell token`);
      }
    }

    this.activeTrades.delete(baseMint);
  }
}
