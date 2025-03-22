import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT } from '@solana/spl-token';
import { PrismaClient } from '@prisma/client';
import { gmgcBuy } from '../trading/gmgcSwap'; // Import the gmgcBuy function
import { sleep } from '../helpers';

const prisma = new PrismaClient();

// Configuration
const HELIUS_RPC_URL = "https://mainnet.helius-rpc.com/?api-key=d4a0e249-aecd-4f2f-9e05-a0985a90650a";
const PUMPFUN_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

// Default buy amount in SOL (e.g., 0.1 SOL in lamports)
const DEFAULT_BUY_AMOUNT = (0.001 * 1e9).toString();

// Create connection
const connection = new Connection(HELIUS_RPC_URL, "confirmed");

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

/**
 * Execute buy order for a token
 */
async function executeBuyOrder(mintAddress: PublicKey) {
  try {
    console.log(`🛒 Executing buy order for token: ${mintAddress.toString()}`);
    
    // Execute the buy transaction using gmgcBuy
    const swapResult = await gmgcBuy(
      connection,
      NATIVE_MINT.toBase58(),        // Input (SOL/WSOL)
      mintAddress.toString(),        // Output (token to buy)
      DEFAULT_BUY_AMOUNT,            // Amount in lamports
      10                             // 10% slippage
    );
    
    console.log(`✅ Buy transaction sent: ${swapResult.hash}`);
    
    // Wait for confirmation
    if (swapResult.confirmed) {
      console.log(`✅ Buy transaction confirmed!`);
      
      // Store token information in the database
      await prisma.token.create({
        data: {
          baseAddress: mintAddress.toString(),
          name: `PumpFun Token ${mintAddress.toString().slice(0, 8)}`,
          tokenStatus: 'BOUGHT',
          detectedAt: new Date(),
          boughtAt: new Date(),
        }
      });
      
      console.log(`💾 Token information saved to database`);
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

// Track processed transactions to avoid duplicates
const processedTransactions = new Set<string>();

// Main monitoring function
(async () => {
  console.log("🔍 Starting PumpFun token monitor...");
  
  const subscriptionId = connection.onLogs(PUMPFUN_PROGRAM_ID, async (logInfo, ctx) => {
    const { logs, signature } = logInfo;
    
    // Skip if already processed
    if (processedTransactions.has(signature)) {
      return;
    }
    processedTransactions.add(signature);
    
    let foundNewToken = false;
    
    for (const log of logs) {
      if (log.includes("Create Metadata Accounts v3")) {
        foundNewToken = true;
        console.log("🚀 New token detected!");
        console.log(`🔗 https://solscan.io/tx/${signature}`);
        break;
      }
    }
    
    if (foundNewToken) {
      console.log("🔍 Extracting mint address...");
      
      // Extract the mint address from logs or transaction
      const mintAddress = await extractMintAddressFromLogs(logs, signature);
      
      if (mintAddress) {
        console.log(`💰 Token Mint Address: ${mintAddress.toString()}`);
        
        // Check if we already have this token in our database
        const existingToken = await prisma.token.findUnique({
          where: { baseAddress: mintAddress.toString() }
        });
        
        if (existingToken) {
          console.log(`⚠️ Token already in database, skipping purchase`);
          return;
        }
        
        // Get bonding curve details to verify it's a valid token
        const bondingCurveDetails = await getBondingCurveDetails(mintAddress);
        
        if (bondingCurveDetails) {
          console.log("📊 Bonding curve found, token is valid");
          
          // Add a small delay to ensure the token is fully initialized before buying
          await sleep(2000);
          
          // Execute buy order
          const buyResult = await executeBuyOrder(mintAddress);
          
          if (buyResult) {
            console.log(`🎉 Successfully bought token ${mintAddress.toString()}`);
          }
        } else {
          console.log("⚠️ No bonding curve found, skipping purchase");
        }
      } else {
        console.log("⚠️ Could not determine mint address, skipping purchase");
      }
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