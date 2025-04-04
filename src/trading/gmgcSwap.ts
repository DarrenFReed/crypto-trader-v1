import { Wallet } from '@project-serum/anchor';
import { Keypair, VersionedTransaction, Connection, PublicKey } from '@solana/web3.js';
import { NATIVE_MINT, getAssociatedTokenAddress } from '@solana/spl-token';
import bs58 from 'bs58';
import fetch from 'node-fetch';
import { sleep } from '../helpers';
import { PrismaClient } from '@prisma/client';
import { BN_ONE } from '@raydium-io/raydium-sdk-v2';

const prisma = new PrismaClient();

// GMGN API domain
const API_HOST = 'https://gmgn.ai';

/**
 * Type for swap operation: buy or sell
 */
export type SwapType = 'BUY' | 'SELL';


export interface SwapResult {
  hash: string;
  confirmed: boolean;
  status: any;
  tokenDetails?: {
    tokenAmount: number;
    wsolAmount: number;
    price: number;
  };
}

/**
 * Perform a token swap on Solana using GMGN API with database integration.
 * Works for both BUY and SELL operations.
 * 
 * @param {Connection} connection - Solana connection instance.
 * @param {string} inputToken - The input token address (token to spend).
 * @param {string} outputToken - The output token address (token to receive).
 * @param {string} amount - The amount of input token in lamports/token base units.
 * @param {number} slippage - Slippage tolerance in percentage.
 * @param {SwapType} swapType - Type of swap: 'BUY' or 'SELL'.
 * @param {string} [inputTokenAccount] - Optional token account address for the input token (needed for some SELL operations).
 * @returns {Promise<SwapResult>} - Transaction info including hash and confirmation status.
 */

export async function gmgcSwap(
  connection: Connection,
  inputToken: string,
  outputToken: string,
  amount: string,
  slippage: number,
  swapType: SwapType = 'BUY',
  inputTokenAccount?: string,
  bondingCurveAddress?: string
): Promise<SwapResult> {
  try {
    // Wallet initialization using private key from .env file
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('Private key not found in .env file');
    }
    const wallet = new Wallet(Keypair.fromSecretKey(bs58.decode(privateKey)));
    console.log(`Wallet address: ${wallet.publicKey.toString()}`);

    // For selling tokens, we need to ensure the correct token account is used
    if (swapType === 'SELL' && !inputTokenAccount && inputToken !== NATIVE_MINT.toBase58()) {
      const tokenAddress = await getAssociatedTokenAddress(
        new PublicKey(inputToken),
        wallet.publicKey
      );
      inputTokenAccount = tokenAddress.toString();
      console.log(`Using token account ${inputTokenAccount} for sell operation`);
    }

    // Get quote and unsigned transaction from GMGN API
    let quoteUrl = `${API_HOST}/defi/router/v1/sol/tx/get_swap_route?token_in_address=${inputToken}&token_out_address=${outputToken}&in_amount=${amount}&from_address=${wallet.publicKey.toString()}&slippage=${slippage}`;
    
    // Add token account info if available
    if (inputTokenAccount) {
      quoteUrl += `&token_in_account=${inputTokenAccount}`;
    }
    
    let routeResponse = await fetch(quoteUrl);
    let route = await routeResponse.json();
    console.log('Route Response:', route);

    // Check if the API returned a valid response
    if (!route.data || !route.data.raw_tx || !route.data.raw_tx.swapTransaction) {
      throw new Error('Invalid response from GMGN API: ' + JSON.stringify(route));
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
    let submitResponse = await res.json();
    console.log('Submission Response:', submitResponse);

    // Check if the submission was successful
    if (submitResponse.code !== 0 || !submitResponse.data || !submitResponse.data.hash) {
      throw new Error('Failed to submit transaction: ' + JSON.stringify(submitResponse));
    }

    // Check transaction status with retries
    const maxRetries = 60; // Maximum number of retries (1 retry per second for 60 seconds)
    const retryDelay = 1000; // Delay between retries in milliseconds
    let status;
    let confirmed = false;
    const txHash = submitResponse.data.hash;
    const lastValidBlockHeight = route.data.raw_tx.lastValidBlockHeight;

    // Initialize result object with default values
    const result: SwapResult = { 
      hash: txHash, 
      confirmed: false,
      status: { success: false, expired: false } 
    };

    // Variable to store transaction details when available
    let transactionDetails = null;


    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const statusUrl = `${API_HOST}/defi/router/v1/sol/tx/get_transaction_status?hash=${txHash}&last_valid_height=${lastValidBlockHeight}`;
        let statusResponse = await fetch(statusUrl);
        status = await statusResponse.json();
        console.log(`Status check attempt ${attempt}/${maxRetries}:`, status);

        // Check if the status check was successful
        if (status.code !== 0 || !status.data) {
          console.warn('Invalid status response, retrying...');
          await sleep(retryDelay);
          continue;
        }

        // If the transaction is successful, update DB and exit the loop
        if (status.data.success === true) {
          console.log('✅ Transaction confirmed successful!');
          confirmed = true; 
          if (bondingCurveAddress) {
            try {
              // For Pump.fun tokens, fetch and parse transaction data
              transactionDetails = await fetchAndParsePumpFunTransaction(connection, txHash);
              result.tokenDetails = transactionDetails;
              result.confirmed = true;
              console.log('Pump.fun transaction details:', transactionDetails);
            } catch (pumpError) {
              console.error('Error processing Pump.fun transaction:', pumpError);
            }
          } else {
            try {
              // Fetch transaction details for database record
              transactionDetails = await fetchTransactionDetails(
                connection, 
                txHash, 
                inputToken, 
                outputToken,
              );
              
              console.log('Transaction details fetched:', { 
                tokenAmount: transactionDetails.tokenAmount, 
                wsolAmount: transactionDetails.wsolAmount, 
                price: transactionDetails.price, 
                type: swapType 
              });
              result.tokenDetails = transactionDetails;
              result.confirmed = true;
              // Determine which token is the "base token" for database records based on the swap type
              const baseTokenAddress = swapType === 'BUY' ? outputToken : inputToken;
                  
                // Write trade data to database
              await prisma.$transaction([
                prisma.trade.create({
                  data: {
                    tokenBaseAddress: baseTokenAddress, 
                    executedAt: new Date(),
                    amount: Math.abs(transactionDetails.tokenAmount),
                    price: transactionDetails.price,
                    type: swapType,
                  }
                }),
                // If it's a SELL operation, update token status
                ...(swapType === 'SELL' ? [
                  prisma.token.update({
                    where: { baseAddress: inputToken },
                    data: { tokenStatus: 'SOLD' },
                  })
                ] : [])
              ]);
              
              console.log(`✅ ${swapType} trade record created in database`);
            } catch (detailsError) {
              console.error('Error processing transaction details:', detailsError);
              // Continue with confirmed=true even if details fetch fails
            }
          }
          
          break;
        }
      
        // If the transaction is expired, exit the loop
        if (status.data.expired === true) {
          console.log('❌ Transaction expired');
          break;
        }
        
        // Otherwise continue waiting
        console.log('Transaction pending, waiting...');
      } catch (error) {
        console.error(`⚠️ Error checking transaction status:`, error);
      }

      // Wait before retrying
      await sleep(retryDelay);
    }

    // Return the transaction hash, confirmation status, and final status
    return result;
  } catch (error) {
    console.error('Error in gmgcSwap function:', error);
    throw error; // Re-throw the error to handle it in the calling function
  }
}

/**
 * Fetch detailed information about the swap transaction
 */

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

  const transactionDetails = await connection.getTransaction(txId, config);
  if (!transactionDetails) {
    throw new Error('Transaction details not found.');
  }

  // Determine which mint is the token mint (not WSOL)
  let tokenMint = '';
  if (inputMint === NATIVE_MINT.toBase58()) {
    tokenMint = outputMint;
  } else if (outputMint === NATIVE_MINT.toBase58()) {
    tokenMint = inputMint;
  } else {
    // If neither is WSOL, use a different approach
    // For token-to-token swaps, we'll need more sophisticated analysis
    tokenMint = outputMint; // Default to output mint
  }

  // Look for potential DEX account addresses used by GMGN
  // GMGN may route through various DEXs, so we need to look for changes in relevant accounts
  const dexAccounts = [
    '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', // Raydium
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',  // Jupiter
    'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX',  // Serum
    // Add more DEX accounts as needed
  ];
  
  const preTokenBalances = transactionDetails.meta.preTokenBalances || [];
  const postTokenBalances = transactionDetails.meta.postTokenBalances || [];
  
  // Find DEX account that handled the swap by looking for balance changes
  let dexAccount = null;
  let tokenChange = null;
  let wsolChange = null;
  
  for (const account of dexAccounts) {
    // Filter balances to find ones involving this DEX account
    const changes = postTokenBalances
      .filter((postBalance) => postBalance.owner === account)
      .map((postBalance) => {
        const preBalance = preTokenBalances.find(
          (pre) => pre.mint === postBalance.mint && pre.owner === account
        );
  
        const preAmount = preBalance?.uiTokenAmount.uiAmount || 0;
        const postAmount = postBalance.uiTokenAmount.uiAmount || 0;
  
        return {
          account: postBalance.owner,
          mint: postBalance.mint,
          change: postAmount - preAmount,
          preAmount,
          postAmount,
        };
      });
    
    // Check if this DEX account has the token mint and WSOL balance changes
    const foundTokenChange = changes.find(c => c.mint === tokenMint);
    const foundWsolChange = changes.find(c => c.mint === NATIVE_MINT.toBase58());
    
    // If we found both, use this DEX account
    if (foundTokenChange && foundWsolChange) {
      dexAccount = account;
      tokenChange = foundTokenChange;
      wsolChange = foundWsolChange;
      break;
    }
  }
  
  // If we didn't find through DEX accounts, try to look at wallet changes
  if (!tokenChange || !wsolChange) {
    // Look at our own wallet's balance changes
    const changes = postTokenBalances
      .filter(postBalance => {
        // Find our wallet's token accounts
        const isOwner = transactionDetails.meta.loadedAddresses?.writable?.some(
          addr => addr === postBalance.owner
        );
        return isOwner;
      })
      .map(postBalance => {
        const preBalance = preTokenBalances.find(
          pre => pre.mint === postBalance.mint && pre.owner === postBalance.owner
        );
  
        const preAmount = preBalance?.uiTokenAmount.uiAmount || 0;
        const postAmount = postBalance.uiTokenAmount.uiAmount || 0;
  
        return {
          account: postBalance.owner,
          mint: postBalance.mint,
          change: postAmount - preAmount,
          preAmount,
          postAmount,
        };
      });
    
    tokenChange = changes.find(c => c.mint === tokenMint);
    wsolChange = changes.find(c => c.mint === NATIVE_MINT.toBase58());
  }
  
  if (!tokenChange || !wsolChange) {
    // If still not found, use fallback values to avoid breaking the flow
    console.warn('Could not determine token changes, using fallback values');
    return {
      tokenAmount: 0,
      wsolAmount: 0,
      price: 0
    };
  }

  // Calculate price based on the absolute values of token changes
  const price = Math.abs(wsolChange.change) / Math.abs(tokenChange.change);

  return {
    tokenAmount: tokenChange.change,
    wsolAmount: wsolChange.change,
    price: price,
  };
}


/**
 * Accurately fetch and parse a Pump.fun transaction for both buy and sell transactions
 */
async function fetchAndParsePumpFunTransaction(
  connection: Connection,
  txId: string
): Promise<{ tokenAmount: number; wsolAmount: number; price: number; isBuy: boolean }> {
  const config = {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  };

  // Fetch the full transaction
  const transactionDetails = await connection.getTransaction(txId, config);
  if (!transactionDetails) {
    throw new Error('Transaction details not found.');
  }

  // First attempt: Look for structured event data in the CPI log
  const logMessages = transactionDetails.meta.logMessages || [];
  
  // Try to find the structured event data
  let eventData = null;
  for (const log of logMessages) {
    if (log.includes('Events:') && log.includes('tokenAmount') && log.includes('solAmount')) {
      try {
        // Extract the JSON part if possible
        const eventMatch = log.match(/Events:\s*({.*})/);
        if (eventMatch && eventMatch[1]) {
          eventData = JSON.parse(eventMatch[1]);
          break;
        }
      } catch (e) {
        console.error('Error parsing event data:', e);
      }
    }
  }

  // If structured event data was found, use it
  if (eventData && eventData.tokenAmount && eventData.solAmount) {
    const solAmount = Number(eventData.solAmount) / 1e9; // Convert lamports to SOL
    const tokenAmount = Number(eventData.tokenAmount) / 1e6; // Assuming 6 decimals
    const isBuy = Boolean(eventData.isBuy);
    
    // Calculate price as SOL per token
    const price = solAmount / tokenAmount;
    
    // Apply sign convention based on transaction type
    return {
      tokenAmount: isBuy ? tokenAmount : -tokenAmount,
      wsolAmount: isBuy ? -solAmount : solAmount,
      price: price,
      isBuy: isBuy
    };
  }

  // Second attempt: Parse the Program data binary format
  // This is the binary data produced by Pump.fun
  const programDataLog = logMessages.find(log => log.includes('Program data:'));
  
  if (programDataLog) {
    try {
      // Extract the base64 data
      const base64Data = programDataLog.split('Program data: ')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      
      // Based on analysis, the correct offsets for the data are:
      // - solAmount is at offset 40 (8 bytes)
      // - tokenAmount is at offset 48 (8 bytes)
      // - isBuy flag is at offset 56 (1 byte)
      const solAmount = Number(buffer.readBigUInt64LE(40)) / 1e9; // Convert lamports to SOL
      const tokenAmount = Number(buffer.readBigUInt64LE(48)) / 1e6; // Assuming 6 decimals
      const isBuy = buffer.readUInt8(56) === 1;
      
      // Calculate price
      const price = solAmount / tokenAmount;
      
      // Apply sign convention based on transaction type
      return {
        tokenAmount: isBuy ? tokenAmount : -tokenAmount,
        wsolAmount: isBuy ? -solAmount : solAmount,
        price: price,
        isBuy: isBuy
      };
    } catch (e) {
      console.error('Error parsing program data:', e);
    }
  }

  // If we get here, we need to fall back to token balance changes
  console.log('No event data found, falling back to token balance changes');
  
  // Get token balance changes
  const preTokenBalances = transactionDetails.meta.preTokenBalances || [];
  const postTokenBalances = transactionDetails.meta.postTokenBalances || [];
  
  // Get SOL balance changes
  const preBalanceLamports = transactionDetails.meta.preBalances[0] || 0;
  const postBalanceLamports = transactionDetails.meta.postBalances[0] || 0;
  const solDiffLamports = preBalanceLamports - postBalanceLamports - 2039280; // Subtract token account creation fee
  
  // Find the user's token account 
  const userPostToken = postTokenBalances.find(post => 
    !preTokenBalances.some(pre => pre.accountIndex === post.accountIndex)
  );
  
  if (userPostToken) {
    const tokenAmount = Number(userPostToken.uiTokenAmount.amount) / 10 ** userPostToken.uiTokenAmount.decimals;
    const solAmount = solDiffLamports / 1e9;
    const isBuy = true; // Assume it's a buy if we created a new token account
    
    // Calculate price
    const price = Math.abs(solAmount / tokenAmount);
    
    return {
      tokenAmount: tokenAmount,
      wsolAmount: -solAmount, // Negative because we spent SOL
      price: price,
      isBuy: isBuy
    };
  }
  
  throw new Error('Could not determine transaction details');
}
/**
 * Convenience wrapper for buying tokens with GMGN
 */
export async function gmgcBuy(
  connection: Connection,
  inputToken: string,   // Usually SOL/WSOL
  outputToken: string,  // Token to buy
  amount: string,       // Amount in lamports
  slippage: number = 15, // Default 10% slippage
  bondingCurveAddress?: string // Optional bonding curve address
): Promise<SwapResult> {
  return gmgcSwap(connection, inputToken, outputToken, amount, slippage, 'BUY', undefined, bondingCurveAddress);
}

/**
 * Convenience wrapper for selling tokens with GMGN
 */
export async function gmgcSell(
  connection: Connection,
  inputToken: string,     // Token to sell
  outputToken: string,    // Usually SOL/WSOL
  amount: string,         // Amount in token base units
  slippage: number = 10,  // Default 10% slippage
  inputTokenAccount?: string, // Optional token account address
  bondingCurveAddress?: string // Optional bonding curve address
): Promise<SwapResult> {
  
  return gmgcSwap(connection, inputToken, outputToken, amount, slippage, 'SELL', inputTokenAccount, bondingCurveAddress);
}