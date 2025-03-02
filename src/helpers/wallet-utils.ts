import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58'; // For base58 decoding
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

/**
 * Get the wallet's Keypair from the private key in the .env file.
 * The private key should be a base58-encoded string.
 */
export function getWalletKeypair(): Keypair {
  // Get the private key from the environment variable
  const privateKeyBase58 = process.env.PRIVATE_KEY;

  if (!privateKeyBase58) {
    throw new Error('PRIVATE_KEY is not defined in the .env file');
  }

  // Decode the base58 private key into a Uint8Array
  let privateKeyArray: Uint8Array;
  try {
    privateKeyArray = bs58.decode(privateKeyBase58);
  } catch (error) {
    throw new Error('Failed to decode private key. Ensure it is a valid base58 string.');
  }

  // Verify the key length
  if (privateKeyArray.length !== 64) {
    throw new Error('Invalid private key length. Expected 64 bytes.');
  }

  // Create and return the Keypair
  return Keypair.fromSecretKey(privateKeyArray);
}