import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import BN from "bn.js"; // Make sure to install this package
import * as splToken from '@solana/spl-token';
import { fetchAllUseAuthorityRecord } from "@metaplex-foundation/mpl-token-metadata";
import chalk from 'chalk';


// Default profit/loss thresholds for auto-selling
const priceIncreaseCount = 0// Sell at 30% profit
const DEFAULT_MAX_HOLD_TIME = 180000; // 

// Track active monitoring instances

// Struct layout for bonding curve data (based on the provided Python example)
async function fetchBondingCurveData(connection: Connection, bondingCurveAddress: PublicKey) {
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
function calculateTokenPrice(connection: Connection, bondingCurveData) {
    const { virtualTokenReserves, virtualSolReserves, realTokenReserves } = bondingCurveData;
    
    // Convert BN to string and then to number for easier calculation
    const vSolReserves = Number(virtualSolReserves.toString());
    const rTokenReserves = Number(realTokenReserves.toString());
    
    // Calculate SOL (in lamports) per token
    const tokenPriceInLamports = rTokenReserves / vSolReserves;
    const tokenPriceInSol = tokenPriceInLamports / 1e9;
    const tokenPrice = tokenPriceInSol  * 1e6;


    return tokenPrice;
  }

// Function to get unique wallet owners of a token
async function getUniqueWalletOwners(connection: Connection, mintAddress) {
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


// Format the price in a human-readable format


// Export monitoring function that can be called from outside

// The original monitorBondingCurvePrice function (keeping for reference)
export async function monitorBCPriceForEntry(
  connection: Connection,
  mintAddress: PublicKey,
  bondingCurveAddress: PublicKey,
  options = {
      immediateEntry: false, 
      minPriceIncreasePercent: 15.0,       // Minimum percentage increase to trigger immediate entry
      minCumulativeIncrease: 10.0,         // Alternative: Total increase over X periods
      totalPeriodsToCheck: 6,              // Number of periods to calculate cumulative increase
      minTotalChangePercent: -100.0,       // Minimum total percentage change from initial price
      monitoringTimeout: 1 * 60 * 1000,    // 3 minute timeout
      requireMultipleIncreases: false,     // Whether to require multiple cumulative increases
      requiredIncreaseCount: 2,            // Number of times the cumulative threshold should be reached
      consecutiveIncreaseThreshold: 2,     // Minimum percentage for consecutive price increases to count
      useAccelerationEntry: true,          // Whether to use acceleration for entry detection
      accelerationThreshold: 2,            // Minimum acceleration value to consider significant
      requiredAccelerationCount: 3,        // Number of consecutive periods with significant acceleration
      useAccelerationSmoothing: false,     // Whether to apply smoothing to acceleration values
      smoothingPeriods: 3,                 // Number of periods for acceleration smoothing
      smoothingAlpha: 0,                   // Alpha value for EMA (0 = auto-calculate based on periods)
      useAccelerationBuffer: true,         // Whether to use a buffer before resetting the acceleration counter
      accelerationResetThreshold: -10.0,   // Only reset counter if acceleration drops below this negative value
      useNonConsecutiveAcceleration: true, // Whether to count acceleration periods within a window rather than consecutive only
      accelerationWindowSize: 8,           // Size of window to check for significant acceleration periods
      // Moving Average options
      useMovingAverageEntry: true,        // Whether to use moving averages for entry detection
      shortMAperiod: 3,                    // Period for short/fast moving average
      longMAperiod: 6,                     // Period for long/slow moving average
      requireMACrossover: false,           // Whether to require a fresh crossover or just uptrend
      maUptrending: true,                  // Whether to enter during established uptrend (short > long)
      maMinPriceIncrease: 10.0,            // Minimum price increase % to confirm MA signal
  }) {

console.log("Starting trend-following entry monitor...");
console.log(`Monitoring bonding curve at address: ${bondingCurveAddress.toString()}`);
console.log(`Token mint address: ${mintAddress.toString()}`);

// Log the entry criteria based on selected strategy
if (options.immediateEntry) {
  console.log(`Entry criteria: Immediate entry on >${options.minPriceIncreasePercent}% jump`);
} else if (options.requireMultipleIncreases) {
  console.log(`Entry criteria: >${options.minCumulativeIncrease}% cumulative increase over ${options.totalPeriodsToCheck} periods`);
  console.log(`                Plus ${options.requiredIncreaseCount} consecutive price jumps of >${options.consecutiveIncreaseThreshold}%`);
} else if (options.useMovingAverageEntry) {
  if (options.requireMACrossover) {
    console.log(`Entry criteria: Bullish MA crossover (${options.shortMAperiod}-period > ${options.longMAperiod}-period)`);
  } else if (options.maUptrending) {
    console.log(`Entry criteria: Uptrending MAs (${options.shortMAperiod}-period > ${options.longMAperiod}-period)`);
  }
  console.log(`                Plus price increase >${options.maMinPriceIncrease}% from initial`);
} else if (options.useAccelerationEntry) {
  if (options.useNonConsecutiveAcceleration) {
    console.log(`Entry criteria: ${options.requiredAccelerationCount} periods with price acceleration >${options.accelerationThreshold}% within last ${options.accelerationWindowSize} periods`);
  } else {
    console.log(`Entry criteria: ${options.requiredAccelerationCount} ${options.useAccelerationBuffer ? 'significant' : 'consecutive'} periods with price acceleration >${options.accelerationThreshold}%`);
  }
  
  if (options.useAccelerationSmoothing) {
    console.log(`                Using EMA smoothing over ${options.smoothingPeriods} periods`);
  }
  
  if (options.useAccelerationBuffer) {
    console.log(`                Using acceleration buffer (only reset counter when acceleration < ${options.accelerationResetThreshold}%)`);
  }
} else {
  console.log(`Entry criteria: >${options.minCumulativeIncrease}% cumulative increase over ${options.totalPeriodsToCheck} periods`);
}

// First fetch to make sure the bonding curve exists
const initialData = await fetchBondingCurveData(connection, bondingCurveAddress);
if (!initialData) {
  console.error("❌ Could not fetch initial bonding curve data. Please check the address and try again.");
  return null;
}

// Return a promise that resolves when entry conditions are met
return new Promise(async (resolve) => {
  // Store the initial price to calculate long term change
  let initialPrice = 0;
  let lastPrice = 0;
  
  // Store recent prices to calculate cumulative change
  let recentPrices = [];
  
  // For tracking multiple increases
  let significantIncreaseCount = 0;
  let previousCumulativeChange = 0;
  
  // For tracking price acceleration
  let recentVelocities = [];
  let significantAccelerationCount = 0;
  let smoothedAcceleration = undefined;
  
  // For tracking non-consecutive acceleration
  let recentAccelerations = [];
  
  // For tracking moving averages
  let prevShortMA = null;
  let prevLongMA = null;
  
  // Set interval to run every second
  const intervalId = setInterval(async () => {
    try {
      // Get bonding curve data
      const bondingCurveData = await fetchBondingCurveData(connection, bondingCurveAddress);
      
      if (!bondingCurveData) {
        console.log("❌ Could not fetch bonding curve data");
        return;
      }
      
      const tokenPrice = calculateTokenPrice(connection, bondingCurveData);
      
      // Set initial price if it's the first run
      if (initialPrice === 0) {
        initialPrice = tokenPrice;
        lastPrice = tokenPrice;
        console.log(`📊 Initial price set to: ${formatPrice(initialPrice)} SOL per token`);
        return; // Skip the first iteration after setting initial price
      }
      
      // Store the current price for cumulative calculations
      recentPrices.push(tokenPrice);
      if (recentPrices.length > options.totalPeriodsToCheck) {
        recentPrices.shift(); // Remove oldest price to maintain fixed window
      }
      
      // Calculate price movement (current vs. last check)
      let priceMovement = "NEUTRAL";
      let priceChangePercent = 0;
      
      if (lastPrice > 0) {
        priceChangePercent = ((tokenPrice - lastPrice) / lastPrice) * 100;
        
        if (priceChangePercent > 0) {
          priceMovement = "UP";
        } else if (priceChangePercent < 0) {
          priceMovement = "DOWN";
        } else {
          priceMovement = "NEUTRAL";
        }
        
        // Store current velocity (price change) for acceleration calculation
        recentVelocities.push(priceChangePercent);
        // Keep only the recent velocities for calculation
        if (recentVelocities.length > 5) {
          recentVelocities.shift();
        }
        
        // Calculate acceleration (change in velocity)
        let rawAcceleration = 0;
        let acceleration = 0;
        
        if (recentVelocities.length >= 2) {
          const currentVelocity = recentVelocities[recentVelocities.length - 1];
          const previousVelocity = recentVelocities[recentVelocities.length - 2];
          rawAcceleration = currentVelocity - previousVelocity;
          
          // Apply acceleration smoothing if enabled
          if (options.useAccelerationSmoothing) {
            // Calculate alpha for EMA if not provided
            const alpha = options.smoothingAlpha > 0 ? 
                      options.smoothingAlpha : 
                      2 / (options.smoothingPeriods + 1);
            
            // Initialize or update smoothed acceleration value
            if (smoothedAcceleration === undefined) {
              smoothedAcceleration = rawAcceleration;
            } else {
              smoothedAcceleration = (alpha * rawAcceleration) + ((1 - alpha) * smoothedAcceleration);
            }
            
            acceleration = smoothedAcceleration;
          } else {
            acceleration = rawAcceleration;
          }
          
          // Store acceleration for non-consecutive tracking if enabled
          if (options.useNonConsecutiveAcceleration) {
            recentAccelerations.push(acceleration);
            if (recentAccelerations.length > options.accelerationWindowSize) {
              recentAccelerations.shift();
            }
          }
          
          // Track consecutive periods with significant acceleration
          if (acceleration >= options.accelerationThreshold) {
            significantAccelerationCount++;
            if (options.useAccelerationEntry) {
              console.log(`\n🚀 Significant price acceleration detected! (${significantAccelerationCount}/${options.requiredAccelerationCount} required)`);
              console.log(`   Acceleration: ${acceleration.toFixed(2)}% (threshold: ${options.accelerationThreshold}%)`);
            }
          } else {
            // Reset counter if acceleration falls below threshold - with buffer if enabled
            if (significantAccelerationCount > 0) {
              if (!options.useAccelerationBuffer || acceleration < options.accelerationResetThreshold) {
                console.log(`\n📉 Price acceleration decreased. Resetting acceleration counter from ${significantAccelerationCount} to 0`);
                significantAccelerationCount = 0;
              } else {
                console.log(`\n⚠️ Price acceleration decreased but within buffer range (${acceleration.toFixed(2)}% > ${options.accelerationResetThreshold}%). Maintaining count at ${significantAccelerationCount}.`);
              }
            }
          }
        }
        
        // Reset consecutive increases counter ONLY if price decreases (not on neutral)
        if ((priceChangePercent < 0) && options.requireMultipleIncreases && significantIncreaseCount > 0) {
          console.log(`\n📉 Price decreased. Resetting consecutive increase counter from ${significantIncreaseCount} to 0`);
          significantIncreaseCount = 0;
        }
      }
      
      // Calculate cumulative price change over recent periods
      let cumulativeChangePercent = 0;
      if (recentPrices.length >= 2) {
        const oldestPrice = recentPrices[0];
        const newestPrice = recentPrices[recentPrices.length - 1];
        cumulativeChangePercent = ((newestPrice - oldestPrice) / oldestPrice) * 100;
      }
      
      // Update previous cumulative change for next iteration
      previousCumulativeChange = cumulativeChangePercent;
      
      // Calculate long-term price change percentage from initial price
      let longTermChangePercent = ((tokenPrice - initialPrice) / initialPrice) * 100;
      
      // Calculate moving averages if needed
      let shortMA = null;
      let longMA = null;
      let bullishCrossover = false;
      let inUptrend = false;
      
      if (options.useMovingAverageEntry && recentPrices.length >= options.longMAperiod) {
        // Calculate short and long moving averages
        shortMA = calculateSMA(recentPrices, options.shortMAperiod);
        longMA = calculateSMA(recentPrices, options.longMAperiod);
        
        // Detect crossover and trend
        bullishCrossover = prevShortMA !== null && prevLongMA !== null && 
                          shortMA > longMA && prevShortMA <= prevLongMA;
        inUptrend = shortMA > longMA;
        
        // Store current values for next iteration
        prevShortMA = shortMA;
        prevLongMA = longMA;
      }
      
      // Update last price for next iteration
      lastPrice = tokenPrice;
      
      // Console log status with movement indicator
      console.log("\n=== BONDING CURVE STATUS ===");
      console.log(`Time: ${new Date().toISOString()}`);
      console.log(`\nToken Price: ${formatPrice(tokenPrice)} SOL per token (${tokenPrice.toExponential(7)})`);
      
      // Add price movement indicators with colors
      const movementIcon = priceMovement === "UP" ? "🟢 ↑" : 
                           priceMovement === "DOWN" ? "🔴 ↓" : "⚪ →";
      console.log(`Current movement: ${movementIcon} ${priceMovement} (${priceChangePercent.toFixed(2)}%)`);
      console.log(`Cumulative ${recentPrices.length}-period change: ${cumulativeChangePercent.toFixed(2)}%`);
      console.log(chalk.blue(`Change from initial price: ${longTermChangePercent.toFixed(2)}%`));
      
      // Log acceleration information if we have enough data
      if (recentVelocities.length >= 2) {
        const currentVelocity = recentVelocities[recentVelocities.length - 1];
        const previousVelocity = recentVelocities[recentVelocities.length - 2];
        const rawAcceleration = currentVelocity - previousVelocity;
        
        // Determine which acceleration value to use for display
        const displayAcceleration = options.useAccelerationSmoothing ? 
                                   smoothedAcceleration : rawAcceleration;
        
        const accelIcon = displayAcceleration > 0 ? "🚀" : 
                         displayAcceleration < 0 ? "🔻" : "⏸️";
                         
        if (options.useAccelerationSmoothing) {
          console.log(`Price acceleration: ${accelIcon} ${displayAcceleration.toFixed(2)}%/period (smoothed)`);
          console.log(`Raw acceleration: ${rawAcceleration.toFixed(2)}%/period`);
        } else {
          console.log(`Price acceleration: ${accelIcon} ${displayAcceleration.toFixed(2)}%/period`);
        }
      }
      
      // Log moving average info if applicable
      if (options.useMovingAverageEntry && shortMA !== null && longMA !== null) {
        console.log(`Short MA (${options.shortMAperiod}): ${shortMA.toExponential(7)}`);
        console.log(`Long MA (${options.longMAperiod}): ${longMA.toExponential(7)}`);
        if (inUptrend) console.log(`✅ In uptrend (short MA > long MA)`);
        if (bullishCrossover) console.log(`🚀 Bullish crossover detected!`);
      }
      
      // Check entry conditions on every pass
      const longTermChangeCondition = longTermChangePercent >= options.minTotalChangePercent;
      
      // Different entry conditions based on strategy
      let entryCondition = false;
      let entryReason = "";
      
      // Check for significant cumulative increase
      const cumulativeConditionMet = cumulativeChangePercent >= options.minCumulativeIncrease && 
                                    recentPrices.length >= options.totalPeriodsToCheck;
      
      // Track multiple increases if that option is enabled
      if (options.requireMultipleIncreases && cumulativeConditionMet) {
        // Only count increases that exceed the consecutive threshold
        if (priceChangePercent >= options.consecutiveIncreaseThreshold) {
          significantIncreaseCount++;
          console.log(`\n📈 Significant price increase detected! (${significantIncreaseCount}/${options.requiredIncreaseCount} required)`);
          console.log(`   Current increase: ${priceChangePercent.toFixed(2)}% (threshold: ${options.consecutiveIncreaseThreshold}%)`);
        }
      }
      
      // For non-consecutive acceleration tracking
      let nonConsecutiveCount = 0;
      if (options.useNonConsecutiveAcceleration && recentAccelerations.length > 0) {
        nonConsecutiveCount = recentAccelerations.filter(a => a >= options.accelerationThreshold).length;
      }
      
      if (options.immediateEntry) {
        // Immediate entry on significant price increase
        entryCondition = priceChangePercent >= options.minPriceIncreasePercent;
        entryReason = "significant_immediate_increase";
      } else if (options.useMovingAverageEntry) {
        // Entry based on moving average signals
        if (shortMA !== null && longMA !== null) {
          // Entry on fresh crossover if required, otherwise check for uptrend
          const maCondition = options.requireMACrossover ? bullishCrossover : 
                            (options.maUptrending ? inUptrend : bullishCrossover);
          
          // Confirm with price increase from initial
          entryCondition = maCondition && longTermChangePercent >= options.maMinPriceIncrease;
          entryReason = bullishCrossover ? "ma_crossover" : "ma_uptrend";
        }
      } else if (options.useAccelerationEntry) {
        if (options.useNonConsecutiveAcceleration) {
          // Entry based on number of significant acceleration periods within a window
          entryCondition = nonConsecutiveCount >= options.requiredAccelerationCount;
          entryReason = "non_consecutive_acceleration";
        } else {
          // Entry based on consecutive periods of significant acceleration
          entryCondition = significantAccelerationCount >= options.requiredAccelerationCount;
          entryReason = "significant_price_acceleration";
        }
      } else if (options.requireMultipleIncreases) {
        // Entry based on multiple cumulative increases over time
        entryCondition = significantIncreaseCount >= options.requiredIncreaseCount;
        entryReason = "multiple_cumulative_increases";
      } else {
        // Entry based on a single cumulative increase over multiple periods
        entryCondition = cumulativeConditionMet;
        entryReason = "cumulative_increase";
      }
      
      // Final entry condition must also meet the long term change threshold
      if (entryCondition && longTermChangeCondition) {
        console.log("\n🚨 ENTRY POINT DETECTED 🚨");
        console.log("Conditions met:");
        
        if (entryReason === "significant_immediate_increase") {
          console.log(`✅ Immediate price increase of ${priceChangePercent.toFixed(2)}% (threshold: ${options.minPriceIncreasePercent}%)`);
        } else if (entryReason === "significant_price_acceleration") {
          console.log(`✅ Detected ${significantAccelerationCount} ${options.useAccelerationBuffer ? 'significant' : 'consecutive'} periods of price acceleration`);
          console.log(`✅ Each acceleration above: ${options.accelerationThreshold}% (increasing momentum)`);
          if (options.useAccelerationSmoothing) {
            console.log(`✅ Using smoothed acceleration values (EMA-${options.smoothingPeriods})`);
          }
        } else if (entryReason === "non_consecutive_acceleration") {
          console.log(`✅ Detected ${nonConsecutiveCount} periods of significant price acceleration within the last ${recentAccelerations.length} periods`);
          console.log(`✅ Each acceleration above: ${options.accelerationThreshold}% (increasing momentum)`);
        } else if (entryReason === "multiple_cumulative_increases") {
          console.log(`✅ Detected ${significantIncreaseCount} significant price increases (threshold: ${options.requiredIncreaseCount})`);
          console.log(`✅ Each increase: >${options.consecutiveIncreaseThreshold}% (with cumulative increase >${options.minCumulativeIncrease}%)`);
        } else if (entryReason === "ma_crossover" || entryReason === "ma_uptrend") {
          console.log(`✅ Moving Average ${entryReason === "ma_crossover" ? 'crossover' : 'uptrend'} detected`);
          console.log(`✅ Short MA (${options.shortMAperiod}-period): ${shortMA.toExponential(7)}`);
          console.log(`✅ Long MA (${options.longMAperiod}-period): ${longMA.toExponential(7)}`);
          console.log(`✅ Price increase from initial: ${longTermChangePercent.toFixed(2)}% (threshold: ${options.maMinPriceIncrease}%)`);
        } else {
          console.log(`✅ Cumulative price increase of ${cumulativeChangePercent.toFixed(2)}% over ${recentPrices.length} periods (threshold: ${options.minCumulativeIncrease}%)`);
        }
        
        console.log(chalk.blue(`✅ Total price increase from initial: ${longTermChangePercent.toFixed(2)}%`));
        console.log(`Recommended entry price: ${formatPrice(tokenPrice)} SOL per token`);
        
        // Clear the interval
        clearInterval(intervalId);
        
        // Resolve the promise with the entry data
        resolve({
          entryFound: true,
          tokenPrice,
          priceChangePercent,
          cumulativeChangePercent,
          longTermChangePercent,
          entryReason,
          accelerationInfo: {
            raw: recentVelocities.length >= 2 ? 
                recentVelocities[recentVelocities.length - 1] - recentVelocities[recentVelocities.length - 2] : 0,
            smoothed: smoothedAcceleration,
            count: options.useNonConsecutiveAcceleration ? nonConsecutiveCount : significantAccelerationCount
          },
          maInfo: options.useMovingAverageEntry ? {
            shortMA,
            longMA,
            crossover: bullishCrossover,
            uptrend: inUptrend
          } : null,
          recentPrices, // Include the price history that led to this decision
          timestamp: new Date().toISOString()
        });
      } else {
        console.log("\n⏳ Waiting for entry conditions:");
        
        if (options.immediateEntry) {
          console.log(`${priceChangePercent >= options.minPriceIncreasePercent ? '✅' : '❌'} Immediate price increase >${options.minPriceIncreasePercent}% (current: ${priceChangePercent.toFixed(2)}%)`);
        } else if (options.useMovingAverageEntry) {
          if (recentPrices.length >= options.longMAperiod) {
            console.log(`✅ Have enough price data for moving averages`);
            console.log(`${inUptrend ? '✅' : '❌'} Short MA ${inUptrend ? '>' : '<'} Long MA (${inUptrend ? 'uptrend' : 'downtrend'})`);
            console.log(`${bullishCrossover ? '✅' : '❌'} Bullish crossover detected`);
            console.log(`${longTermChangePercent >= options.maMinPriceIncrease ? '✅' : '❌'} Price increase >${options.maMinPriceIncrease}% (current: ${longTermChangePercent.toFixed(2)}%)`);
          } else {
            console.log(`❌ Need ${options.longMAperiod} periods of data for moving averages (current: ${recentPrices.length})`);
          }
        } else if (options.useAccelerationEntry) {
          // For acceleration-based entry
          const hasAccelerationData = recentVelocities.length >= 2;
          console.log(`${hasAccelerationData ? '✅' : '❌'} Have enough data to calculate acceleration`);
          if (hasAccelerationData) {
            // Determine which acceleration value to check against threshold
            const checkAcceleration = options.useAccelerationSmoothing ? 
                                   smoothedAcceleration : 
                                   recentVelocities[recentVelocities.length - 1] - recentVelocities[recentVelocities.length - 2];
            
            if (options.useNonConsecutiveAcceleration) {
              console.log(`${nonConsecutiveCount >= options.requiredAccelerationCount ? '✅' : '❌'} ${nonConsecutiveCount}/${options.requiredAccelerationCount} significant acceleration periods detected in window`);
              console.log(`   Current acceleration: ${checkAcceleration.toFixed(2)}% (threshold: ${options.accelerationThreshold}%)`);
            } else {
              console.log(`${checkAcceleration >= options.accelerationThreshold ? '✅' : '❌'} Current acceleration: ${checkAcceleration.toFixed(2)}% (threshold: ${options.accelerationThreshold}%)`);
              console.log(`${significantAccelerationCount}/${options.requiredAccelerationCount} significant acceleration periods detected`);
            }
          }
        } else if (options.requireMultipleIncreases) {
          console.log(`${recentPrices.length >= options.totalPeriodsToCheck ? '✅' : '❌'} Have ${recentPrices.length}/${options.totalPeriodsToCheck} periods of price data`);
          console.log(`${significantIncreaseCount}/${options.requiredIncreaseCount} significant increases detected`);
          if (recentPrices.length >= options.totalPeriodsToCheck) {
            console.log(`${cumulativeChangePercent >= options.minCumulativeIncrease ? '✅' : '❌'} Current cumulative increase: ${cumulativeChangePercent.toFixed(2)}% (threshold: ${options.minCumulativeIncrease}%)`);
          }
        } else {
          console.log(`${recentPrices.length >= options.totalPeriodsToCheck ? '✅' : '❌'} Have ${recentPrices.length}/${options.totalPeriodsToCheck} periods of price data`);
          if (recentPrices.length >= options.totalPeriodsToCheck) {
            console.log(`${cumulativeChangePercent >= options.minCumulativeIncrease ? '✅' : '❌'} Cumulative increase >${options.minCumulativeIncrease}% (current: ${cumulativeChangePercent.toFixed(2)}%)`);
          }
        }
        
        console.log(`${longTermChangeCondition ? '✅' : '❌'} Total price change >${options.minTotalChangePercent}% (currently ${longTermChangePercent.toFixed(2)}%)`);
      }
      
    } catch (error) {
      console.error(`Error in monitoring: ${error}`);
    }
  }, 1000);
  
  // Add a timeout to stop monitoring after a certain period
  setTimeout(() => {
    clearInterval(intervalId);
    resolve({ entryFound: false, reason: "Timeout reached" });
  }, options.monitoringTimeout); 
});
}

// Helper function for Simple Moving Average calculation
function calculateSMA(prices, periods) {
  if (prices.length < periods) return null;
  const relevantPrices = prices.slice(prices.length - periods);
  return relevantPrices.reduce((sum, price) => sum + price, 0) / periods;
}


export async function monitorBCPriceForExit(
    connection: Connection,
    mintAddress: PublicKey,
    bondingCurveAddress: PublicKey,
    buyPrice: number,
    takeProfitPercent: number = 13, // Default 15% profit target
    stopLossPercent: number =5,    // Default 5% loss limit
    maxMonitorTime: number = 120000 // Default 1 hour (60 minutes)
): Promise<string> {
  console.log("Starting exit price monitor...");
  console.log(`Monitoring bonding curve at address: ${bondingCurveAddress.toString()}`);
  console.log(`Token mint address: ${mintAddress.toString()}`);
  console.log(`Buy price: ${formatPrice(buyPrice)} SOL per token`);
  console.log(`Take profit target: +${takeProfitPercent}%`);
  console.log(`Stop loss limit: -${stopLossPercent}%`);
  console.log(`Max monitor time: ${maxMonitorTime/60000} minutes`);
  
  // Calculate the actual price targets
  const takeProfitPrice = buyPrice * (1 + (takeProfitPercent / 100));
  const stopLossPrice = buyPrice * (1 - (stopLossPercent / 100));
  
  console.log(`Take profit price: ${formatPrice(takeProfitPrice)} SOL per token`);
  console.log(`Stop loss price: ${formatPrice(stopLossPrice)} SOL per token`);
  
  // First fetch to make sure the bonding curve exists
  const initialData = await fetchBondingCurveData(connection, bondingCurveAddress);
  if (!initialData) {
    console.error("❌ Could not fetch initial bonding curve data. Please check the address and try again.");
    return "error";
  }
  
  // Create a wrapper function using a Promise to properly handle async resolution
  const monitorPromise = () => {
    return new Promise<string>((resolve) => {
      let intervalId: NodeJS.Timeout | null = null;
      let timeoutId: NodeJS.Timeout | null = null;
      
      // Function to clean up timers
      const cleanup = () => {
        if (intervalId) clearInterval(intervalId);
        if (timeoutId) clearTimeout(timeoutId);
      };
      
      // Set up the interval for price checking
      intervalId = setInterval(async () => {
        try {
          // Get bonding curve data
          const bondingCurveData = await fetchBondingCurveData(connection, bondingCurveAddress);
          
          if (!bondingCurveData) {
            console.log("❌ Could not fetch bonding curve data");
            return; // Continue monitoring
          }
          
          // Use correct price calculation formula
          const tokenPrice = calculateTokenPrice(connection, bondingCurveData, false); // Get raw price
          
          // Calculate profit/loss percentage
          const profitPercent = ((tokenPrice / buyPrice) - 1) * 100;
               
          // Check if we've hit take profit or stop loss targets
          if (tokenPrice >= takeProfitPrice) {
            console.log(`\n🎯 TAKE PROFIT TARGET REACHED! Current price: ${formatPrice(tokenPrice)} SOL`);
            console.log(`Profit: +${profitPercent.toFixed(2)}%`);
            cleanup();
            resolve("sell token");
            return;
          }
          
          if (tokenPrice <= stopLossPrice) {
            console.log(`\n🛑 STOP LOSS TRIGGERED! Current price: ${formatPrice(tokenPrice)} SOL`);
            console.log(`Loss: ${profitPercent.toFixed(2)}%`);
            cleanup();
            resolve("sell token");
            return;
          }
          
          // Regular status update
          console.log(`Current price: ${formatPrice(tokenPrice)} SOL | Profit/Loss: ${profitPercent.toFixed(2)}%`);
           
        } catch (error) {
          console.error(`Error in monitoring: ${error}`);
        }
      }, 1500);
      
      // Set a timeout to resolve the promise if max monitor time is reached
      timeoutId = setTimeout(() => {
        console.log(`\n⏰ Max monitoring time (${maxMonitorTime/60000} minutes) reached without hitting targets`);
        cleanup();
        resolve("timeout");
      }, maxMonitorTime);
    });
  };
  
  // Execute the monitoring promise and return its result
  return await monitorPromise();
}

// Helper function to format price with appropriate decimal places
function formatPrice(price: number): string {
  if (price < 0.000001) return price.toExponential(7);
  if (price < 0.001) return price.toFixed(9);
  if (price < 1) return price.toFixed(6);
  return price.toFixed(4);
}