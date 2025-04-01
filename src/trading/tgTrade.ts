import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';
import * as readlineSync from 'readline-sync';
import * as fs from 'fs';
import { Connection, PublicKey } from '@solana/web3.js';
import { PrismaClient } from '@prisma/client';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT } from '@solana/spl-token';
import { gmgcBuy, gmgcSell } from '../trading/gmgcSwap'; // Import the gmgcBuy function
import { monitorBCPriceForEntry, monitorBCPriceForExit } from '../filters/bondingCurvePrice'; // Import the monitoring function


// Initialize Prisma
const prisma = new PrismaClient();

// Global state
let isProcessingToken = false;

const DEFAULT_BUY_AMOUNT = (0.001 * 1e9).toString();
const PUMPFUN_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");


// Telegram configuration
const apiId = 25415528;
const apiHash = '68f98fbdeff00769470c4d4052fef976';
const quoteToken = 'So11111111111111111111111111111111111111112';
const SESSION_FILE_PATH = './session.txt';

// Helper function to extract contract address using regex
function extractContractAddress(message: string): string | null {
    // Looking for Solana-style addresses which are base58 encoded and typically 32-44 characters
    // Some addresses may end with "pump" and some may not
    
    // First, try to find addresses with "pump" at the end (case insensitive)
    const pumpAddressRegex = /[A-HJ-NP-Za-km-z1-9]{32,44}pump/gi;
    let match = message.match(pumpAddressRegex);
    
    if (match && match.length > 0) {
      return match[0];
    }
    
    // If no pump addresses found, look for standard Solana addresses
    // Base58 uses all alphanumeric characters except 0, O, I, and l
    const solanaAddressRegex = /[A-HJ-NP-Za-km-z1-9]{43,44}/g;
    match = message.match(solanaAddressRegex);
    
    // Return the first match or null if no match found
    return match && match.length > 0 ? match[0] : null;
}

// Enhanced function to process Telegram messages and extract token information
function processPumpMessage(message: string): { tokenMint: string | null, tokenName: string | null, info: any } {
  // Initialize result object
  const result = {
    tokenMint: null,
    tokenName: null,
    info: {}
  };
  
  // Check if the message contains the bell emoji which is common in these notifications
  if (!message.includes('🔔')) {
    return result;
  }
  
  // Extract token name - it's usually in the format "🔔 TOKEN NAME (TICKER)"
  const nameMatch = message.match(/🔔\s+(.+?)\s+\(/);
  if (nameMatch && nameMatch[1]) {
    result.tokenName = nameMatch[1].trim();
  }
  
  // Extract ticker symbol - format "(TICKER)"
  const tickerMatch = message.match(/\(([A-Z0-9]+)\)/);
  if (tickerMatch && tickerMatch[1]) {
    result.info.ticker = tickerMatch[1];
  }
  
  // Extract market cap if available
  const capMatch = message.match(/Cap:\s+\*\*([0-9.]+K?)\*\*/);
  if (capMatch && capMatch[1]) {
    result.info.marketCap = capMatch[1];
  }
  
  // Extract volume if available
  const volMatch = message.match(/Vol:\s+\*\*([0-9.]+K?)\*\*/);
  if (volMatch && volMatch[1]) {
    result.info.volume = volMatch[1];
  }
  
  // Extract liquidity if available
  const liqMatch = message.match(/Liq:\s+\*\*([0-9.]+K?)\*\*/);
  if (liqMatch && liqMatch[1]) {
    result.info.liquidity = liqMatch[1];
  }
  
  // Extract bonding curve if available
  const curveMatch = message.match(/Bonding Curve:\s+\*\*([0-9.]+%)\*\*/);
  if (curveMatch && curveMatch[1]) {
    result.info.bondingCurve = curveMatch[1];
  }
  
  // Use the existing extraction function for the token mint address
  result.tokenMint = extractContractAddress(message);
  
  return result;
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

// Sleep utility function
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// The trading function
export async function tgTrade(tokenMint: string, connection: Connection) {
  const mintAddress = new PublicKey(tokenMint);

  // Check the global lock first - this is faster than a DB query
  if (isProcessingToken) {
    console.log(`⏸️ Skipping new token detection because we're already processing another token`);
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
    console.log(`🔄 Token processing complete, ready for next token`);
  }
}

// Function to start the Telegram monitor and connect it to trading
export async function startTgMonitorAndTrade(connection: Connection, publicChannelUsername: string) {
  console.log('Starting Telegram client...');

  try {
    // Read session string
    let savedSession: string;
    try {
      savedSession = fs.existsSync(SESSION_FILE_PATH)
        ? fs.readFileSync(SESSION_FILE_PATH, 'utf-8').trim()
        : '';
    } catch (err) {
      console.error('Error reading session file:', err);
      savedSession = '';
    }
    const session = new StringSession(savedSession);

    // Create the Telegram client
    const client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 5 });

    // Start the client
    await client.start({
      phoneNumber: async () => readlineSync.question('Enter your phone number: '),
      password: async () => readlineSync.question('Enter your password (if enabled): '),
      phoneCode: async () => readlineSync.question('Enter the code you received: '),
      onError: (err: Error) => console.error('Error during login:', err),
    });

    console.log('Logged in successfully!');
    console.log('Listening for messages...');

    // Save the session string to a file
    try {
      const sessionString = client.session.save();
      if (typeof sessionString === 'string' && sessionString !== '') {
        fs.writeFileSync(SESSION_FILE_PATH, sessionString);
        console.log('Session saved successfully.');
      } else {
        console.error('Session save failed: sessionString is empty or invalid.');
      }
    } catch (err) {
      console.error('Error saving session file:', err);
    }

    try {
      // Get the channel entity to ensure it exists
      const channel = await client.getEntity(publicChannelUsername);
      console.log(`Successfully connected to the channel: ${publicChannelUsername}`);
    } catch (err) {
      console.error(`Error connecting to the channel: ${err}`);
      return;
    }

    // Event listener for new messages with enhanced processing
    client.addEventHandler(
      async (event: any) => {
        const message = event.message;

        if (message && message.message) {
          const text = message.message;
          console.log(`Received message: ${text.substring(0, 100)}...`);

          // Process the message to extract token information
          const tokenInfo = processPumpMessage(text);
          
          if (tokenInfo.tokenMint) {
            console.log(`Extracted Token: ${tokenInfo.tokenName || 'Unknown'} (${tokenInfo.info.ticker || 'Unknown'})`);
            console.log(`Token Mint: ${tokenInfo.tokenMint}`);
            
            // Log additional info if available
            if (Object.keys(tokenInfo.info).length > 0) {
              console.log('Additional Information:');
              for (const [key, value] of Object.entries(tokenInfo.info)) {
                console.log(`  ${key}: ${value}`);
              }
            }

            if (!tokenInfo.info.bondingCurve) {
                console.log(`⚠️ Skipping token: No bonding curve data available`);
                return;
              }
              
              // Check if the bonding curve percentage is too low (optional)
              if (tokenInfo.info.bondingCurve) {
                const bondingCurvePercent = parseFloat(tokenInfo.info.bondingCurve.replace('%', ''));
                if (bondingCurvePercent > 95) { // You can adjust this threshold as needed
                  console.log(`⚠️ Skipping token: Bonding curve percentage too low (${tokenInfo.info.bondingCurve})`);
                  return;
                }
              }




            
            // Check if we can process this token now
            if (!isProcessingToken) {
              console.log(`Starting trade process for token: ${tokenInfo.tokenMint}`);
              
              // Process the token with the tgTrade function
              await tgTrade(tokenInfo.tokenMint, connection);
            } else {
              console.log(`⏸️ Currently processing another token. Skipping: ${tokenInfo.tokenMint}`);
            }
          } else {
            // If the message has the bell emoji but no token address, log this unusual case
            if (text.includes('🔔')) {
              console.log('Bell emoji detected but no valid token address found in the message.');
            }
          }
        }
      },
      new NewMessage({ chats: [publicChannelUsername] })
    );

    // Keep the script running
    console.log('Client is running. Press Ctrl+C to stop.');
    await client.connect();

    // Prevent the script from exiting
    process.stdin.resume();
  } catch (err) {
    console.error('Error in Telegram monitor:', err);
  }
}

// Main function to start the system
export async function main() {
  // Create the Solana connection
  const connection = new Connection('https://mainnet.helius-rpc.com/?api-key=d4a0e249-aecd-4f2f-9e05-a0985a90650a', 'confirmed');
  
  // Start the Telegram monitor with trading integration
  await startTgMonitorAndTrade(connection, '@pumpfunnevadie');
}

// If this file is executed directly (not imported)
console.log('Starting application...');
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});