import { Connection, PublicKey } from "@solana/web3.js";
import chalk from "chalk";

// Configuration
const HELIUS_RPC_URL = "https://mainnet.helius-rpc.com/?api-key=d4a0e249-aecd-4f2f-9e05-a0985a90650a"; // Replace with your API key
const connection = new Connection(HELIUS_RPC_URL, "confirmed");
const PUMPFUN_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

// Set to track processed transactions
const processedTransactions = new Set();

console.log(chalk.blue("🔍 Starting Pump.fun token creation monitor..."));
console.log(chalk.blue(`🎯 Only showing token creation events`));

// Subscribe to Pump.fun program logs
const subscriptionId = connection.onLogs(PUMPFUN_PROGRAM_ID, (logInfo, ctx) => {
  const { logs, signature } = logInfo;
  
  // Skip if already processed
  if (processedTransactions.has(signature)) {
    return;
  }
  processedTransactions.add(signature);
  
  // Check if this is a token creation transaction
  const isCreateMetadata = logs.some(log => 
    log.includes("Create Metadata Accounts") || 
    log.includes("CreateMetadataAccounts")
  );
  
  // Only process token creation events
  if (!isCreateMetadata) {
    return;
  }
  
  // Print transaction signature
  console.log("\n" + chalk.cyan("========================================"));
  console.log(chalk.yellow.bold("🚀 NEW TOKEN CREATION DETECTED!"));
  console.log(chalk.cyan(`Transaction: ${signature}`));
  console.log(chalk.cyan(`Solscan link: https://solscan.io/tx/${signature}`));
  console.log(chalk.cyan("========================================"));
  
  // Print all logs
  console.log(chalk.white("Transaction logs:"));
  logs.forEach((log, index) => {
    console.log(`${index}: ${log}`);
  });
  
  console.log(chalk.cyan("========================================\n"));
});

console.log(chalk.green(`✅ Subscription active (ID: ${subscriptionId})`));
console.log(chalk.green("Waiting for token creation events..."));

// Keep the process running
process.stdin.resume();

// Cleanup on exit
process.on('SIGINT', () => {
  console.log(chalk.red('Closing subscription and exiting...'));
  connection.removeOnLogsListener(subscriptionId);
  process.exit();
});