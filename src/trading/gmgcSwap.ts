import { Wallet } from '@project-serum/anchor';
import { Keypair, VersionedTransaction, Connection } from '@solana/web3.js';
import bs58 from 'bs58';
import fetch from 'node-fetch';
import { sleep } from '../helpers'; // Ensure sleep is imported

// GMGN API domain
const API_HOST = 'https://gmgn.ai';

/**
 * Perform a token swap on Solana using GMGN API.
 * @param {string} inputToken - The input token address (e.g., SOL).
 * @param {string} outputToken - The output token address.
 * @param {string} amount - The amount of input token in lamports.
 * @param {number} slippage - Slippage tolerance in percentage (default: 0.5).
 * @returns {Promise<{ hash: string, status: any }>} - The transaction hash and final status.
 */
export async function gmgcSwap(
  connection: Connection,
  inputToken: string,
  outputToken: string,
  amount: string,
  slippage: number = 0.5
): Promise<{ hash: string; status: any }> {
  try {
    // Wallet initialization using private key from .env file
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('Private key not found in .env file');
    }
    const wallet = new Wallet(Keypair.fromSecretKey(bs58.decode(privateKey)));
    console.log(`Wallet address: ${wallet.publicKey.toString()}`);

    // Get quote and unsigned transaction from GMGN API
    const quoteUrl = `${API_HOST}/defi/router/v1/sol/tx/get_swap_route?token_in_address=${inputToken}&token_out_address=${outputToken}&in_amount=${amount}&from_address=${wallet.publicKey.toString()}&slippage=${slippage}`;
    let routeResponse = await fetch(quoteUrl);
    let route = await routeResponse.json();
    console.log('Route Response:', route);

    // Check if the API returned a valid response
    if (!route.data || !route.data.raw_tx || !route.data.raw_tx.swapTransaction) {
      throw new Error('Invalid response from GMGN API');
    }

    // Deserialize and sign the transaction
    const swapTransactionBuf = Buffer.from(route.data.raw_tx.swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    transaction.sign([wallet.payer]);
    const signedTx = Buffer.from(transaction.serialize()).toString('base64');
    console.log('Signed Transaction:', signedTx);

    // Submit the signed transaction to GMGN API
    let res = await fetch(`${API_HOST}/defi/router/v1/sol/tx/submit_signed_transaction`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signed_tx: signedTx }),
    });
    res = await res.json();
    console.log('Submission Response:', res);

    // Check if the submission was successful
    if (res.code !== 0 || !res.data || !res.data.hash) {
      throw new Error('Failed to submit transaction');
    }

    // Check transaction status with retries
    const maxRetries = 60; // Maximum number of retries (1 retry per second for 60 seconds)
    const retryDelay = 1000; // Delay between retries in milliseconds
    let status;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const hash = res.data.hash;
        const lastValidBlockHeight = route.data.raw_tx.lastValidBlockHeight;
        const statusUrl = `${API_HOST}/defi/router/v1/sol/tx/get_transaction_status?hash=${hash}&last_valid_height=${lastValidBlockHeight}`;
        let statusResponse = await fetch(statusUrl);
        status = await statusResponse.json();
        console.log('Transaction Status:', status);

        // Check if the status check was successful
        if (status.code !== 0 || !status.data) {
          throw new Error('Failed to fetch transaction status');
        }

        // If the transaction is successful or expired, exit the loop
        if (status.data.success === true || status.data.expired === true) {
          break;
        }
      } catch (error) {
        console.error(`⚠️ Error checking transaction status:`, error);
      }

      // Wait before retrying
      await sleep(retryDelay);
    }

    if (status.data.success === true) {
      const { tokenAmount, wsolAmount, price } = await fetchTransactionDetails(connection, res.data.hash, inputMint, outputMint);

      // Update the database with the trade details
      await prisma.$transaction([
        prisma.trade.create({
          data: {
            tokenBaseAddress: outputMint, // Use the output token address
            executedAt: new Date(), // Timestamp of the trade
            amount: tokenAmount, // Amount of tokens received
            price: price, // Effective price of the trade
            type: 'BUY', // Mark as a purchase
          },
        }),
      ]);

      console.log(`✅ Database updated: Token status set to BOUGHT.`);
    }



    // Return the transaction hash and final status
    return { hash: res.data.hash, status: status?.data || { success: false, expired: true } };
  } catch (error) {
    console.error('Error in gmgcSwap function:', error);
    throw error; // Re-throw the error to handle it in the calling function
  }
}

async function fetchTransactionDetails(
  connection: Connection,
  txId: string,
  inputMint: string,
  outputMint: string
): Promise<{ tokenAmount: number; wsolAmount: number; price: number }> {
  const config = {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  };

  let tokenMint = '';
  if (inputMint === NATIVE_MINT.toBase58()) {
    tokenMint = outputMint;
  } else if (outputMint === NATIVE_MINT.toBase58()) {
    tokenMint = inputMint;
  }

  const transactionDetails = await connection.getTransaction(txId, config);
  if (!transactionDetails) {
    throw new Error('Transaction details not found.');
  }

  const raydiumAccount = '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1'; // Raydium Swap Account
  const preTokenBalances = transactionDetails.meta.preTokenBalances || [];
  const postTokenBalances = transactionDetails.meta.postTokenBalances || [];

  // Filter balances to only include Raydium account
  const balanceChanges = postTokenBalances
    .filter((postBalance) => postBalance.owner === raydiumAccount)
    .map((postBalance) => {
      const preBalance = preTokenBalances.find(
        (pre) => pre.mint === postBalance.mint && pre.owner === raydiumAccount
      );

      const preAmount = preBalance?.uiTokenAmount.uiAmount || 0;
      const postAmount = postBalance.uiTokenAmount.uiAmount || 0;

      return {
        transactionSignature: txId,
        account: postBalance.owner,
        mint: postBalance.mint,
        change: postAmount - preAmount, // Net change
        preAmount,
        postAmount,
      };
    });

  const tokenChange = balanceChanges.find((b) => b.account === raydiumAccount && b.mint === tokenMint);
  const wsolChange = balanceChanges.find((b) => b.account === raydiumAccount && b.mint === NATIVE_MINT.toBase58());

  let price: number;
  if (wsolChange && tokenChange) {
    price = Math.abs(wsolChange.change) / Math.abs(tokenChange.change); // SOL per token
  } else {
    throw new Error('Token change data is undefined.');
  }

  return {
    tokenAmount: tokenChange.change,
    wsolAmount: wsolChange.change,
    price: price,
  };
}