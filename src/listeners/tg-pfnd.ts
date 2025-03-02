import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js'; // Add explicit file
import { NewMessage } from 'telegram/events/index.js'; // Add explicit file
import * as readlineSync from 'readline-sync';
import * as fs from 'fs';

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

async function main() {
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
