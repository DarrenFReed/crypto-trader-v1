import { Keypair, Transaction, VersionedTransaction, sendAndConfirmTransaction, Connection, PublicKey, GetVersionedTransactionConfig } from '@solana/web3.js';
import { NATIVE_MINT, getAssociatedTokenAddress } from '@solana/spl-token';
import axios from 'axios';
import { API_URLS } from '@raydium-io/raydium-sdk-v2';
import dotenv from 'dotenv';
import bs58 from 'bs58';
import { PrismaClient } from '@prisma/client';

dotenv.config();



// Load private key from .env
//const privateKeyString = process.env.PRIVATE_KEY;
//if (!privateKeyString) {
//    throw new Error("❌ Private key not found in .env file!");
//}
const prisma = new PrismaClient();
const privateKeyBase58 = process.env.PRIVATE_KEY;
if (!privateKeyBase58) {
    throw new Error("❌ PRIVATE_KEY is not set in .env or is empty!");
}
// Create Keypair from private key
let owner: Keypair;
try {
    // Decode the base58 private key
    const secretKey = bs58.decode(privateKeyBase58);
    owner = Keypair.fromSecretKey(secretKey);
} catch (error) {
    throw new Error("❌ Invalid private key format. Ensure it's a valid base58-encoded key.");
}

// Default parameters
//const amount = 10000000 ; //.01
const slippage = 10;
const txVersion = 'V0';
const isV0Tx = true;

/**
 * Executes a swap on Raydium
 * @param {Connection} connection - The Solana connection instance
 * @param {string} inputMint - The input token mint address
 * @param {string} outputMint - The output token mint address
 * @returns {Promise<{ confirmed: boolean, txIds: string[] }>} - Returns confirmation status and transaction IDs
 */
export async function raySwapBuy(
    connection: Connection,
    inputMint: string,
    outputMint: string,
    amount: number, // Add amount as a parameter

): Promise<{ confirmed: boolean; txIds: string[] }> {
    const isInputSol = inputMint === NATIVE_MINT.toBase58();
    const isOutputSol = outputMint === NATIVE_MINT.toBase58();
    const transactionIds: string[] = [];
    let allConfirmed = true; // Track overall success

    try {
         
        // Fetch priority fee data
        const { data } = await axios.get<{ id: string; success: boolean; data: { default: { vh: number; h: number; m: number } } }>(
            `${API_URLS.BASE_HOST}${API_URLS.PRIORITY_FEE}`
        );

        // Fetch swap quote
        const { data: swapResponse } = await axios.get<any>(
            `${API_URLS.SWAP_HOST}/compute/swap-base-in?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippage * 100}&txVersion=${txVersion}`
        );

       
        // Fetch transactions
        const { data: swapTransactions } = await axios.post<{ id: string; version: string; success: boolean; data: { transaction: string }[] }>(
            `${API_URLS.SWAP_HOST}/transaction/swap-base-in`,
            {
                computeUnitPriceMicroLamports: String(data.data.default.h),
                swapResponse,
                txVersion,
                wallet: owner.publicKey.toBase58(),
                wrapSol: isInputSol,
                unwrapSol: isOutputSol,
            }
        );

        const allTxBuf = swapTransactions.data.map((tx) => Buffer.from(tx.transaction, 'base64'));
        const allTransactions = allTxBuf.map((txBuf) =>
            isV0Tx ? VersionedTransaction.deserialize(txBuf) : Transaction.from(txBuf)
        );

        console.log(`Total ${allTransactions.length} transactions to send`);

        for (const tx of allTransactions) {
            let txId: string;
        
            if (!isV0Tx) {
                // Sign and send legacy transactions
                const transaction = tx as Transaction;
                transaction.sign(owner);
                txId = await sendAndConfirmTransaction(connection, transaction, [owner], { skipPreflight: true });
            } else {
                // Sign and send versioned transactions
                const transaction = tx as VersionedTransaction;
                transaction.sign([owner]);
                txId = await connection.sendTransaction(tx, { skipPreflight: true });

                console.log(`⏳ Waiting for confirmation... TxId: ${txId}`);

                // Confirm transaction status
                const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash({ commitment: 'finalized' });
                const confirmation = await connection.confirmTransaction(
                    { blockhash, lastValidBlockHeight, signature: txId },
                    'finalized'
                );

                if (confirmation.value.err) {
                    console.error(`❌ Transaction ${txId} failed:`, confirmation.value.err);
                    allConfirmed = false; // Mark failure
                    continue;
                }
            }

            transactionIds.push(txId);
            allConfirmed = true;
            
            const { tokenAmount, wsolAmount, price } = await fetchTransactionDetails(connection, txId, inputMint, outputMint);
            await prisma.$transaction([
                prisma.trade.create({
                    data: {
                        tokenBaseAddress: outputMint.toString(), // Use the correct field name
                        executedAt: new Date(), // Timestamp of the trade
                        amount: tokenAmount, // Amount of tokens received
                        price: price, // Effective price of the trade
                        type: "BUY", // Mark as a purchase
                    },
                }),     
              ]);
            console.log(`✅ Transaction confirmed! 🔍 View: https://solscan.io/tx/${txId}`);
            break;
        }

        return { confirmed: allConfirmed, txIds: transactionIds };
    } catch (error) {
        console.error("❌ Error executing swap:", error);
        return { confirmed: false, txIds: [] };
    }
}


export async function raySwapSell(
    connection: Connection,
    inputMint: string,
    outputMint: string,
    amount: number, // Add amount as a parameter
    inputTokenAccountAddress?: string 

): Promise<{ confirmed: boolean; txIds: string[] }> {
    const isInputSol = inputMint === NATIVE_MINT.toBase58();
    const isOutputSol = outputMint === NATIVE_MINT.toBase58();
    const transactionIds: string[] = [];
    let allConfirmed = true; // Track overall success

    try {
        
        const inputTokenAccount = inputTokenAccountAddress
        ? new PublicKey(inputTokenAccountAddress)
        : await getAssociatedTokenAddress(new PublicKey(inputMint), owner.publicKey);
        
        
        // Fetch priority fee data
        const { data } = await axios.get<{ id: string; success: boolean; data: { default: { vh: number; h: number; m: number } } }>(
            `${API_URLS.BASE_HOST}${API_URLS.PRIORITY_FEE}`
        );

        
        // Fetch swap quote
        const { data: swapResponse } = await axios.get<any>(
            `${API_URLS.SWAP_HOST}/compute/swap-base-in?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippage * 100}&txVersion=${txVersion}`
        );

       
        // Fetch transactions
        const { data: swapTransactions } = await axios.post<{ id: string; version: string; success: boolean; data: { transaction: string }[] }>(
            `${API_URLS.SWAP_HOST}/transaction/swap-base-in`,
            {
                computeUnitPriceMicroLamports: String(data.data.default.h),
                swapResponse,
                txVersion,
                wallet: owner.publicKey.toBase58(),
                wrapSol: false,
                unwrapSol: false,
                inputAccount: inputTokenAccount.toBase58()
            }
        );

        const allTxBuf = swapTransactions.data.map((tx) => Buffer.from(tx.transaction, 'base64'));
        const allTransactions = allTxBuf.map((txBuf) =>
            isV0Tx ? VersionedTransaction.deserialize(txBuf) : Transaction.from(txBuf)
        );

        console.log(`Total ${allTransactions.length} transactions to send`);

        for (const tx of allTransactions) {
            let txId: string;
            if (!isV0Tx) {
                // Sign and send legacy transactions
                const transaction = tx as Transaction;
                transaction.sign(owner);
                txId = await sendAndConfirmTransaction(connection, transaction, [owner], { skipPreflight: true });
            } else {
                // Sign and send versioned transactions
                const transaction = tx as VersionedTransaction;
                transaction.sign([owner]);
                txId = await connection.sendTransaction(tx, { skipPreflight: true });

                console.log(`⏳ Waiting for confirmation... TxId: ${txId}`);

                // Confirm transaction status
                const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash({ commitment: 'finalized' });
                const confirmation = await connection.confirmTransaction(
                    { blockhash, lastValidBlockHeight, signature: txId },
                    'finalized'
                );

                if (confirmation.value.err) {
                    console.error(`❌ Transaction ${txId} failed:`, confirmation.value.err);
                    allConfirmed = false; // Mark failure
                    continue;
                }
            }

            transactionIds.push(txId);
            
            // ✅ Fetch transaction details for trade record
            const { tokenAmount, wsolAmount, price } = await fetchTransactionDetails(connection, txId, inputMint, outputMint);

            // ✅ Save trade data into database (marking it as a sale)
            await prisma.$transaction([
                prisma.trade.create({
                    data: {
                        tokenBaseAddress: inputMint.toString(), // Base address of token sold
                        executedAt: new Date(), // Timestamp of the sale
                        amount: tokenAmount, // Amount of tokens sold
                        price: price, // Effective price of the sale
                        type: "SELL", // Mark as a sale
                    },
                }),
                prisma.token.update({
                    where: { baseAddress: inputMint.toString() }, // Update correct token
                    data: { tokenStatus: "SOLD" }, // Mark as SOLD
                }),
            ]);

            console.log(`✅ Transaction confirmed! 🔍 View: https://solscan.io/tx/${txId}`);
        }

        return { confirmed: allConfirmed, txIds: transactionIds };
    } catch (error) {
        console.error("❌ Error executing swap:", error);
        return { confirmed: false, txIds: [] };
    }
}


async function fetchTransactionDetails(
    connection: Connection,
    txId: string,
    inputMint: string,
    outputMint: string
): Promise<{ tokenAmount: number; wsolAmount: number; price: number }> {
    const config: GetVersionedTransactionConfig = {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0, 
    };

    let tokenMint = '';
    const quoteMint = '';
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
    
    // ✅ Filter balances to only include Raydium account
    const balanceChanges = postTokenBalances
    .filter((postBalance) => postBalance.owner === raydiumAccount) // ✅ Only process Raydium swaps
    .map((postBalance) => {
      const preBalance = preTokenBalances.find(
        (pre) => pre.mint === postBalance.mint && pre.owner === raydiumAccount // ✅ Hardcoded Raydium account
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

    const tokenChange = balanceChanges.find(
        (b) => b.account === raydiumAccount && b.mint === tokenMint
      );

    const wsolChange = balanceChanges.find(
        (b) => b.account === raydiumAccount && b.mint === NATIVE_MINT.toBase58()
      );

    let price: number;
    
    if (wsolChange && tokenChange) {
        price = Math.abs(wsolChange.change) / Math.abs(tokenChange.change);  // SOL per token
    } else {
        throw new Error('Token change data is undefined.');
    }
    
     // 🔥 **Store price as an integer to avoid precision issues**
    //const storedPrice = Math.round(price * 10 ** 9);

    return { 
        tokenAmount: tokenChange.change, 
        wsolAmount: wsolChange.change,
        price: price // Store price in integer format
    };
}

