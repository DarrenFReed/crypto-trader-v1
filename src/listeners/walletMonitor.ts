import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import chalk from 'chalk';
import { tokenEmitter } from './new-tokens';

let walletSubscriptionId: number | null = null;

export async function subscribeToWalletChanges(connection: Connection, walletPublicKey: PublicKey) {
  const subscriptionConfig = {
    commitment: connection.commitment,
    filters: [
      { dataSize: 165 }, // Filter by account data size
      {
        memcmp: {
          offset: 32, // Offset to the owner field in the token account
          bytes: walletPublicKey.toBase58(), // Filter by owner public key
        },
      },
    ],
  };

  const subscriptionId = connection.onProgramAccountChange(
    TOKEN_PROGRAM_ID,
    (updatedAccountInfo) => {
  tokenEmitter.emit('wallet', updatedAccountInfo);
    },
    subscriptionConfig
  );

  // Store the subscription ID globally
  walletSubscriptionId = subscriptionId;

  return subscriptionId;
}

/**
 * Stops wallet monitoring by removing the subscription.
 */
export async function stopWalletMonitoring(connection: Connection) {
  if (walletSubscriptionId !== null) {
    await connection.removeProgramAccountChangeListener(walletSubscriptionId);
    console.log(`🛑 Stopped wallet monitoring.`);
    walletSubscriptionId = null;
  } else {
    console.log(`🛑 No active wallet monitoring subscription to stop.`);
  }
}