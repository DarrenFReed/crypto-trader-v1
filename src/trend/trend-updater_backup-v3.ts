import { Connection, PublicKey } from '@solana/web3.js';
import { PrismaClient } from '@prisma/client';
import chalk from 'chalk';
import axios from 'axios';
import { processTransactions } from './transaction-fetcher';
import { SubscriptionManager } from '../services/subscription-manager';
import { stopMonitoring } from '../monitoring/monitoring-manager';
import fs from 'fs';
import got from 'got';
//import { forecastTransactionSize } from '@raydium-io/raydium-sdk';
import WebSocket from 'ws';
import { Helius } from "helius-sdk";
import { LIQUIDITY_STATE_LAYOUT_V4, MAINNET_PROGRAM_ID, MARKET_STATE_LAYOUT_V3, Token } from '@raydium-io/raydium-sdk';
import bs58 from 'bs58';




const prisma = new PrismaClient();
const activeMonitors = new Map<string, NodeJS.Timeout>();
const FETCH_LIMIT = 95;
const HELIUS_API_KEY = 'd4a0e249-aecd-4f2f-9e05-a0985a90650a';
const RAYDIUM_AMM_PROGRAM_ID = new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8");



const activeQueues: Map<string, string[]> = new Map(); // Store active transaction queues



//const HELIUS_WS_URL='wss://mainnet.helius-rpc.com/?api-key=d4a0e249-aecd-4f2f-9e05-a0985a90650a'


// Define Invalid Errors to Filter Out
const INVALID_ERRORS = [
    "IllegalOwner",
    "InvalidAccount",
    "InvalidArgument", // maybe
    "InsufficientFunds",
    "ProgramFailedToComplete",
    "Custom", // Custom errors also need additional handling in filtering logic
];

//********** These routines are for the webhook plan to tranck transactions */

// Function to start WebSocket Listener for TOKEN_TRANSFERS
export async function startTransactionListener(connection: Connection, tokenMint: string, quoteMint: string, poolId: string) {
    console.log(chalk.blue(`🔄 Starting WebSocket monitoring for swaps in pool: ${poolId}`));
    const subscriptionManager = SubscriptionManager.getInstance(connection);
    const [wsolAccount, tokenAccount] = await getPoolAccounts(connection,poolId);
    console.log(chalk.green(`📌 WSOL Account: ${wsolAccount}, Token Account: ${tokenAccount}`));

    const ws = new WebSocket(HELIUS_WS_URL);

    ws.on('open', () => {
        console.log(chalk.green('✅ Connected to Helius WebSocket'));
        const subscription = {
            jsonrpc: "2.0",
            id: 1,
            method: "subscribe",
            params: {
                webhookType: "TOKEN_TRANSFERS",
                account: poolId
            }
        };
        ws.send(JSON.stringify(subscription));
        subscriptionManager.addSubscription(tokenMint, ws._socket.remotePort);
    });

    ws.on('message', async (data) => {
        const message = JSON.parse(data.toString());
        if (!message.params || !message.params.result) return;

        const txn = message.params.result;
        const transfer = txn.tokenTransfers.find(t => t.toUserAccount === tokenAccount || t.fromUserAccount === tokenAccount);
        if (!transfer) return;

        const type = transfer.fromUserAccount === wsolAccount ? "SELL" : "BUY";
        const amount = transfer.tokenAmount;

        await recordTransaction(tokenMint, poolId, type, amount);
    });

    ws.on('error', (error) => console.error(chalk.red('❌ WebSocket Error:'), error));
    ws.on('close', () => console.log(chalk.yellow('⚠️ WebSocket connection closed')));
    subscriptionManager.removeSubscription(tokenMint);
}


async function getPoolAccounts(connection: Connection, poolId: string) {
    try {
        const response = await connection.getTokenAccountsByOwner(
            new PublicKey(poolId),
            { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }
        );

        return response.value.map(acc => acc.pubkey.toString());
    } catch (error) {
        console.error("❌ Error fetching pool accounts:", error);
        return [];
    }
}



// Function to Record Transactions in the Database
async function recordTransaction(tokenBaseAddress: string, poolId: string, type: TransactionType, amount: number, price: number) {
    try {
        await prisma.transaction.create({
            data: {
                tokenBaseAddress,
                type,
                amount,
                price,
                timestamp: new Date()
            }
        });
        console.log(chalk.green(`✅ Recorded ${type} transaction for ${tokenBaseAddress}`));
    } catch (error) {
        console.error(chalk.red(`❌ Error saving transaction for ${tokenBaseAddress}:`), error);
    }
}

// Function to check token status and stop tracking if necessary
async function monitorTokenStatus() {
    setInterval(async () => {
        const tokens = await prisma.token.findMany({
            where: {
                status: { in: ["BUY_CANDIDATE", "BOUGHT", "SOLD", "FAILED"] }
            }
        });

        for (const token of tokens) {
            console.log(chalk.red(`🛑 Stopping tracking for token: ${token.tokenBaseAddress} due to status ${token.status}`));
            subscriptionManager.removeSubscription(token.tokenBaseAddress);
        }
    }, 60000); // Check every 60 seconds
}



/**
 * Fetch transaction details from Helius API.
 */
async function fetchTransactions(transactionSignatures: string) {
    
    //const payload = { transactions: JSON.parse(JSON.stringify(transactionSignatures)) };
    const payload = { transactions: transactionSignatures };

    console.log(chalk.green(`Transaction signatures input:`), transactionSignatures);
    console.log(chalk.green(`Number of transaction signatures:`), transactionSignatures.length);

    //console.log(chalk.green(`payload transactionSignatures input:`), payload);
    //console.log(chalk.green(`payload transactionSignatures input:`), payload.transactions.length);
    
    const url = `https://api.helius.xyz/v0/transactions?api-key=${HELIUS_API_KEY}`;
    //const url = `https://api-devnet.helius-rpc.com/v0/transactions/?api-key=${HELIUS_API_KEY}`;
    
    
    try {

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                transactions: transactionSignatures, // Match the Helius example
            }),
        });

/*     
        const response = await axios.post(url, payload, {
            headers: { "Content-Type": "application/json" }
        });

        const response = await got.post(url, {
            body: JSON.stringify({ transactions: transactionSignatures }), // ✅ Manually stringify JSON
            headers: { "Content-Type": "application/json" }
        }); */
        
        // ✅ Manually parse the response JSON
        //const parsedResponse = JSON.parse(response.data);
        const data = await response.json();

        console.log(chalk.green(`Retrieved ${data.length} transactions from Helius.`));
        console.log(chalk.green(`Response Status: ${response.status}`));
        console.log(chalk.green(`Response Headers:`), response.headers);
       //console.log(chalk.green(`Response Data:`), JSON.stringify(response.data, null, 2));

        if (response.error) {
            console.error(chalk.red(`❌ API Error: ${response.data.error}`));
            return [];
        }
        const returnedSignatures = data.map((tx: any) => tx.signature);
        const missingSignatures = transactionSignatures.filter(
            signature => !returnedSignatures.includes(signature)
        );

        if (missingSignatures.length > 0) {
            console.warn(chalk.yellow(`⚠️ Missing transactions for signatures:`), missingSignatures);
        }

        if (data.length !== transactionSignatures.length) {
            console.warn(chalk.red(`⚠️ Mismatch: Expected ${transactionSignatures.length}, got ${data.length}.`));
        }

        return data;
    } catch (error) {
        if (error instanceof Error) {
            console.error(chalk.red(`❌ Error fetching transactions from Helius: ${error.message}`));
        } else {
            console.error(chalk.red(`❌ Error fetching transactions from Helius: ${error}`));
        }
        return [];
    }
}

/**
 * Initializes token metrics by fetching historical transactions.
 */
export async function initializeTokenMetrics(connection: Connection, tokenMint: string, quoteMint: string, poolId: string) {
    console.log(chalk.yellow(`🆕 New token detected: ${tokenMint}. Initializing metrics...`));

    const tokenPublicKey = new PublicKey(tokenMint);
    //const signatures = await connection.getSignaturesForAddress(tokenPublicKey, { limit: FETCH_LIMIT });
    const signatures = await connection.getSignaturesForAddress(tokenPublicKey);

    fs.appendFileSync(`Signatures_${tokenMint}.json`, JSON.stringify(signatures, null, 2));

    console.log(chalk.green(` Retrieved ${signatures.length} historical signatures for ${tokenMint}...`));
    
    if (!signatures.length) {
        console.log(chalk.gray(`⚠️ No historical transactions found for ${tokenMint}.`));
        return;
    }
    
    //***Filter out Specific errors and slice to top 95 */
    const validSignatures = signatures
    .filter(tx => {
        if (!tx.err) return true; // ✅ Keep transactions with no errors

        // ✅ Ensure `tx.err` is an object before checking for "InstructionError"
        if (typeof tx.err === "object" && tx.err !== null && "InstructionError" in tx.err) {
            const instructionError = tx.err.InstructionError;

            // ✅ Ensure it's an array with at least 2 elements
            if (Array.isArray(instructionError) && instructionError.length > 1) {
                const errorValue = instructionError[1]; // Get the error detail

                return !(
                    (typeof errorValue === "object" && "Custom" in errorValue) ||  // Exclude Custom errors
                    (typeof errorValue === "string" && INVALID_ERRORS.includes(errorValue)) // Exclude known invalid errors
                );
            }
        }

        // ✅ If error is a string, check against INVALID_ERRORS
        if (typeof tx.err === "string") {
            return !INVALID_ERRORS.includes(tx.err);
        }

        return true; // ✅ Default: Keep transactions with unknown error types
    })
    .slice(0, 95) // ✅ Limit to top 90 transactions
    .map(tx => tx.signature); // ✅ Extract only the signature string

    fs.writeFileSync(
        `Signatures_${tokenMint}.txt`,
        validSignatures.map(sig => `"${sig}"`).join('\n'),
        'utf8'
    );

    const transactionSignatures = validSignatures
    
    
    //*** No errors removed and no quotes fixed */
    //const transactionSignatures = signatures.map(tx => tx.signature);
    
    // *** Remove all errors and fix quotes ***
    //const validTransactions = signatures.filter(tx => tx.err === null);
    //const transactionSignatures = validTransactions.map(tx => tx.signature.replace(/'/g, '"'));
    
    //*** Fixed quotes only */       
    //const formattedSignatures = signatures.map(tx => tx.signature.replace(/'/g, '"'));
    //const transactionSignatures = signatures
    //.filter(tx => tx.err === null) // Keep only successful transactions
    //.map(tx => tx.signature); // Extract only the signature property

    // Fetch transaction data from Helius
    const transactionsData = await fetchTransactions(transactionSignatures);

    if (!transactionsData.length) {
        console.log(chalk.gray(`⚠️ No valid transactions returned from Helius.`));
        return;
    }

    const metrics = await processTransactions(transactionsData, tokenMint, quoteMint, poolId);

    if (metrics) {
        await prisma.tokenMetrics.create({
            data: {
                tokenBaseAddress: tokenMint,
                ...metrics,
                createdAt: new Date(),
            },
        });

        console.log(chalk.green(`✅ Successfully initialized metrics for ${tokenMint}`));
    }
}


const WSOL_MINT = "So11111111111111111111111111111111111111112";
const MIN_TRADE_AMOUNT_SOL = 0.01; // Minimum trade amount in SOL
export async function startTokenMonitoring(connection: Connection, tokenMint: string, quoteMint: string, poolId: string) {
    console.log(chalk.blue(`🔄 Starting WebSocket monitoring for pool: ${poolId}`));

    const POOL_ID = new PublicKey(poolId);
    const BASE_MINT = new PublicKey(tokenMint);
    const logSubscriptionId = connection.onProgramAccountChange(
        MAINNET_PROGRAM_ID.AmmV4, 
        async (updatedAccountInfo, context) => {
            console.log(`🔍 Change detected in pool ${POOL_ID.toBase58()} at slot ${context.slot}`);

            // Get recent transactions for the pool
            const recentSignatures = await connection.getSignaturesForAddress(POOL_ID, { limit: 1 });
            if (!recentSignatures.length) {
                console.log(`⚠️ No recent transactions found for pool ${POOL_ID.toBase58()}`);
                return;
            }

            const latestSignature = recentSignatures[0].signature;
            console.log(`📡 Fetching transaction details for: ${latestSignature}`);

            const parsedTransaction = await connection.getParsedTransaction(latestSignature, {
                maxSupportedTransactionVersion: 0,
                commitment: 'confirmed',
            });

            if (!parsedTransaction || !parsedTransaction.meta) {
                console.log(`⚠️ No valid transaction data found for ${latestSignature}`);
                return;
            }

            console.log(`✅ Retrieved parsed transaction for ${latestSignature}`);

            const tokenTransfers = parsedTransaction.meta.postTokenBalances;
            if (!tokenTransfers || tokenTransfers.length < 2) {
                console.log(`⚠️ Transaction ${latestSignature} does not involve a valid swap.`);
                return;
            }

            let soldToken = null;
            let receivedToken = null;
            let txType = '';
            let txAmount = 0;

            const solTransfer = tokenTransfers.find(t => t.mint === WSOL_MINT);
            if (solTransfer) {
                const nonSolTransfer = tokenTransfers.find(t => t.mint !== solTransfer.mint);
                if (!nonSolTransfer) {
                    console.log(`⚠️ Could not determine trade direction for ${latestSignature}`);
                    return;
                }

                if (solTransfer.uiTokenAmount.uiAmount > nonSolTransfer.uiTokenAmount.uiAmount) {
                    soldToken = nonSolTransfer;
                    receivedToken = solTransfer;
                    txType = 'SELL';
                } else {
                    soldToken = solTransfer;
                    receivedToken = nonSolTransfer;
                    txType = 'BUY';
                }
            } else {
                console.log(`⚠️ No SOL detected in transaction ${latestSignature}, checking for token swaps.`);
                soldToken = tokenTransfers[0];
                receivedToken = tokenTransfers[1];
                txType = 'UNKNOWN_SWAP';
            }

            if (!soldToken || !receivedToken) {
                console.log(`❌ Invalid token swap data for transaction ${latestSignature}`);
                return;
            }

            txAmount = receivedToken.uiTokenAmount.uiAmount;
            console.log(`✅ Detected ${txType} - Sold: ${soldToken.mint} | Received: ${receivedToken.mint} | Amount: ${txAmount}`);

            await prisma.transaction.create({
                data: {
                    tokenBaseAddress: tokenMint,
                    type: txType,
                    amount: txAmount,
                    price: 0,
                    timestamp: new Date(),
                    token: {
                        connect: { baseAddress: tokenMint }  // ✅ Explicitly link to an existing Token
                    }
                },
            });

            console.log(`✅ Recorded ${txType} transaction for ${tokenMint} - Amount: ${txAmount}`);
        },
        'confirmed',
        [
            { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
            {
                memcmp: {
                    offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('baseMint'),  // ✅ Use `baseMint` (tokenMint) offset
                    bytes: BASE_MINT.toBase58(),
                },
            },
        ]
    );

    console.log(chalk.green(`✅ WebSocket monitoring started for pool: ${poolId}`));
}


/**
 * Parses token transfers from transaction logs.
 */
function parseTokenTransfersFromLogs(logs: string[], tokenMint: string): { mint: string; amount: number }[] {
    const tokenTransfers: { mint: string; amount: number }[] = [];

    // Example log format for token transfers:
    // "Program log: Transfer 1000000 tokens from <source> to <destination>"
    const transferLogPattern = /Transfer (\d+) tokens from (\w+) to (\w+)/;

    for (const log of logs) {
        const match = log.match(transferLogPattern);
        if (match) {
            const amount = parseFloat(match[1]);
            const source = match[2];
            const destination = match[3];

            // Check if the transfer involves the tokenMint
            if (source === tokenMint || destination === tokenMint) {
                tokenTransfers.push({
                    mint: tokenMint,
                    amount: source === tokenMint ? -amount : amount, // Negative for outgoing, positive for incoming
                });
            }
        }
    }

    return tokenTransfers;
}

/**
 * Determines the transaction type (BUY/SELL) based on token transfers.
 */
function determineTransactionType(tokenTransfers: { mint: string; amount: number }[], tokenMint: string): { type: 'BUY' | 'SELL' | null; amount: number } {
    let totalAmount = 0;

    for (const transfer of tokenTransfers) {
        if (transfer.mint === tokenMint) {
            totalAmount += transfer.amount;
        }
    }

    if (totalAmount > 0) {
        return { type: 'BUY', amount: totalAmount };
    } else if (totalAmount < 0) {
        return { type: 'SELL', amount: Math.abs(totalAmount) };
    } else {
        return { type: null, amount: 0 };
    }
}
    // ✅ Batch Processing Routine
    async function processBatch(tokenMint: string, connection: Connection, quoteMint: string, poolId: string) {
        const transactionQueue = activeQueues.get(tokenMint); // 🔥 Get queue for this token
    
        if (!transactionQueue || transactionQueue.length === 0) return;
    
        let isProcessing = true;
    
        while (transactionQueue.length > 0) {
            const batch = transactionQueue.splice(0, 90); // ✅ Get only 90 transactions
            console.log(chalk.yellow(`📡 Processing batch of ${batch.length} transactions for ${tokenMint}...`));
            
            const transactions = await fetchTransactions(batch);
            const batchResults = await processTransactions(transactions, tokenMint, quoteMint, poolId);
    
            if (batchResults) {
                await prisma.tokenMetrics.create({
                    data: {
                        tokenBaseAddress: tokenMint,
                        ...batchResults,
                        createdAt: new Date(),
                    },
                });
                console.log(chalk.green(`📊 Appended batch metrics for ${tokenMint}`));
            }
    
            // 🚨 **Break after one batch to ensure max 90 transactions per 15s cycle**
            break;
        }
    
        isProcessing = false;
    }
    

/**
 * Stops token monitoring and clears subscriptions.
 */
export async function stopTokenMonitoring(connection: Connection, tokenMint: string) {
    const subscriptionManager = SubscriptionManager.getInstance(connection);
    
    console.log(chalk.red(`🛑 Stopping token monitoring for ${tokenMint}`));

    // ❌ Stop WebSocket log monitoring
    await subscriptionManager.removeSubscription(tokenMint);

    // ❌ Clear timeout if exists
    if (activeMonitors.has(tokenMint)) {
        clearInterval(activeMonitors.get(tokenMint)!);
        activeMonitors.delete(tokenMint);
    }

    console.log(chalk.red(`🚨 Token monitoring stopped & token marked as FAILED: ${tokenMint}`));
}
