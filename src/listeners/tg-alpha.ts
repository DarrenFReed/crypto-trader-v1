import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';
import * as readlineSync from 'readline-sync';
import * as fs from 'fs';
import { Connection, PublicKey } from '@solana/web3.js';
import { LiquidityPoolKeysV4, Token, TokenAmount } from '@raydium-io/raydium-sdk'; // Adjust the import path as needed
import { EventEmitter } from 'events';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { getRaydiumPoolId } from '../helpers/getPoolIDFromMInt';

// Replace with your Telegram API credentials
const apiId = 25415528; // Get it from https://my.telegram.org
const apiHash = '68f98fbdeff00769470c4d4052fef976';
const quoteToken='So11111111111111111111111111111111111111112'
// Path to save the session string
const SESSION_FILE_PATH = './session.txt';
let savedSession: string;
try {
  savedSession = fs.existsSync(SESSION_FILE_PATH)
    ? fs.readFileSync(SESSION_FILE_PATH, 'utf-8').trim()
    : '';
} catch (err) {
  console.error('Error reading session file:', err);
  savedSession = ''; // Default to an empty session
}
const session = new StringSession(savedSession);

// Helper function to extract contract address (CA) using regex
function extractContractAddress(message: string): string | null {
  const caRegex = /[A-Za-z0-9]{44}(pump)?/g; // Matches a 43-character string followed by optional "pump"
  const match = message.match(caRegex);
  return match ? match[0] : null;
}



// Create an event emitter
export const tgMonitorEmitter = new EventEmitter();

// Function to start the Telegram monitor
export async function startTgMonitor(connection: Connection, publicChannelUsername: string) {
  console.log('Starting Telegram client...');

  try {
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

    // Event listener for new messages
    client.addEventHandler(
      async (event: any) => {
        const message = event.message;
        console.log('New message received:');

        if (message && message.message) {
          const text = message.message;
          const extractedCA = extractContractAddress(text);

          if (text.includes('🔔 New Pumpfun Detect')) {
            console.log('Detected a "New Pumpfun Detect" message.');
            // Extract the contract address using the regex
            if (extractedCA) {
              console.log(`Extracted Contract Address (CA): ${extractedCA}`);
              const poolKeys = await getRaydiumPoolId(connection, quoteToken, extractedCA);
              console.log(`Pool Keys: ${poolKeys}`);
            } else {
              console.log('No valid contract address found in the message.');
            }
          } else {
            console.log('Message does not match "New Pumpfun Detect".');
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



async function swap(
  poolKeys: LiquidityPoolKeysV4,
  ataIn: PublicKey,
  ataOut: PublicKey,
  tokenIn: Token,
  tokenOut: Token,
  amountIn: TokenAmount,
  slippage: number,
  wallet: Keypair,
  direction: 'buy' | 'sell',
) {
  const slippagePercent = new Percent(slippage, 100);
  
  
  //************Darren added to as possible fix
 
  const newPoolKeys = formatAmmKeysById(poolID)

  //***************************************** */
  const poolInfo = await Liquidity.fetchInfo({
    connection: this.connection,
    newPoolKeys,
  });

  const computedAmountOut = Liquidity.computeAmountOut({
    poolKeys,
    poolInfo,
    amountIn,
    currencyOut: tokenOut,
    slippage: slippagePercent,
  });

  const latestBlockhash = await this.connection.getLatestBlockhash();
  const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
    {
      poolKeys: poolKeys,
      userKeys: {
        tokenAccountIn: ataIn,
        tokenAccountOut: ataOut,
        owner: wallet.publicKey,
      },
      amountIn: amountIn.raw,
      minAmountOut: computedAmountOut.minAmountOut.raw,
    },
    poolKeys.version,
  );

  const messageV0 = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: latestBlockhash.blockhash,
    instructions: [
      ...(this.isWarp || this.isJito
        ? []
        : [
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: this.config.unitPrice }),
            ComputeBudgetProgram.setComputeUnitLimit({ units: this.config.unitLimit }),
          ]),
      ...(direction === 'buy'
        ? [
            createAssociatedTokenAccountIdempotentInstruction(
              wallet.publicKey,
              ataOut,
              wallet.publicKey,
              tokenOut.mint,
            ),
          ]
        : []),
      ...innerTransaction.instructions,
      ...(direction === 'sell' ? [createCloseAccountInstruction(ataIn, wallet.publicKey, wallet.publicKey)] : []),
    ],
  }).compileToV0Message();

  const transaction = new VersionedTransaction(messageV0);
  transaction.sign([wallet, ...innerTransaction.signers]);

  return this.txExecutor.executeAndConfirm(transaction, wallet, latestBlockhash);
}
