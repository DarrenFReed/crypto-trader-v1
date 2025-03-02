import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { JitoTransactionExecutor } from './transactions/jito-rpc-transaction-executor';
import { AmmV3 } from '@raydium-io/raydium-sdk';

const connection = new Connection("https://api.mainnet-beta.solana.com");
const payer = Keypair.generate(); // Replace with your wallet keypair
const slippage = 0.01; // 1% slippage
const takeProfit = 1.2; // 20% profit
const stopLoss = 0.8; // 20% loss

const jitoExecutor = new JitoTransactionExecutor("5000", connection);

// Active tasks registry
const activeTasks: { [mint: string]: boolean } = {}; // Tracks coins being monitored

// Function to handle trading for a single coin
async function executeTrade(baseMint: string) {
  if (activeTasks[baseMint]) {
    console.log(`Already monitoring ${baseMint}, skipping...`);
    return; // Avoid duplicate tasks
  }
  activeTasks[baseMint] = true;

  try {
    console.log(`Starting trade for base mint: ${baseMint}`);

    const baseMintAddress = new PublicKey(baseMint);

    // Fetch Raydium pool information for the token
    const raydiumPool = await AmmV3.fetchPoolInfoByAddress(connection, {
      baseMint: baseMintAddress,
      quoteMint: AmmV3.NATIVE_SOL_MINT, // SOL
    });

    const initialPrice = await AmmV3.calculateSwapOutput({
      poolKeys: raydiumPool,
      inputAmount: 1_000_000_000, // 1 SOL in lamports
      inputTokenMint: AmmV3.NATIVE_SOL_MINT,
      outputTokenMint: baseMintAddress,
    });

    console.log(`Initial token price: ${initialPrice}`);

    // Construct the buy transaction
    const buyInstruction = AmmV3.makeSwapInstruction({
      poolKeys: raydiumPool,
      userKeys: {
        tokenAccountIn: payer.publicKey, // SOL account
        tokenAccountOut: await getOrCreateTokenAccount(baseMintAddress, payer, connection),
      },
      userInputAmount: 1_000_000_000, // Amount of SOL to swap
      userOutputMinAmount: Math.floor(initialPrice * (1 - slippage)),
    });

    const transactionMessage = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
      instructions: [buyInstruction],
    }).compileToV0Message();

    const transaction = new VersionedTransaction(transactionMessage);
    transaction.sign([payer]);

    const buyResult = await jitoExecutor.executeAndConfirm(
      transaction,
      payer,
      await connection.getLatestBlockhash()
    );

    if (buyResult.confirmed) {
      console.log(`Buy transaction confirmed! Signature: ${buyResult.signature}`);
      await monitorPrice(baseMintAddress, initialPrice);
    } else {
      console.error(`Buy transaction failed! Error: ${buyResult.error}`);
    }
  } catch (error) {
    console.error(`Error during trade execution for ${baseMint}: ${error}`);
  } finally {
    delete activeTasks[baseMint]; // Remove the task once complete
  }
}

async function monitorPrice(baseMintAddress: PublicKey, initialPrice: number) {
  console.log(`Monitoring price for base mint: ${baseMintAddress.toBase58()}`);
  let running = true;

  while (running) {
    try {
      const raydiumPool = await AmmV3.fetchPoolInfoByAddress(connection, {
        baseMint: baseMintAddress,
        quoteMint: AmmV3.NATIVE_SOL_MINT,
      });

      const currentPrice = await AmmV3.calculateSwapOutput({
        poolKeys: raydiumPool,
        inputAmount: 1_000_000_000, // 1 SOL in lamports
        inputTokenMint: AmmV3.NATIVE_SOL_MINT,
        outputTokenMint: baseMintAddress,
      });

      console.log(`Current price for ${baseMintAddress.toBase58()}: ${currentPrice}`);

      if (currentPrice >= initialPrice * takeProfit) {
        console.log(`Take-profit condition met for ${baseMintAddress.toBase58()}! Selling...`);
        await executeSell(baseMintAddress, currentPrice);
        running = false;
      } else if (currentPrice <= initialPrice * stopLoss) {
        console.log(`Stop-loss condition met for ${baseMintAddress.toBase58()}! Selling...`);
        await executeSell(baseMintAddress, currentPrice);
        running = false;
      }
    } catch (error) {
      console.error(`Error monitoring price for ${baseMintAddress.toBase58()}: ${error}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 5000)); // Check every 5 seconds
  }
}

async function executeSell(baseMintAddress: PublicKey, currentPrice: number) {
  console.log(`Executing sell for ${baseMintAddress.toBase58()} at price ${currentPrice}`);
  // Implement sell logic here
}

async function getOrCreateTokenAccount(mint: PublicKey, payer: Keypair, connection: Connection): Promise<PublicKey> {
  const tokenAccounts = await connection.getTokenAccountsByOwner(
    payer.publicKey,
    { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }
  );

  const tokenAccount = tokenAccounts.value.find(
    (account) => account.account.data.mint === mint.toBase58()
  );

  if (tokenAccount) {
    return new PublicKey(tokenAccount.pubkey);
  }

  const newAccount = Keypair.generate();
  const transaction = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: newAccount.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(165),
      space: 165,
      programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    })
  );

  await sendAndConfirmTransaction(connection, transaction, [payer, newAccount]);
  return newAccount.publicKey;
}

export { executeTrade };
