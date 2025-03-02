import { Connection, PublicKey } from '@solana/web3.js';
import { LIQUIDITY_STATE_LAYOUT_V4, MAINNET_PROGRAM_ID } from '@raydium-io/raydium-sdk';
import bs58 from 'bs58';

const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
const seenPools: Set<string> = new Set();

const monitorRaydiumPools = async (quoteTokenMint: PublicKey) => {
  console.log('Starting to monitor Raydium pools...');

  const subscriptionId = await connection.onProgramAccountChange(
    MAINNET_PROGRAM_ID.AmmV4,
    async (updatedAccountInfo, context) => {
      //console.log('Raw Update Received:', updatedAccountInfo);

      const pubkey = updatedAccountInfo.accountId.toBase58();
      if (seenPools.has(pubkey)) return;

      seenPools.add(pubkey);
      console.log(`New Pool Detected: ${pubkey}`);

      const accountData = updatedAccountInfo.accountInfo.data;

      try {
        const parsedData = LIQUIDITY_STATE_LAYOUT_V4.decode(accountData);
        const baseMint = new PublicKey(parsedData.baseMint).toBase58();
        const quoteMint = new PublicKey(parsedData.quoteMint).toBase58();

        console.log('Base Mint:', baseMint);
        console.log('Quote Mint:', quoteMint);
      } catch (error) {
        console.error(`Failed to decode pool data for account: ${pubkey}`);
        console.log('Raw Account Data (Hex):', accountData.toString('hex'));
      }
    },
    connection.commitment
  );

  console.log(`Subscribed to Raydium pools with subscription ID: ${subscriptionId}`);
};

// Example usage
(async () => {
  const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qKfpJmCmd48iaaBog43KMeP3X');
  await monitorRaydiumPools(USDC_MINT);
})();
