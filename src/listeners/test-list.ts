// Testing the Listener Standalone
import { PublicKey } from '@solana/web3.js';
import { Listeners } from './listeners.new'; // Adjust import path as needed
import { RAYDIUM_PROGRAM_ID } from '../helpers';

(async () => {
  const listeners = new Listeners();

  // Example configuration
  const config = {
    raydiumProgramId: RAYDIUM_PROGRAM_ID,
    walletPublicKey: new PublicKey('YourWalletPublicKeyHere'), // Replace with a real public key
    quoteTokenMint: new PublicKey('YourQuoteTokenMintHere'), // Replace with a real token mint
    autoSell: false, // Set to true if you want to test autoSell
    cacheNewMarkets: true, // Enable new market caching
  };

  // Start the listeners
  await listeners.start(config);

  // Listen for 'pool' events
  listeners.on('pool', (eventData) => {
    console.log('Detected new pool:', eventData);
  });

  // Listen for 'wallet' events
  listeners.on('wallet', (eventData) => {
    console.log('Detected wallet activity:', eventData);
  });

  // Keep the script running
  console.log('Listeners are running. Press CTRL+C to stop.');
})();
