import {
    BlockhashWithExpiryBlockHeight,
    Keypair,
    PublicKey,
    SystemProgram,
    Connection,
    TransactionMessage,
    VersionedTransaction,
  } from '@solana/web3.js';
  import { TransactionExecutor } from './transaction-executor.interface';
  import { logger } from '../helpers';
  import axios, { AxiosError } from 'axios';
  import bs58 from 'bs58';
  import { Currency, CurrencyAmount } from '@raydium-io/raydium-sdk';
  
  export class JitoTransactionExecutor implements TransactionExecutor {
    // Jito validator tip accounts
    private jitpTipAccounts = [
      'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
      'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
      '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
      '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
      'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
      'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
      'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
      'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
    ];
  
    private JitoFeeWallet: PublicKey;
  
    constructor(
      private readonly connection: Connection,
    ) {
      this.JitoFeeWallet = this.getRandomValidatorKey();
    }
  
    private getRandomValidatorKey(): PublicKey {
      const randomValidator = this.jitpTipAccounts[Math.floor(Math.random() * this.jitpTipAccounts.length)];
      return new PublicKey(randomValidator);
    }
  
    /**
     * Calculates a dynamic tip based on network congestion and transaction urgency.
     * @param networkCongestion - A multiplier representing network congestion (e.g., 1 for normal, 2 for high).
     * @param transactionUrgency - A multiplier representing transaction urgency (e.g., 1 for normal, 2 for high).
     * @returns The tip amount in lamports.
     */
    private calculateTip(networkCongestion: number, transactionUrgency: number): number {
      const baseTip = 1000; // Base tip in lamports (0.000001 SOL)
      const congestionMultiplier = Math.max(1, networkCongestion); // Adjust based on congestion
      const urgencyMultiplier = Math.max(1, transactionUrgency); // Adjust based on urgency
      return baseTip * congestionMultiplier * urgencyMultiplier;
    }
  
    public async executeAndConfirm(
      transaction: VersionedTransaction,
      payer: Keypair,
      latestBlockhash: BlockhashWithExpiryBlockHeight,
      networkCongestion: number = 1, // Default congestion level
      transactionUrgency: number = 1, // Default urgency level
    ): Promise<{ confirmed: boolean; signature?: string; error?: string }> {
      logger.debug('Starting Jito transaction execution...');
      this.JitoFeeWallet = this.getRandomValidatorKey(); // Update wallet key each execution
      logger.trace(`Selected Jito fee wallet: ${this.JitoFeeWallet.toBase58()}`);
  
      try {
        // Calculate dynamic tip
        const tipAmount = this.calculateTip(networkCongestion, transactionUrgency);
        logger.trace(`Calculated tip: ${tipAmount} lamports`);
  
        // Create the Jito tip transaction
        const jitTipTxFeeMessage = new TransactionMessage({
          payerKey: payer.publicKey,
          recentBlockhash: latestBlockhash.blockhash,
          instructions: [
            SystemProgram.transfer({
              fromPubkey: payer.publicKey,
              toPubkey: this.JitoFeeWallet,
              lamports: tipAmount,
            }),
          ],
        }).compileToV0Message();
  
        const jitoFeeTx = new VersionedTransaction(jitTipTxFeeMessage);
        jitoFeeTx.sign([payer]);
  
        const jitoTxsignature = bs58.encode(jitoFeeTx.signatures[0]);
  
        // Serialize the transactions
        const serializedjitoFeeTx = bs58.encode(jitoFeeTx.serialize());
        const serializedTransaction = bs58.encode(transaction.serialize());
        const serializedTransactions = [serializedjitoFeeTx, serializedTransaction];
  
        // Jito API endpoints
        const endpoints = [
          'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
          'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
          'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles',
          'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles',
          'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
        ];
  
        // Send transactions to all endpoints
        const requests = endpoints.map((url) =>
          axios.post(url, {
            jsonrpc: '2.0',
            id: 1,
            method: 'sendBundle',
            params: [serializedTransactions],
          }),
        );
  
        logger.trace('Sending transactions to endpoints...');
        const results = await Promise.all(requests.map((p) => p.catch((e) => e)));
  
        const successfulResults = results.filter((result) => !(result instanceof Error));
  
        if (successfulResults.length > 0) {
          logger.trace(`At least one successful response`);
          logger.debug(`Confirming jito transaction...`);
          return await this.confirm(jitoTxsignature, latestBlockhash);
        } else {
          logger.debug(`No successful responses received for jito`);
        }
  
        return { confirmed: false };
      } catch (error) {
        if (error instanceof AxiosError) {
          logger.trace({ error: error.response?.data }, 'Failed to execute jito transaction');
        }
        logger.error('Error during transaction execution', error);
        return { confirmed: false };
      }
    }
  
    private async confirm(signature: string, latestBlockhash: BlockhashWithExpiryBlockHeight) {
      const confirmation = await this.connection.confirmTransaction(
        {
          signature,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          blockhash: latestBlockhash.blockhash,
        },
        this.connection.commitment,
      );
  
      return { confirmed: !confirmation.value.err, signature };
    }
  }