import { MarketCache, PoolCache } from './src/cache';
import { Connection, KeyedAccountInfo, Keypair, PublicKey } from '@solana/web3.js';
import { LIQUIDITY_STATE_LAYOUT_V4, MARKET_STATE_LAYOUT_V3, Token, TokenAmount } from '@raydium-io/raydium-sdk';
import { AccountLayout, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Bot, BotConfig } from './src/bot';
import { DefaultTransactionExecutor, TransactionExecutor } from './src/transactions';
import { tokenEmitter, startMonitoring, stopMonitoring } from './src/listeners/new-tokens';
import { startTgMonitor, tgMonitorEmitter  } from './src/listeners/tg-levelUp';
import { SubscriptionManager } from './src/services/subscription-manager';
import readline from 'readline';
import { getWalletKeypair } from './src/helpers/wallet-utils';
//import { runTrendUpdater } from './src/trend/trend-updater';
import { wrapSOL } from './src/helpers/wrap-sol';
import { subscribeToWalletChanges } from './src/listeners/walletMonitor';
import { Mutex } from 'async-mutex';


import {
  getToken,
  getWallet,
  logger,
  COMMITMENT_LEVEL,
  RPC_ENDPOINT,
  RPC_WEBSOCKET_ENDPOINT,
  RPC_NEW_TOKEN_ENDPOINT,
  RPC_NEW_TOKEN_WEBSOCKET_ENDPOINT,
  RPC_TX_ENDPOINT,
  RPC_TX_WEBSOCKET_ENDPOINT,

  PRE_LOAD_EXISTING_MARKETS,
  LOG_LEVEL,
  CHECK_IF_MUTABLE,
  CHECK_IF_MINT_IS_RENOUNCED,
  CHECK_IF_FREEZABLE,
  CHECK_IF_BURNED,
  QUOTE_MINT,
  MAX_POOL_SIZE,
  MIN_POOL_SIZE,
  QUOTE_AMOUNT,
  PRIVATE_KEY,
  USE_SNIPE_LIST,
  USE_TG_FEED,
  ONE_TOKEN_AT_A_TIME,
  AUTO_SELL_DELAY,
  MAX_SELL_RETRIES,
  AUTO_SELL,
  MAX_BUY_RETRIES,
  AUTO_BUY_DELAY,
  COMPUTE_UNIT_LIMIT,
  COMPUTE_UNIT_PRICE,
  CACHE_NEW_MARKETS,
  TAKE_PROFIT,
  STOP_LOSS,
  BUY_SLIPPAGE,
  SELL_SLIPPAGE,
  PRICE_CHECK_DURATION,
  PRICE_CHECK_INTERVAL,
  SNIPE_LIST_REFRESH_INTERVAL,
  TRANSACTION_EXECUTOR,
  CUSTOM_FEE,
  FILTER_CHECK_INTERVAL,
  FILTER_CHECK_DURATION,
  CONSECUTIVE_FILTER_MATCHES,
  MIN_MARKET_CAP,
  MAX_MARKET_CAP,
  TOP_HOLDER_THRESHOLD,
  QUOTE_TOKEN_MINT,
  RAYDIUM_PROGRAM_ID,
} from './src/helpers';
import { version } from './package.json';
import { WarpTransactionExecutor } from './src/transactions/warp-transaction-executor';
import { JitoTransactionExecutor } from './src/transactions/jito-rpc-transaction-executor';

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: COMMITMENT_LEVEL,
});

const newTokenConnection = new Connection(RPC_NEW_TOKEN_ENDPOINT, {
  wsEndpoint: RPC_NEW_TOKEN_WEBSOCKET_ENDPOINT,
  commitment: COMMITMENT_LEVEL,
});

const txConnection = new Connection(RPC_TX_ENDPOINT, {
  wsEndpoint: RPC_TX_WEBSOCKET_ENDPOINT,
  commitment: COMMITMENT_LEVEL,
});

//initialize SubscriptionManager Singleton at Startup
const subscriptionManager = SubscriptionManager.getInstance(connection);

function printDetails(wallet: Keypair, quoteToken: Token, bot: Bot) {
  logger.info(`🚀 Bot Version: ${version}`);
  logger.info(`Wallet: ${wallet.publicKey.toString()}`);
  logger.info(`Buy amount: ${bot.config.quoteAmount.toFixed()} ${bot.config.quoteToken.name}`);
  logger.info(`Auto buy delay: ${bot.config.autoBuyDelay} ms`);
  logger.info(`Auto sell: ${AUTO_SELL}`);
  logger.info(`Auto sell delay: ${bot.config.autoSellDelay} ms`);
  logger.info(`Max sell retries: ${bot.config.maxSellRetries}`);
  logger.info(`Sell slippage: ${bot.config.sellSlippage}%`);
  logger.info(`Take profit: ${bot.config.takeProfit}%`);
  logger.info(`Stop loss: ${bot.config.stopLoss}%`);
  logger.info('Bot is running! Press CTRL + C to stop it.');
}

const runListener = async () => {
  logger.level = LOG_LEVEL;
  logger.info('Bot is starting...');

  const marketCache = new MarketCache(connection);
  const poolCache = new PoolCache();
  let txExecutor: TransactionExecutor;
  const buyMutex = new Mutex();


  switch (TRANSACTION_EXECUTOR) {
    case 'warp': {
      txExecutor = new WarpTransactionExecutor(CUSTOM_FEE);
      break;
    }
    case 'jito': {
      txExecutor = new JitoTransactionExecutor(CUSTOM_FEE, connection);
      break;
    }
    default: {
      txExecutor = new DefaultTransactionExecutor(connection);
      break;
    }
  }
  //const wallet = getWalletKeypair();
  const wallet = getWallet(PRIVATE_KEY.trim());
  subscribeToWalletChanges(connection, wallet.publicKey);
  
  const quoteToken = getToken(QUOTE_MINT);
  
  //const wsolAddress = await wrapSOL(connection, wallet, 200000000);
  
  await subscriptionManager.clearAllSubscriptions();

  //await runTrendUpdater(connection);

  const botConfig = <BotConfig>{
    wallet,
    quoteAta: getAssociatedTokenAddressSync(quoteToken.mint, wallet.publicKey),
    checkRenounced: CHECK_IF_MINT_IS_RENOUNCED,
    checkFreezable: CHECK_IF_FREEZABLE,
    checkBurned: CHECK_IF_BURNED,
    minPoolSize: new TokenAmount(quoteToken, MIN_POOL_SIZE, false),
    maxPoolSize: new TokenAmount(quoteToken, MAX_POOL_SIZE, false),
    minMarketCap: MIN_MARKET_CAP, // Add this
    maxMarketCap: MAX_MARKET_CAP,
    topHolderThreshold: TOP_HOLDER_THRESHOLD,
    quoteToken,
    quoteAmount: new TokenAmount(quoteToken, QUOTE_AMOUNT, false),
    oneTokenAtATime: ONE_TOKEN_AT_A_TIME,
    useSnipeList: USE_SNIPE_LIST,
    useTGFeed: USE_TG_FEED,
    autoSell: AUTO_SELL,
    autoSellDelay: AUTO_SELL_DELAY,
    maxSellRetries: MAX_SELL_RETRIES,
    autoBuyDelay: AUTO_BUY_DELAY,
    maxBuyRetries: MAX_BUY_RETRIES,
    unitLimit: COMPUTE_UNIT_LIMIT,
    unitPrice: COMPUTE_UNIT_PRICE,
    takeProfit: TAKE_PROFIT,
    stopLoss: STOP_LOSS,
    buySlippage: BUY_SLIPPAGE,
    sellSlippage: SELL_SLIPPAGE,
    priceCheckInterval: PRICE_CHECK_INTERVAL,
    priceCheckDuration: PRICE_CHECK_DURATION,
    filterCheckInterval: FILTER_CHECK_INTERVAL,
    filterCheckDuration: FILTER_CHECK_DURATION,
    consecutiveMatchCount: CONSECUTIVE_FILTER_MATCHES,
  };

  const bot = new Bot(connection, marketCache, poolCache, txExecutor, botConfig);
  const valid = await bot.validate();

  if (!valid) {
    logger.info('Bot is exiting...');
    process.exit(1);
  }

  if (PRE_LOAD_EXISTING_MARKETS) {
    await marketCache.init({ quoteToken });
  }

  const runTimestamp = Math.floor(new Date().getTime() / 1000);

  // ✅ Start monitoring new tokens and wallet changes
  await startMonitoring(connection, newTokenConnection, txConnection, wallet.publicKey);
  //startTgMonitor(connection, '@pumpfunnevadie');

  tokenEmitter.on('market', (marketInfo) => {
    if (!marketInfo || !marketInfo.data) {
      console.error("❌ Invalid market data received in 'market' event.");
      return;
    }
    marketCache.save(marketInfo.marketId, marketInfo.data);
  });

  tokenEmitter.on('pool', async (poolState) => {
    if (!poolState) {
      console.error("❌ Received undefined pool data in 'pool' event.");
      return;
    }

  const exists = await poolCache.get(poolState.poolData.baseMint.toString());
    if (!exists) {
      poolCache.save(poolState.poolId.toString(), poolState.poolData);
      await bot.buy(poolState.poolId, poolState.poolData);
    }
  });

/*   tgMonitorEmitter.on('tokenAndPoolData', ({ tokenMint, poolData }) => {
    console.log('Token and Pool Data Retrieved:');
    console.log('Token Mint:', tokenMint);
    console.log('Pool Data:', poolData);
  }); */

  tokenEmitter.on('wallet', async (updatedAccountInfo: KeyedAccountInfo) => {
    const accountData = AccountLayout.decode(updatedAccountInfo.accountInfo.data);

    if (accountData.mint.equals(quoteToken.mint)) {
      return;
    }
    const release = await buyMutex.acquire();
    try {
        // Perform the sell operation
        await bot.sell(updatedAccountInfo.accountId, accountData);
    } finally {
        // Release the mutex lock
        release();
    }
});

  printDetails(wallet, quoteToken, bot);
};

//  Handle graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down bot...');
  await stopMonitoring(connection);
  await subscriptionManager.clearAllSubscriptions();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.on('line', async (input) => {
  if (input.trim().toLowerCase() === 'exit') {
    console.log(' Shutdown command received. Stopping bot...');
    await shutdown();
  }
});

runListener();
