import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js'; // Add explicit file
import { NewMessage } from 'telegram/events/index.js'; // Add explicit file
import * as readlineSync from 'readline-sync';
import * as fs from 'fs';
import { Connection, PublicKey } from '@solana/web3.js';
import Axios from 'axios';

// Replace with your Telegram API credentials
const apiId = 25415528; // Get it from https://my.telegram.org
const apiHash = '68f98fbdeff00769470c4d4052fef976';

// Session string for saving login session
//const session = new StringSession(''); // Empty string for a new session


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



// Helper function for user input
//function askQuestion(query: string): string {
  //return readlineSync.question(query);
//}

// Function to extract contract address (CA) using regex
function extractContractAddress(message: string): string | null {
    const caRegex = /[A-Za-z0-9]{44}(pump)?/g; // Matches a 43-character string followed by optional "pump"
    const match = message.match(caRegex);
    return match ? match[0] : null;
  }

  
  interface RaydiumPool {
    baseMint: string;
    quoteMint: string;
    lpMint: string;
    poolId: string;
    // Add other fields as needed
  }
  
  async function getRaydiumPoolData(
    heliusConnection: Connection,
    tokenMint: string
  ): Promise<RaydiumPool | null> {
    try {
      // WSOL mint address
      const WSOL_MINT = 'So11111111111111111111111111111111111111112';
  
      // Fetch Raydium pool data using Helius
      const response = await heliusConnection.getProgramAccounts(
        new PublicKey('RAYDIUM_LIQUIDITY_POOL_PROGRAM_ID'), // Replace with the actual Raydium program ID
        {
          filters: [
            {
              memcmp: {
                offset: 8, // Adjust based on Raydium pool account layout
                bytes: tokenMint, // Filter by base mint (your token)
              },
            },
            {
              memcmp: {
                offset: 40, // Adjust based on Raydium pool account layout
                bytes: WSOL_MINT, // Filter by quote mint (WSOL)
              },
            },
          ],
        }
      );
  
      if (response.length === 0) {
        console.log('No pool found for the given token mint and WSOL pair.');
        return null;
      }
  
      // Decode the pool data (adjust based on Raydium pool account layout)
      const poolData = response[0].account.data;
      const pool: RaydiumPool = {
        baseMint: poolData.slice(8, 40).toString('hex'), // Adjust offsets as needed
        quoteMint: poolData.slice(40, 72).toString('hex'), // Adjust offsets as needed
        lpMint: poolData.slice(72, 104).toString('hex'), // Adjust offsets as needed
        poolId: response[0].pubkey.toString(),
      };
  
      console.log('Pool Data:', pool);
      return pool;
    } catch (error) {
      console.error('Error fetching pool data:', error);
      throw error; // Re-throw the error for handling upstream
    }
  }



async function main() {
  console.log('Starting Telegram client...');

  try {17756918701

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

    // Replace with your target public channel username
    const publicChannelUsername = '@pumpfunnevadie';

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
        //console.log('Raw Message:', message);

        if (message && message.message) {
            const text = message.message;
            const extractedCA = extractContractAddress(message.message);
          if (text.includes('🔔 New Pumpfun Detect')) {
            console.log('Detected a "New Pumpfun Detect" message.');
    
            // Extract the contract address using the regex
            const extractedCA = extractContractAddress(text);
            if (extractedCA) {
              console.log(`Extracted Contract Address (CA): ${extractedCA}`);
              const pool = await getRaydiumPoolData(Connection, extractedCA.toString());
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
    console.error('Error in main function:', err);
  }
}

main().catch(console.error);
