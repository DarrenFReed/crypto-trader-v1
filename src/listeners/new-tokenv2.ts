import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT } from '@solana/spl-token';
import { PrismaClient } from '@prisma/client';
import { gmgcBuy, gmgcSell } from '../trading/gmgcSwap'; // Import the gmgcBuy function
import { sleep } from '../helpers';
import { monitorBCPriceForEntry, monitorBCPriceForExit } from '../filters/bondingCurvePrice'; // Import the monitoring function
import { decodePumpFunTransaction } from '../filters/getDevBuy'; // Import the decoding function

const prisma = new PrismaClient();

// Configuration
const HELIUS_RPC_URL = "https://mainnet.helius-rpc.com/?api-key=d4a0e249-aecd-4f2f-9e05-a0985a90650a";
const PUMPFUN_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

// Default buy amount in SOL (e.g., 0.1 SOL in lamports)
const DEFAULT_BUY_AMOUNT = (0.001 * 1e9).toString();

// Create connection
const connection = new Connection(HELIUS_RPC_URL, "confirmed");


interface PumpFunBuyResult {
  solAmount: number;
  tokenAmount?: number;
  isBuy?: boolean;
  timestamp?: number;
}

async function getPumpFunBuyAmount(connection: Connection, txID: string): Promise<number> {
  // Fetch the transaction
  const tx = await connection.getTransaction(txID, {
    maxSupportedTransactionVersion: 0,
    commitment: 'confirmed'
  });

  if (!tx?.meta) throw new Error("Transaction metadata missing");

  // Find and decode the program data from the buy instruction
  if (tx.meta.logMessages) {
    // We need to find the specific "Program data" log that comes after "Instruction: Buy"
    let foundBuyInstruction = false;
    
    for (const log of tx.meta.logMessages) {
      // Mark when we find the Buy instruction
      if (log.includes('Instruction: Buy')) {
        foundBuyInstruction = true;
        continue;
      }
      
      // If we've found the Buy instruction and now we see Program data, this is our target
      if (foundBuyInstruction && log.includes('Program data:')) {
        const dataMatch = log.match(/Program data: (\S+)/);
        if (dataMatch) {
          try {
            const buffer = Buffer.from(dataMatch[1], 'base64');
            
            // In Pump.fun's data structure for buy transactions
            // The SOL amount is at offset 40 (bytes 40-48)
            if (buffer.length >= 48) {
              const solLamports = buffer.readBigUInt64LE(40);
              return Number(solLamports) / 1_000_000_000;
            }
          } catch (e) {
            console.error('Error parsing buffer:', e);
          }
        }
      }
    }
  }

  throw new Error("Could not find valid program data in transaction");
}


async function executeBuyOrder(connection: Connection, mintAddress: PublicKey, bondingCurveAddress: PublicKey) {
  try {
    console.log(`🛒 Executing buy order for token: ${mintAddress.toString()}`);
    
    // Execute the buy transaction using gmgcBuy with bondingCurveAddress
    const swapResult = await gmgcBuy(
      connection,
      NATIVE_MINT.toBase58(),         // Input (SOL/WSOL)
      mintAddress.toString(),         // Output (token to buy)
      DEFAULT_BUY_AMOUNT,             // Amount in lamports
      50,                             // 10% slippage
      bondingCurveAddress.toString()  // Bonding curve address
    );
    
    console.log(`✅ Buy transaction sent: ${swapResult.hash}`);
    
    // Wait for confirmation
    if (swapResult.confirmed) {
      console.log(`✅ Buy transaction confirmed!`);
      
      // Get token price and amount from tokenDetails
      if (swapResult.tokenDetails) {
        console.log(`📊 Bought ${Math.abs(swapResult.tokenDetails.tokenAmount)} tokens at ${swapResult.tokenDetails.price} SOL per token`);
      } else {
        console.log(`⚠️ Token details not available in swap result`);
      }
      
      return swapResult;
    } else {
      console.log(`❌ Buy transaction failed or expired`);
      return null;
    }
  } catch (error) {
    console.error(`Error executing buy order: ${error}`);
    return null;
  }
}

/**
 * Execute a sell order for a token using the enhanced gmgcSell function
 */
async function executeSellOrder(
  connection: Connection, 
  mintAddress: PublicKey, 
  bondingCurveAddress: PublicKey,
  tokenAmount: number
) {
  try {
    console.log(`💸 Executing sell order for token: ${mintAddress.toString()}`);
    console.log(`🔢 Selling ${tokenAmount} tokens`);
    // add rounding here

    const roundedTokenAmount = Math.round(tokenAmount);
    // Execute the sell transaction
    const swapResult = await gmgcSell(
      connection,
      mintAddress.toString(),         // Input (token to sell)
      NATIVE_MINT.toBase58(),         // Output (SOL/WSOL)
      roundedTokenAmount.toString(),         // Amount of tokens to sell
      50,                             // 15% slippage (higher for selling)
      undefined,                      // No input token account (will use bonding curve)
      bondingCurveAddress.toString()  // Bonding curve address
    );
    
    console.log(`✅ Sell transaction sent: ${swapResult.hash}`);
    
    // Wait for confirmation
    if (swapResult.confirmed) {
      console.log(`✅ Sell transaction confirmed!`);
      
      // Get token price and amount from tokenDetails
      if (swapResult.tokenDetails) {
        console.log(`📊 Sold ${Math.abs(swapResult.tokenDetails.tokenAmount)} tokens at ${swapResult.tokenDetails.price} SOL per token`);
      } else {
        console.log(`⚠️ Token details not available in swap result`);
      }
      
      return swapResult;
    } else {
      console.log(`❌ Sell transaction failed or expired`);
      return null;
    }
  } catch (error) {
    console.error(`Error executing sell order: ${error}`);
    return null;
  }
}

async function hasActiveToken(): Promise<boolean> {
  try {
    // Look for tokens that are BOUGHT but not SOLD
    const activeTokens = await prisma.pumpToken.findMany({
      where: {
        tokenStatus: 'BOUGHT',
        sellPrice: null // Not sold yet
      }
    });
    
    if (activeTokens.length > 0) {
      console.log(`🚫 Found ${activeTokens.length} active tokens already being tracked:`);
      for (const token of activeTokens) {
        console.log(`   - ${token.baseAddress} (Bought at ${token.boughtAt.toISOString()})`);
      }
      return true;
    }
    return false;

  } catch (error) {
    console.error('Error checking for active tokens:', error);
    // Default to true (has active token) to be safe
    return true;
  }
}

/**
 * Get the bonding curve address for a token mint
 */
function getBondingCurveAddress(mintAddress: PublicKey): PublicKey {
  const [bondingCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mintAddress.toBuffer()], 
    PUMPFUN_PROGRAM_ID
  );
  return bondingCurve;
}

/**
 * Check if a bonding curve exists for a token mint
 */
async function getBondingCurveDetails(mintAddress: PublicKey) {
  try {
    // Get bonding curve PDA
    const bondingCurveAddress = getBondingCurveAddress(mintAddress);
    console.log(`📈 Bonding Curve Address: ${bondingCurveAddress.toString()}`);
    
    // Fetch the bonding curve account data
    const bondingCurveAccount = await connection.getAccountInfo(bondingCurveAddress);
    
    if (!bondingCurveAccount) {
      console.log("❌ Bonding curve account not found");
      return null;
    }
    
    console.log(`✅ Bonding curve found: ${bondingCurveAccount.data.length} bytes`);
    
    return {
      address: bondingCurveAddress,
      exists: true
    };
  } catch (error) {
    console.error(`Error fetching bonding curve: ${error}`);
    return null;
  }
}

/**
 * Extract mint address from transaction logs
 */
async function extractMintAddressFromLogs(logs: string[], signature: string): Promise<PublicKey | null> {
  // First try to extract from logs
  for (const log of logs) {
    const mintMatch = log.match(/mint: ([1-9A-HJ-NP-Za-km-z]{32,44})/);
    if (mintMatch && mintMatch[1]) {
      try {
        return new PublicKey(mintMatch[1]);
      } catch (error) {
        console.error("Invalid mint address format");
      }
    }
  }
  
  // If not found in logs, try to get from transaction
  try {
    const tx = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });
    
    if (tx && tx.meta && tx.meta.postTokenBalances) {
      const potentialMints = tx.meta.postTokenBalances.map(item => item.mint);
      if (potentialMints.length > 0) {
        return new PublicKey(potentialMints[0]);
      }
    }
  } catch (error) {
    console.error(`Error fetching transaction: ${error}`);
  }
  
  return null;
}

// Track processed transactions to avoid duplicates
const processedTransactions = new Set<string>();
let isProcessingToken = false;
let useLogMonitoring = true;

// Main monitoring function
(async function () {
  
    const subscriptionId = connection.onLogs(PUMPFUN_PROGRAM_ID, async (logInfo, ctx) => {
      const { logs, signature } = logInfo;
      
      // Skip if already processed
      if (processedTransactions.has(signature)) {
        return;
      }
      processedTransactions.add(signature);
      
      // Check the global lock first - this is faster than a DB query
      if (isProcessingToken) {
        //console.log(`⏸️ Skipping new token detection because we're already processing another token`);
        return;
      }

      try {
        // Set processing flag once at the beginning of try block
        isProcessingToken = true;
        
        // Check database for active tokens
        const activeToken = await prisma.pumpToken.findFirst({
          where: { 
            tokenStatus: { 
              in: ['DETECTED', 'BUYING', 'BOUGHT'] 
            } 
          }
        });
        
        if (activeToken) {
          console.log(`⏸️ Skipping new token detection because we already have an active token`);
          return;
        }
        

        // Look for new token creation in logs
        let foundNewToken = false;
        for (const log of logs) {
          if (log.includes("Create Metadata Accounts v3")) {
            foundNewToken = true;
            console.log("🚀 New token detected!");
            console.log(`🔗 https://solscan.io/tx/${signature}`);
            break;
          }
        }
        //call to test if owner bought enough tokens



        if (!foundNewToken) {
          return; // No new token found, exit early
        }
        
        const ownerInvested = await getPumpFunBuyAmount(connection, signature);
        if (ownerInvested < 2) {
          console.log(`❌ Owner did not invest enough SOL ${ownerInvested} SOL to proceed`);
          return;
        }
        
        console.log(`💸 Owner invested ${ownerInvested} SOL, proceeding with token purchase`);
        
        console.log("🔍 Extracting mint address...");
        
        // Extract the mint address from logs or transaction
        const mintAddress = await extractMintAddressFromLogs(logs, signature);
        
        if (!mintAddress) {
          console.log("⚠️ Could not determine mint address, skipping purchase");
          return;
        }
        
        console.log(`💰 Token Mint Address: ${mintAddress.toString()}`);
        
        
        


      // Check if we already have this token in our database
      const existingToken = await prisma.pumpToken.findUnique({
        where: { baseAddress: mintAddress.toString() }
      });
      
      if (existingToken) {
        console.log(`⚠️ Token already in database with status: ${existingToken.tokenStatus}, skipping purchase`);
        return;
      }
      
      // Get bonding curve details to verify it's a valid token
      const bondingCurveDetails = await getBondingCurveDetails(mintAddress);
      
      if (!bondingCurveDetails) {
        console.log("⚠️ No bonding curve found, skipping purchase");
        return;
      }
      
      console.log("📊 Bonding curve found, token is valid");
      console.log(`🧮 Bonding curve address: ${bondingCurveDetails.address.toString()}`);
      
      // Create initial token record with DETECTED status
      await prisma.pumpToken.create({
        data: {
          baseAddress: mintAddress.toString(),
          tokenStatus: 'DETECTED',
          detectedAt: new Date(),
          boughtAt: new Date(), // Will update after purchase
          buyPrice: 0,
          buyTxHash: ''
        }
      });
      
      console.log(`✅ Token added to database with DETECTED status`);
      
      // Add a small delay to ensure the token is fully initialized before buying
      await sleep(0);
      
      // Monitor for entry conditions
      let skipEntryMonitor = false;
      let entryResult;
      if (skipEntryMonitor) {
        console.log(`🐞 DEBUG: Skipping entry monitor and proceeding directly to purchase`);
        entryResult = { 
          entryFound: true, 
          tokenPrice: 0.000001, // Default debug price
          debugMode: true 
        };
      } else {
        console.log(`🔍 Monitoring for entry conditions...`);
        entryResult = await monitorBCPriceForEntry(connection, mintAddress, bondingCurveDetails.address);
      }

      if (entryResult && entryResult.entryFound) {
        console.log(`🎯 Entry condition met at price: ${entryResult.tokenPrice}`);
        
        // Update token status to BUYING
        await prisma.pumpToken.update({
          where: { baseAddress: mintAddress.toString() },
          data: { tokenStatus: 'BUYING' }
        });
        
        // Execute buy order
        const buyResult = await executeBuyOrder(connection, mintAddress, bondingCurveDetails.address);
        
        if (buyResult && buyResult.confirmed) {
          const buyPrice = buyResult.tokenDetails?.price || 0;
          const tokenAmount = Math.abs(buyResult.tokenDetails?.tokenAmount || 0);
          
          // Update token with buy information
          await prisma.pumpToken.update({
            where: { baseAddress: mintAddress.toString() },
            data: {
              tokenStatus: 'BOUGHT',
              boughtAt: new Date(),
              buyPrice: buyPrice,
              buyTxHash: buyResult.hash
            }
          });
          
          console.log(`✅ Updated token status to BOUGHT with price: ${buyPrice}`);
          
          // Start monitoring for exit conditions
          console.log(`🔍 Starting exit price monitor...`);
          const exitResult = await monitorBCPriceForExit(
            connection, 
            mintAddress, 
            bondingCurveDetails.address,
            buyPrice
          );
          
          if (exitResult === "sell token" || exitResult === "timeout") {
            console.log(`🔔 Exit condition met, executing sell order`);
            
            const tokenAmountInLamports = tokenAmount * 1e6;

            // Execute sell order
            const sellResult = await executeSellOrder(
              connection,
              mintAddress,
              bondingCurveDetails.address,
              tokenAmountInLamports
            );
            
            if (sellResult && sellResult.confirmed) {
              const sellPrice = sellResult.tokenDetails?.price || 0;
              const profit = ((sellPrice / buyPrice) - 1) * 100;
              
              // Update token with sell information
              await prisma.pumpToken.update({
                where: { baseAddress: mintAddress.toString() },
                data: {
                  tokenStatus: 'SOLD',
                  sellPrice: sellPrice,
                  sellTxHash: sellResult.hash,
                  profit: profit
                }
              });
              
              console.log(`✅ Token sold with profit: ${profit.toFixed(2)}%`);
            } else {
              console.error(`❌ Sell transaction failed`);
            }
          }
        } else {
          console.error(`❌ Buy transaction failed, updating token status`);
          await prisma.pumpToken.update({
            where: { baseAddress: mintAddress.toString() },
            data: { tokenStatus: 'FAILED' }
          });
        }
      } else {
        console.log(`❌ Entry conditions not met, skipping purchase`);
        await prisma.pumpToken.update({
          where: { baseAddress: mintAddress.toString() },
          data: { tokenStatus: 'SKIPPED' }
        });
      }
    } catch (error) {
      console.error(`Error processing token: ${error.message}`);
      // Include stack trace for debugging
      console.debug(error.stack);
    } finally {
      // Release the lock regardless of success or failure
      isProcessingToken = false;
    }
  }, "confirmed");

  console.log(`🧩 Subscribed to Pump.fun logs (Subscription ID: ${subscriptionId})`);
  
  // Keep process running
  process.on('SIGINT', async () => {
    console.log('Gracefully shutting down...');
    // Unsubscribe from logs
    await connection.removeOnLogsListener(subscriptionId);
    // Close prisma connection
    await prisma.$disconnect();
    process.exit(0);
  });
})();



export async function tgTrade(tokenMint: string) {
  const mintAddress = new PublicKey(tokenMint);

  // Check the global lock first - this is faster than a DB query
  if (isProcessingToken) {
    //console.log(`⏸️ Skipping new token detection because we're already processing another token`);
    return;
  }

  try {
    // Set processing flag once at the beginning of try block
    isProcessingToken = true;
    
    // Check database for active tokens
    const activeToken = await prisma.pumpToken.findFirst({
      where: { 
        tokenStatus: { 
          in: ['DETECTED', 'BUYING', 'BOUGHT'] 
        } 
      }
    });
    
    if (activeToken) {
      console.log(`⏸️ Skipping new token detection because we already have an active token`);
      return;
    }
     
    console.log(`💰 Token Mint Address: ${mintAddress.toString()}`);
    
    // Check if we already have this token in our database
    const existingToken = await prisma.pumpToken.findUnique({
      where: { baseAddress: mintAddress.toString() }
    });
    
    if (existingToken) {
      console.log(`⚠️ Token already in database with status: ${existingToken.tokenStatus}, skipping purchase`);
      return;
    }
    
    // Get bonding curve details to verify it's a valid token
    const bondingCurveDetails = await getBondingCurveDetails(mintAddress);
    
    if (!bondingCurveDetails) {
      console.log("⚠️ No bonding curve found, skipping purchase");
      return;
    }
    
    console.log("📊 Bonding curve found, token is valid");
    console.log(`🧮 Bonding curve address: ${bondingCurveDetails.address.toString()}`);
    
    // Create initial token record with DETECTED status
    await prisma.pumpToken.create({
      data: {
        baseAddress: mintAddress.toString(),
        tokenStatus: 'DETECTED',
        detectedAt: new Date(),
        boughtAt: new Date(), // Will update after purchase
        buyPrice: 0,
        buyTxHash: ''
      }
    });
    
    console.log(`✅ Token added to database with DETECTED status`);
    
    // Add a small delay to ensure the token is fully initialized before buying
    await sleep(0);
    
    // Monitor for entry conditions
    let skipEntryMonitor = false;
    let entryResult;
    if (skipEntryMonitor) {
      console.log(`🐞 DEBUG: Skipping entry monitor and proceeding directly to purchase`);
      entryResult = { 
        entryFound: true, 
        tokenPrice: 0.000001, // Default debug price
        debugMode: true 
      };
    } else {
      console.log(`🔍 Monitoring for entry conditions...`);
      entryResult = await monitorBCPriceForEntry(connection, mintAddress, bondingCurveDetails.address);
    }

    if (entryResult && entryResult.entryFound) {
      console.log(`🎯 Entry condition met at price: ${entryResult.tokenPrice}`);
      
      // Update token status to BUYING
      await prisma.pumpToken.update({
        where: { baseAddress: mintAddress.toString() },
        data: { tokenStatus: 'BUYING' }
      });
      
      // Execute buy order
      const buyResult = await executeBuyOrder(connection, mintAddress, bondingCurveDetails.address);
      
      if (buyResult && buyResult.confirmed) {
        const buyPrice = buyResult.tokenDetails?.price || 0;
        const tokenAmount = Math.abs(buyResult.tokenDetails?.tokenAmount || 0);
        
        // Update token with buy information
        await prisma.pumpToken.update({
          where: { baseAddress: mintAddress.toString() },
          data: {
            tokenStatus: 'BOUGHT',
            boughtAt: new Date(),
            buyPrice: buyPrice,
            buyTxHash: buyResult.hash
          }
        });
        
        console.log(`✅ Updated token status to BOUGHT with price: ${buyPrice}`);
        
        // Start monitoring for exit conditions
        console.log(`🔍 Starting exit price monitor...`);
        const exitResult = await monitorBCPriceForExit(
          connection, 
          mintAddress, 
          bondingCurveDetails.address,
          buyPrice
        );
        
        if (exitResult === "sell token" || exitResult === "timeout") {
          console.log(`🔔 Exit condition met, executing sell order`);
          
          const tokenAmountInLamports = tokenAmount * 1e6;

          // Execute sell order
          const sellResult = await executeSellOrder(
            connection,
            mintAddress,
            bondingCurveDetails.address,
            tokenAmountInLamports
          );
          
          if (sellResult && sellResult.confirmed) {
            const sellPrice = sellResult.tokenDetails?.price || 0;
            const profit = ((sellPrice / buyPrice) - 1) * 100;
            
            // Update token with sell information
            await prisma.pumpToken.update({
              where: { baseAddress: mintAddress.toString() },
              data: {
                tokenStatus: 'SOLD',
                sellPrice: sellPrice,
                sellTxHash: sellResult.hash,
                profit: profit
              }
            });
            
            console.log(`✅ Token sold with profit: ${profit.toFixed(2)}%`);
          } else {
            console.error(`❌ Sell transaction failed`);
          }
        }
      } else {
        console.error(`❌ Buy transaction failed, updating token status`);
        await prisma.pumpToken.update({
          where: { baseAddress: mintAddress.toString() },
          data: { tokenStatus: 'FAILED' }
        });
      }
    } else {
      console.log(`❌ Entry conditions not met, skipping purchase`);
      await prisma.pumpToken.update({
        where: { baseAddress: mintAddress.toString() },
        data: { tokenStatus: 'SKIPPED' }
      });
    }
  } catch (error) {
    console.error(`Error processing token: ${error.message}`);
    // Include stack trace for debugging
    console.debug(error.stack);
  } finally {
    // Release the lock regardless of success or failure
    isProcessingToken = false;
  }
}