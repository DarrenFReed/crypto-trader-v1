import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import BN from "bn.js"; // Make sure to install this package
import * as splToken from '@solana/spl-token';
import { gmgcSell } from './gmgcSwap'; // Import the sell function
import { isProcessingToken } from '../listeners/new-tokenv2';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Configuration
const HELIUS_RPC_URL = "https://mainnet.helius-rpc.com/?api-key=d4a0e249-aecd-4f2f-9e05-a0985a90650a";
const connection = new Connection(HELIUS_RPC_URL, "confirmed");

// Default profit/loss thresholds for auto-selling
const DEFAULT_PROFIT_TARGET = 10; // Sell at 30% profit
const DEFAULT_STOP_LOSS = -5;    // Sell at 10% loss
const DEFAULT_MAX_HOLD_TIME = 180000; // 

// Track active monitoring instances
const activeMonitors = new Map();

// Struct layout for bonding curve data (based on the provided Python example)
async function fetchBondingCurveData(bondingCurveAddress) {
  try {
    const accountInfo = await connection.getAccountInfo(bondingCurveAddress);
    
    if (!accountInfo) {
      console.error("Bonding curve account not found");
      return null;
    }
    
    // Manual parsing based on the Python struct definition
    // Each field is Int64ul (8 bytes)
    const dataBuffer = accountInfo.data;
    
    // JavaScript doesn't have native 64-bit integers, so we use BN.js
    const virtualTokenReserves = new BN(dataBuffer.slice(0, 8), 'le');
    const virtualSolReserves = new BN(dataBuffer.slice(8, 16), 'le');
    const realTokenReserves = new BN(dataBuffer.slice(16, 24), 'le');
    const realSolReserves = new BN(dataBuffer.slice(24, 32), 'le');
    const tokenTotalSupply = new BN(dataBuffer.slice(32, 40), 'le');
    
    return {
      virtualTokenReserves,
      virtualSolReserves,
      realTokenReserves,
      realSolReserves,
      tokenTotalSupply
    };
  } catch (error) {
    console.error(`Error fetching bonding curve data: ${error}`);
    return null;
  }
}

// Calculate token price using the formula that matches Photon's display
function calculateTokenPrice(bondingCurveData) {
  const { virtualTokenReserves, virtualSolReserves, realTokenReserves } = bondingCurveData;
  
  // Convert BN to string and then to number for easier calculation
  const vSolReserves = Number(virtualSolReserves.toString());
  const rTokenReserves = Number(realTokenReserves.toString());
  
  // This matches the Photon price display format
  const tokenPrice = rTokenReserves / vSolReserves;
  
  return tokenPrice;
}

// Function to get unique wallet owners of a token
async function getUniqueWalletOwners(mintAddress) {
  try {
    // Get largest token accounts for this mint (this gives us accounts with balances)
    const tokenAccounts = await connection.getTokenLargestAccounts(mintAddress);
    
    // Filter accounts with non-zero balance
    const accountsWithBalance = tokenAccounts.value.filter(account => 
      account.amount !== '0' && 
      account.uiAmount > 0
    );
    
    // Prepare for counting statistics
    let totalHolders = accountsWithBalance.length;
    let totalTokensHeld = accountsWithBalance.reduce((sum, acc) => 
      sum + acc.uiAmount, 0
    );
    
    // If no accounts with balance, return early
    if (totalHolders === 0) {
      return {
        uniqueOwners: new Set(),
        uniqueOwnerCount: 0,
        totalHolders: 0,
        totalTokensHeld: 0
      };
    }
    
    // Get all accounts in a single batch request
    const accountAddresses = accountsWithBalance.map(acc => acc.address);
    const accountInfos = await connection.getMultipleAccountsInfo(accountAddresses);
    
    // Set to store unique owners
    const uniqueOwners = new Set();
    
    // Process each account to extract its owner
    for (let i = 0; i < accountInfos.length; i++) {
      const accountInfo = accountInfos[i];
      
      if (accountInfo && accountInfo.data) {
        // Parse the token account data to extract the owner
        // The owner is stored at byte offset 32 (after the mint) and is 32 bytes long
        const ownerPublicKey = new PublicKey(accountInfo.data.slice(32, 64));
        uniqueOwners.add(ownerPublicKey.toString());
      }
    }
    
    return {
      uniqueOwners: uniqueOwners,
      uniqueOwnerCount: uniqueOwners.size,
      totalHolders,
      totalTokensHeld
    };
  } catch (error) {
    console.error(`Error fetching unique wallet owners: ${error}`);
    return {
      uniqueOwners: new Set(),
      uniqueOwnerCount: 0,
      totalHolders: 0,
      totalTokensHeld: 0
    };
  }
}

// Function to calculate how many tokens you would get for X SOL
function calculateTokensForSol(bondingCurveData, solAmount) {
  const { virtualSolReserves, realTokenReserves } = bondingCurveData;
  
  // Convert to numbers
  const vSolReserves = Number(virtualSolReserves.toString());
  const rTokenReserves = Number(realTokenReserves.toString());
  
  // Convert SOL amount to lamports
  const solInLamports = solAmount * 1e9;
  
  // Using the constant product formula mentioned in the StackOverflow answer
  const tokensOut = (solInLamports * vSolReserves) / (rTokenReserves + solInLamports);
  
  return tokensOut;
}

// Function to calculate amount parameter for swap instruction
function calculateAmountForSwap(bondingCurveData, solAmount) {
  const { virtualSolReserves, realTokenReserves } = bondingCurveData;
  
  // Convert to numbers
  const vSolReserves = Number(virtualSolReserves.toString());
  const rTokenReserves = Number(realTokenReserves.toString());
  
  // Convert SOL amount to lamports
  const solInLamports = solAmount * 1e9;
  
  // Calculate the amount parameter for swap instruction
  // amount = int((sol_in_lamports * virtual_sol_reserves) / (real_token_reserves + sol_in_lamports))
  const amount = Math.floor((solInLamports * vSolReserves) / (rTokenReserves + solInLamports));
  
  return amount;
}

// Format the price in a human-readable format
function formatPrice(price) {
  if (price >= 1e-4) {
    // For larger numbers, use fixed decimal notation
    return price.toFixed(7);
  } else {
    // For smaller numbers, count leading zeros and format specially
    const zeros = -Math.floor(Math.log10(price)) - 1;
    if (zeros <= 9) {
      // Standard decimal format for small numbers
      return price.toFixed(zeros + 4);
    } else {
      // Scientific notation for very small numbers
      return price.toExponential(4);
    }
  }
}

// Execute sell order
async function executeSellOrder(mintAddress: PublicKey, tokenAmount: number, reason: string, purchasePrice: number = 0) {
  try {
    console.log(`🔄 Executing sell order for ${mintAddress.toString()}`);
    console.log(`📝 Reason: ${reason}`);
    
    // Get wallet public key from environment variable
    const publicKeyStr = process.env.PUBLIC_KEY;
    if (!publicKeyStr) {
      throw new Error("PUBLIC_KEY environment variable is not set");
    }
    
    // Get associated token account for this token
    const walletPublicKey = new PublicKey(publicKeyStr);
    const tokenAccount = await splToken.getAssociatedTokenAddress(
      mintAddress,
      walletPublicKey
    );
    
    // Sell tokens using the gmgcSell function
    const sellResult = await gmgcSell(
      connection,
      mintAddress.toString(), // Input token (the bonding curve token)
      splToken.NATIVE_MINT.toBase58(), // Output token (SOL)
      (tokenAmount * 1e9).toString(), // Amount in token base units
      10, // 10% slippage
      tokenAccount.toString(), // Token account
      true // This is a bonding curve token
    );
    
    console.log(`📬 Sell transaction sent: ${sellResult.hash}`);
    
    if (sellResult.confirmed) {
      console.log(`✅ Sell transaction confirmed!`);
      
      // Calculate profit percentage
      const sellPrice = sellResult.price;
      const profitPercentage = ((sellPrice - purchasePrice) / purchasePrice) * 100;
      const profitAmount = sellPrice * tokenAmount - purchasePrice * tokenAmount;
      
      console.log(`💰 Sold at ${sellPrice} SOL per token`);
      console.log(`📊 Profit: ${profitPercentage.toFixed(2)}% (${profitAmount.toFixed(6)} SOL)`);
      
      // Update database with sell information
      try {
        await prisma.pumpToken.update({
          where: { baseAddress: mintAddress.toString() },
          data: {
            tokenStatus: 'SOLD',
            sellPrice: sellPrice,
            sellTxHash: sellResult.hash,
            profit: profitAmount
          }
        });
        console.log(`💾 Updated database with sell information`);
        
        // Release the lock after successful sell
        if (typeof isProcessingToken !== 'undefined') {
          isProcessingToken = false;
          console.log(`🔓 Released token processing lock`);
        }
      } catch (dbError) {
        console.error(`Error updating database: ${dbError}`);
      }
      
      return true;
    } else {
      console.log(`❌ Sell transaction failed or expired`);
      return false;
    }
  } catch (error) {
    console.error(`Error executing sell order: ${error}`);
    return false;
  }
}

// Export monitoring function that can be called from outside
export function startMonitoring({
  mintAddress,
  bondingCurveAddress,
  purchasePrice,
  purchaseAmount,
  purchaseTxHash,
  profitTarget = DEFAULT_PROFIT_TARGET,
  stopLoss = DEFAULT_STOP_LOSS,
  maxHoldTime = DEFAULT_MAX_HOLD_TIME
}) {
  // Validate inputs
  if (!mintAddress || !bondingCurveAddress) {
    console.error("Missing required parameters: mintAddress and bondingCurveAddress");
    return false;
  }
  
  // Convert string addresses to PublicKey objects if they're not already
  const mintPubkey = typeof mintAddress === 'string' ? new PublicKey(mintAddress) : mintAddress;
  const bondingCurvePubkey = typeof bondingCurveAddress === 'string' ? 
    new PublicKey(bondingCurveAddress) : bondingCurveAddress;
  
  // Use toString to get consistent keys for the Map
  const mintAddressStr = mintPubkey.toString();
  
  // Check if we're already monitoring this token
  if (activeMonitors.has(mintAddressStr)) {
    console.log(`Already monitoring token ${mintAddressStr}, updating parameters`);
    // Update the existing monitor with new parameters
    const monitor = activeMonitors.get(mintAddressStr);
    if (purchasePrice) monitor.purchaseInfo.price = purchasePrice;
    if (purchaseAmount) monitor.purchaseInfo.amount = purchaseAmount;
    if (purchaseTxHash) monitor.purchaseInfo.txHash = purchaseTxHash;
    monitor.profitTarget = profitTarget;
    monitor.stopLoss = stopLoss;
    monitor.maxHoldTime = maxHoldTime;
    return true;
  }
  
  console.log(`🔍 Starting bonding curve monitor for token ${mintAddressStr}`);
  console.log(`📈 Bonding curve: ${bondingCurvePubkey.toString()}`);
  
  if (purchasePrice) {
    console.log(`💰 Purchase details: ${purchaseAmount} tokens at ${purchasePrice} SOL per token`);
    console.log(`🧾 Transaction: ${purchaseTxHash}`);
  }
  
  // Create monitor object to track this token
  const monitorInfo = {
    mintAddress: mintPubkey,
    bondingCurveAddress: bondingCurvePubkey,
    purchaseInfo: {
      price: purchasePrice || 0,
      amount: purchaseAmount || 0,
      txHash: purchaseTxHash,
      timestamp: new Date()
    },
    priceHistory: [] as Array<{timestamp: number, price: number}>,
    profitTarget,
    stopLoss,
    maxHoldTime,
    lastChecked: null,
    intervalId: null,
    active: true
  };
  
  // First check to make sure the bonding curve exists
  fetchBondingCurveData(bondingCurvePubkey).then(initialData => {
    if (!initialData) {
      console.error(`❌ Could not fetch initial bonding curve data for ${mintAddressStr}. Check the address.`);
      // Release lock if we can't fetch the bonding curve
      if (typeof isProcessingToken !== 'undefined') {
        isProcessingToken = false;
        console.log(`🔓 Released token processing lock due to missing bonding curve`);
      }
      return;
    }
    
    console.log(`✅ Successfully connected to bonding curve, starting price monitor`);
    
    // Set up interval to check price every 1 second (changed from 10 seconds)
    const intervalId = setInterval(async () => {
      if (!monitorInfo.active) {
        clearInterval(intervalId);
        return;
      }
      
      try {
        // Get current bonding curve data
        const bondingCurveData = await fetchBondingCurveData(bondingCurvePubkey);
        
        if (!bondingCurveData) {
          console.log(`❌ Could not fetch bonding curve data for ${mintAddressStr}`);
          return;
        }
        
        // Calculate current price
        const currentPrice = calculateTokenPrice(bondingCurveData);
        
        // Update price history
        monitorInfo.priceHistory.push({
          timestamp: Date.now(),
          price: currentPrice
        });
        
        // Keep history limited to 10 items (about 10 seconds of data with 1-second interval)
        if (monitorInfo.priceHistory.length > 10) {
          monitorInfo.priceHistory.shift();
        }
        
        // Calculate profit/loss percentage
        let profitPercentage = 0;
        if (monitorInfo.purchaseInfo.price > 0) {
          profitPercentage = ((currentPrice - monitorInfo.purchaseInfo.price) / monitorInfo.purchaseInfo.price) * 100;
        }
        
        // Calculate price change percentage based on history
        let priceChangePercent = 0;
        if (monitorInfo.priceHistory.length > 1) {
          const oldestPrice = monitorInfo.priceHistory[0].price;
          priceChangePercent = ((currentPrice - oldestPrice) / oldestPrice) * 100;
        }
        
        // Calculate holding time
        const holdingTimeMs = Date.now() - monitorInfo.purchaseInfo.timestamp.getTime();
        const holdingTimeMin = Math.floor(holdingTimeMs / 60000);
        
        console.log(`\n=== ${mintAddressStr} MONITORING UPDATE ===`);
        console.log(`Time: ${new Date().toISOString()}`);
        console.log(`Current Price: ${formatPrice(currentPrice)} SOL (${currentPrice.toExponential(7)})`);
        
        if (monitorInfo.purchaseInfo.price > 0) {
          console.log(`Purchase Price: ${formatPrice(monitorInfo.purchaseInfo.price)} SOL`);
          console.log(`Profit/Loss: ${profitPercentage.toFixed(2)}%`);
          console.log(`Holding Time: ${holdingTimeMin} minutes`);
        }
        
        console.log(`Recent Price Change (last samples): ${priceChangePercent.toFixed(2)}%`);
        
        // Check if we should sell based on criteria
        let shouldSell = false;
        let sellReason = '';
        
        if (monitorInfo.purchaseInfo.amount > 0) {
          if (profitPercentage >= monitorInfo.profitTarget) {
            shouldSell = true;
            sellReason = `Profit target reached (${profitPercentage.toFixed(2)}%)`;
          } else if (profitPercentage <= monitorInfo.stopLoss) {
            shouldSell = true;
            sellReason = `Stop loss triggered (${profitPercentage.toFixed(2)}%)`;
          } else if (holdingTimeMs >= monitorInfo.maxHoldTime) {
            shouldSell = true;
            sellReason = `Maximum holding time reached (${holdingTimeMin} minutes)`;
          }
          
          if (shouldSell) {
            console.log(`\n🚨 SELL SIGNAL: ${sellReason}`);
            
            // Execute sell order
            const sellSuccess = await executeSellOrder(
              mintPubkey, 
              monitorInfo.purchaseInfo.amount,
              sellReason,
              monitorInfo.purchaseInfo.price  // Pass purchase price for profit calculation
            );
            
            if (sellSuccess) {
              console.log(`✅ Successfully sold ${mintAddressStr}`);
              
              // Stop monitoring this token
              monitorInfo.active = false;
              activeMonitors.delete(mintAddressStr);
              clearInterval(intervalId);
            }
          }
        }
        
        // Update last checked timestamp
        monitorInfo.lastChecked = new Date();
        
      } catch (error) {
        console.error(`Error monitoring ${mintAddressStr}: ${error}`);
      }
    }, 1000); // Check every 1 second (changed from 10000)
    
    // Store the interval ID
    monitorInfo.intervalId = intervalId;
    
    // Store the monitor in the active monitors map
    activeMonitors.set(mintAddressStr, monitorInfo);
  });
  
  return true;
}

// The original monitorBondingCurvePrice function (keeping for reference)
async function monitorBondingCurvePrice() {
  // Hardcoded bonding curve account ID - replace with your actual bonding curve address
  const BONDING_CURVE_ADDRESS = new PublicKey("4F9SjfXLqPA9v7PnKQtYAB6ZK2LNi7sDCBvmUputKFie");
  
  // You'll need to set the mint address associated with this bonding curve
  const MINT_ADDRESS = new PublicKey("Cjmobh1vTTYYgBmmadKR18Z7gytGGRa4u47s26FaFuPM");
  
  console.log("Starting bonding curve price monitor...");
  console.log(`Monitoring bonding curve at address: ${BONDING_CURVE_ADDRESS.toString()}`);
  console.log(`Token mint address: ${MINT_ADDRESS.toString()}`);
  
  // First fetch to make sure the bonding curve exists
  const initialData = await fetchBondingCurveData(BONDING_CURVE_ADDRESS);
  if (!initialData) {
    console.error("❌ Could not fetch initial bonding curve data. Please check the address and try again.");
    return;
  }
  
  // Track price history to calculate change
  let priceHistory = [];
  const MAX_HISTORY = 10; // Store last 10 price points (20 seconds of data)
  
  // Set interval to run every 2 seconds
  setInterval(async () => {
    try {
      // Get bonding curve data
      const bondingCurveData = await fetchBondingCurveData(BONDING_CURVE_ADDRESS);
      
      if (!bondingCurveData) {
        console.log("❌ Could not fetch bonding curve data");
        return;
      }
      
      const tokenPrice = calculateTokenPrice(bondingCurveData);
      
      // Update price history
      priceHistory.push({
        timestamp: Date.now(),
        price: tokenPrice
      });
      
      // Keep history limited to MAX_HISTORY items
      if (priceHistory.length > MAX_HISTORY) {
        priceHistory.shift();
      }
      
      // Calculate price change percentage if we have enough history
      let priceChangePercent = 0;
      if (priceHistory.length > 1) {
        const oldestPrice = priceHistory[0].price;
        priceChangePercent = ((tokenPrice - oldestPrice) / oldestPrice) * 100;
      }
      
      // Get unique wallet data (do this less frequently as it's more expensive)
      // We'll do this every 10 seconds instead of every 2 seconds
      let walletData = null;
      if (priceHistory.length % 5 === 0) {
        walletData = await getUniqueWalletOwners(MINT_ADDRESS);
      }
      
      // Calculate some example amounts for reference
      const tokensFor001Sol = calculateTokensForSol(bondingCurveData, 0.001);
      const tokensFor01Sol = calculateTokensForSol(bondingCurveData, 0.1);
      const tokensFor1Sol = calculateTokensForSol(bondingCurveData, 1);
      
      // Calculate the amount parameter for swap instruction for these amounts
      const amountFor001Sol = calculateAmountForSwap(bondingCurveData, 0.001);
      const amountFor01Sol = calculateAmountForSwap(bondingCurveData, 0.1);
      const amountFor1Sol = calculateAmountForSwap(bondingCurveData, 1);
      
      console.log("\n=== BONDING CURVE STATUS ===");
      console.log(`Time: ${new Date().toISOString()}`);
      console.log(`Virtual Token Reserves: ${bondingCurveData.virtualTokenReserves.toString()}`);
      console.log(`Virtual SOL Reserves: ${bondingCurveData.virtualSolReserves.toString()}`);
      console.log(`Real Token Reserves: ${bondingCurveData.realTokenReserves.toString()}`);
      console.log(`Real SOL Reserves: ${bondingCurveData.realSolReserves.toString()}`);
      console.log(`Token Total Supply: ${bondingCurveData.tokenTotalSupply.toString()}`);
      
      console.log(`\nToken Price: ${formatPrice(tokenPrice)} SOL per token (${tokenPrice.toExponential(7)})`);
      console.log(`Price change (${MAX_HISTORY * 2} sec): ${priceChangePercent.toFixed(2)}%`);
      
      // Display wallet data if available
      if (walletData) {
        console.log("\n=== HOLDER STATISTICS ===");
        console.log(`Unique wallet owners: ${walletData.uniqueOwnerCount}`);
        console.log(`Total holders: ${walletData.totalHolders}`);
        console.log(`Total tokens held: ${walletData.totalTokensHeld}`);
      }
      
      console.log("\n=== TRANSACTION EXAMPLES ===");
      console.log(`For 0.001 SOL, you would get approximately ${tokensFor001Sol.toFixed(6)} tokens`);
      console.log(`For 0.1 SOL, you would get approximately ${tokensFor01Sol.toFixed(6)} tokens`);
      console.log(`For 1 SOL, you would get approximately ${tokensFor1Sol.toFixed(6)} tokens`);
      
      console.log("\n=== SWAP INSTRUCTION PARAMETERS ===");
      console.log(`For 0.001 SOL, use amount = ${amountFor001Sol} in swap instruction`);
      console.log(`For 0.1 SOL, use amount = ${amountFor01Sol} in swap instruction`);
      console.log(`For 1 SOL, use amount = ${amountFor1Sol} in swap instruction`);
      console.log("===========================");
      
    } catch (error) {
      console.error(`Error in monitoring: ${error}`);
    }
  }, 2000);
}

// If this file is run directly, start the hardcoded monitor
