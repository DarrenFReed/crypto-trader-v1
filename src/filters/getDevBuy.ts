import { Connection, PublicKey } from '@solana/web3.js';

// Interface for the returned data
interface PumpFunTokenInfo {
  ownerWallet: string;
  tokenMint: string;
  tokenName: string;
  tokenSymbol: string;
  solSpent: number;
  protocolFee: number;
  tokensPurchased: number;
  virtualSolReserves: number;
  virtualTokenReserves: number;
  timestamp: number;
}

/**
 * Decodes Pump.fun token creation and purchase data from a transaction
 * Uses an existing Solana connection (e.g., Helius RPC)
 * 
 * @param connection The Solana connection (e.g., Helius RPC)
 * @param transactionId The Solana transaction signature/ID
 * @returns Promise with decoded token information
 */
export async function decodePumpFunTransaction(
  connection: Connection,
  transactionId: string
): Promise<PumpFunTokenInfo> {
  try {
    // Fetch the transaction details with logs
    const txInfo = await connection.getParsedTransaction(transactionId, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed'
    });
    
    if (!txInfo || !txInfo.meta) {
      throw new Error('Transaction not found or missing metadata');
    }
    
    // Extract the logs and transaction accounts
    const logs = txInfo.meta.logMessages || [];
    const accountKeys = txInfo.transaction.message.accountKeys.map(key => key.pubkey.toString());
    
    // Find the owner wallet (fee payer)
    const ownerWallet = accountKeys[0];
    
    // Extract token information from logs
    let tokenName = '';
    let tokenSymbol = '';
    let tokenMint = '';
    let solSpent = 0;
    let protocolFee = 0;
    let tokensPurchased = 0;
    let virtualSolReserves = 0;
    let virtualTokenReserves = 0;
    let timestamp = 0;
    
    // Find data strings in logs for detailed decoding
    let dataStrings: string[] = [];
    
    logs.forEach(log => {
      // Extract token name and symbol
      if (log.includes('name:') && log.includes('symbol:')) {
        const nameMatch = log.match(/name:\s*"([^"]+)"/);
        const symbolMatch = log.match(/symbol:\s*"([^"]+)"/);
        
        if (nameMatch && nameMatch[1]) tokenName = nameMatch[1];
        if (symbolMatch && symbolMatch[1]) tokenSymbol = symbolMatch[1];
      }
      
      // Extract token mint from logs
      if (log.includes('mint:{') && log.includes('publicKey') && log.includes('data:')) {
        const mintMatch = log.match(/data:\s*"([^"]+)"/);
        if (mintMatch && mintMatch[1]) tokenMint = mintMatch[1];
      }
      
      // Extract SOL amounts
      if (log.includes('solAmount:') && log.includes('data:')) {
        const solMatch = log.match(/data:\s*"(\d+)"/);
        if (solMatch && solMatch[1]) {
          solSpent = parseInt(solMatch[1]) / 1_000_000_000; // Convert lamports to SOL
        }
      }
      
      // Extract token amount
      if (log.includes('tokenAmount:') && log.includes('data:')) {
        const tokenMatch = log.match(/data:\s*"(\d+)"/);
        if (tokenMatch && tokenMatch[1]) {
          tokensPurchased = parseInt(tokenMatch[1]) / 1_000_000; // Adjust for 6 decimals
        }
      }
      
      // Extract timestamp
      if (log.includes('timestamp:') && log.includes('data:')) {
        const timestampMatch = log.match(/data:\s*"(\d+)"/);
        if (timestampMatch && timestampMatch[1]) {
          timestamp = parseInt(timestampMatch[1]);
        }
      }
      
      // Extract virtual SOL reserves
      if (log.includes('virtualSolReserves:') && log.includes('data:')) {
        const reservesMatch = log.match(/data:\s*"(\d+)"/);
        if (reservesMatch && reservesMatch[1]) {
          virtualSolReserves = parseInt(reservesMatch[1]) / 1_000_000_000; // Convert lamports to SOL
        }
      }
      
      // Extract virtual token reserves
      if (log.includes('virtualTokenReserves:') && log.includes('data:')) {
        const tokenReservesMatch = log.match(/data:\s*"(\d+)"/);
        if (tokenReservesMatch && tokenReservesMatch[1]) {
          virtualTokenReserves = parseInt(tokenReservesMatch[1]) / 1_000_000; // Adjust for 6 decimals
        }
      }
      
      // Extract protocol fee from transfer amount
      if (log.includes('Instruction: Transfer') && log.includes('amount:') && log.includes('image\nPump.fun AMM: Protocol Fee')) {
        const feeMatch = log.match(/amount:\s*(\d+\.\d+)/);
        if (feeMatch && feeMatch[1]) {
          protocolFee = parseFloat(feeMatch[1]);
        }
      }
      
      // Collect data strings for further analysis if needed
      if (log.includes('Program data:')) {
        const dataString = log.split('Program data: ')[1];
        dataStrings.push(dataString);
      }
    });
    
    // If we couldn't extract all values from logs, try to decode from data strings
    if (dataStrings.length >= 2) {
      // The second data string typically contains the buy event data
      try {
        const decodedData = decodeBase64EventData(dataStrings[1]);
        
        // Fill in any missing values from the decoded data
        if (!tokensPurchased && decodedData.tokenAmount) {
          tokensPurchased = decodedData.tokenAmount;
        }
        
        if (!solSpent && decodedData.solAmount) {
          solSpent = decodedData.solAmount;
        }
        
        if (!timestamp && decodedData.timestamp) {
          timestamp = decodedData.timestamp;
        }
        
        if (!virtualSolReserves && decodedData.virtualSolReserves) {
          virtualSolReserves = decodedData.virtualSolReserves;
        }
        
        if (!virtualTokenReserves && decodedData.virtualTokenReserves) {
          virtualTokenReserves = decodedData.virtualTokenReserves;
        }
      } catch (error) {
        console.warn('Could not decode event data from base64:', error);
      }
    }
    
    // Check if we have the essential information
    if (!tokenName || !tokenMint || !solSpent || !tokensPurchased) {
      throw new Error('Could not extract all required information from transaction');
    }
    
    return {
      ownerWallet,
      tokenMint,
      tokenName,
      tokenSymbol,
      solSpent,
      protocolFee,
      tokensPurchased,
      virtualSolReserves,
      virtualTokenReserves,
      timestamp
    };
  } catch (error) {
    console.error('Error decoding transaction:', error);
    throw error;
  }
}

/**
 * Decode the base64 event data from Pump.fun transaction
 * Based on the layout we reverse-engineered
 */
function decodeBase64EventData(base64Data: string): {
  tokenAmount: number;
  solAmount: number;
  timestamp: number;
  virtualSolReserves: number;
  virtualTokenReserves: number;
} {
  // Decode base64 string to binary
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  // Find the known values in the binary data
  // Based on our analysis of the data layout
  
  // SOL amount (1.5 SOL = 1500000000 lamports) found at position 40
  const solAmount = readU64(bytes, 40) / 1_000_000_000; // Convert lamports to SOL
  
  // Token amount (51095238095238 = 51,095,238.095238 tokens) found at position 48
  const tokenAmount = readU64(bytes, 48) / 1_000_000; // Adjust for 6 decimals
  
  // Timestamp found around position 89
  const timestamp = readU64(bytes, 89);
  
  // Virtual SOL reserves (31.5 SOL = 31500000000 lamports) found at position 97
  const virtualSolReserves = readU64(bytes, 97) / 1_000_000_000; // Convert lamports to SOL
  
  // Virtual token reserves (1021904761904762 = 1,021,904,761.904762 tokens) found at position 105
  const virtualTokenReserves = readU64(bytes, 105) / 1_000_000; // Adjust for 6 decimals
  
  return {
    solAmount,
    tokenAmount,
    timestamp,
    virtualSolReserves,
    virtualTokenReserves
  };
}

/**
 * Read a u64 value from a byte array at a specific offset (little-endian)
 */
function readU64(bytes: Uint8Array, offset: number): number {
  let value = 0;
  let multiplier = 1;
  
  // Read 8 bytes in little-endian order
  for (let i = 0; i < 8; i++) {
    const byte = bytes[offset + i];
    value += byte * multiplier;
    multiplier *= 256;
  }
  
  return value;
}

