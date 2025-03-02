import { Connection, PublicKey } from '@solana/web3.js';
import { PrismaClient } from '@prisma/client';
import chalk from 'chalk';
import fs from 'fs';
import axios from 'axios';

const prisma = new PrismaClient();
const MIN_TRADE_AMOUNT_SOL = 0.1;
const MAX_RATIO_CAP = 5; // Define a reasonable maximum cap for the ratio
const FETCH_LIMIT = 75;
const HELIUS_API_KEY = 'd4a0e249-aecd-4f2f-9e05-a0985a90650a'; 
/**
 * 
 * 
Processes transactions for a token, either fetching historical transactions or batch processing real-time WSS transactions.
 */


// 🔄 **Second WebSocket Connection**


interface TransactionStats {
    inputSignatureCount: number;
    responseCount: number;
    isMatchingCount: boolean;
    error?: string;
  }

export async function processTransactions(
    connection: Connection,
    tokenMint: string,
    quoteMint: string,
    poolId: string,
    historical?: boolean,
    transactionSignatures?: string[]
) {
    try {
        if (historical) {
            const tokenPublicKey = new PublicKey(tokenMint);
            const signatures = await connection.getSignaturesForAddress(tokenPublicKey, {
                limit: FETCH_LIMIT,
            });
            console.log(chalk.yellow(` Fetching Historical batch of ${signatures.length} transactions for ${tokenMint}...`));

            if (!signatures.length) {
                console.log(chalk.gray(` No new historical transactions found for ${tokenMint}.`));
                return null;
            }

        transactionSignatures = signatures.map((tx) => tx.signature);
        }

        if (!transactionSignatures || transactionSignatures.length === 0) {
            console.log(chalk.gray(` No transaction signatures to process for ${tokenMint}.`));
            return null;
        }

        console.log(chalk.yellow(` Processing batch of ${transactionSignatures.length} transactions for ${tokenMint}...`));
        console.log("Sending payload to Helius:", JSON.stringify({ transactions: transactionSignatures }, null, 2));

        const transactionsCopy = [...transactionSignatures]; 

        // Fetch transaction details using Helius API
        //const HELIUS_API_KEY = 'd4a0e249-aecd-4f2f-9e05-a0985a90650a'; 
        const url = `https://api.helius.xyz/v0/transactions?api-key=${HELIUS_API_KEY}`;
        

        const maxRetries = 5;
        let attempt = 0;
        let jsonResponse = [];
        let success = false;
        
        do {
            console.log(`🔄 Attempt ${attempt + 1}/${maxRetries} - Sending request to Helius...`);
            
            const response = await axios.post(url, {
                transactions: transactionsCopy // No need to stringify
            }, {
                headers: { "Content-Type": "application/json" }
            });

            jsonResponse = response.data;
        

            console.log(`Retrieved ${jsonResponse.length} transactions.`);
        
            if (jsonResponse.length === transactionsCopy.length) {
                success = true;
                console.log("Match found! Exiting loop.");
            } else {
                console.warn(`Mismatch detected! Expected ${transactionsCopy.length}, got ${jsonResponse.length}. Retrying...`);
            }
        
            attempt++;
        } while (!success && attempt < maxRetries);
        
        if (!success) {
            console.error("Max retries reached. Still no match!");
        } else {
            console.log(`📊 Final transaction count: ${jsonResponse.length}`);
        }


        console.log("Response status:", jsonResponse.status);
        //console.log("Response data:", jsonResponse);

        console.log(chalk.green(`Retrieved JSON Response of ${jsonResponse.length} transactions for ${tokenMint}.`));
        
        const parsedTransactions = jsonResponse; // Adjust if necessary
        
        console.log(chalk.green(`Parsed transaction of ${parsedTransactions.length} transactions for ${tokenMint}.`));
        
        fs.appendFileSync(`helius_transactions_${tokenMint}.json`, JSON.stringify(jsonResponse, null, 2));
        //const parsedTransactions = await response.json.();

        if (!parsedTransactions || parsedTransactions.length === 0) {
            console.log(chalk.gray(`No valid transactions found for ${tokenMint}.`));
            return null;
        }

        //console.log(chalk.green(`🔍 Retrieved ${parsedTransactions.length} transactions for ${tokenMint}.`));

        let buyCount = 0;
        let sellCount = 0;
        let buyVolume = 0;
        let sellVolume = 0;
        let tradeFrequency = 0;
        let lastTransactionSignature = '';

        for (const tx of parsedTransactions) {
            if (tx.source !== "RAYDIUM" || !tx.tokenTransfers || tx.tokenTransfers.length < 2) continue;
        

            const soldToken = tx.tokenTransfers[0]; // First transfer (Sold token)
            const receivedToken = tx.tokenTransfers[1]; // Second transfer (Received token)
        
            // **BUY Condition:** Swapped SOL for Token
            if (soldToken.mint === "So11111111111111111111111111111111111111112" && soldToken.tokenAmount >= MIN_TRADE_AMOUNT_SOL) {
                buyCount++;
                buyVolume += receivedToken.tokenAmount; //buy token amount
            } 
            // **SELL Condition:** Swapped Token for SOL
            else if (receivedToken.mint === "So11111111111111111111111111111111111111112" && receivedToken.tokenAmount >= MIN_TRADE_AMOUNT_SOL) {
                sellCount++;
                sellVolume += soldToken.tokenAmount; // Sold token amount
            }
            lastTransactionSignature = tx.signature;
        }
        tradeFrequency = buyCount + sellCount;

        if (tradeFrequency === 0) {
            console.log(`Skipping DB insert for ${tokenMint} - No valid trades detected.`);
            return null;
        }

        const buySellTxRatio = sellCount === 0 ? buyCount : buyCount / sellCount;
        //const buySellTxRatio = Math.min(rawTxRatio, MAX_RATIO_CAP); // Cap the ratio at MAX_RATIO_CAP
        
        const rawVolumeRatio = sellVolume === 0 ? buyVolume : buyVolume / sellVolume;
        const buySellVolumeRatio = Math.min(rawVolumeRatio, MAX_RATIO_CAP); // Cap the ratio at MAX_RATIO_CAP

        console.log(chalk.blue(`📊 Token: ${tokenMint} | Buys: ${buyCount} | Sells: ${sellCount} | Buy Volume: ${buyVolume} | Sell Volume: ${sellVolume} | Trades: ${tradeFrequency}`));

        return {
            buyCount,
            sellCount,
            buyVolume,
            sellVolume,
            tradeFrequency,
            buySellTxRatio,
            buySellVolumeRatio,
            lastTransactionSignature,
        };
    } catch (error) {
        console.error(`Error processing transactions for ${tokenMint}:`, error);
        return null;
    }
}