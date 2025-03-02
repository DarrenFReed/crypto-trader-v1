
import { LIQUIDITY_STATE_LAYOUT_V4 } from "@raydium-io/raydium-sdk";
import { Connection } from '@solana/web3.js';
//import { Raydium } from '@raydium-io/raydium-sdk-v2';

import * as raydium from "@raydium-io/raydium-sdk-v2";

(async () => {
  try {
    // Your Helius RPC connection
    const HELIUS_RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=d3b9094d-91fa-4531-9f6c-019cebcedead';
    //const HELIUS_RPC_URL = 'https://api.mainnet-beta.solana.com';
    //
    //const HELIUS_RPC_URL = 'https://compatible-maximum-shape.solana-mainnet.quiknode.pro/22a4d0e420c016165a9a45257ec45af9da308db3';
    const connection = new Connection(HELIUS_RPC_URL, 'confirmed');

    // Initialize Raydium SDK
    //const raydium = await Raydium.load({ connection });

    const raydiumApi = new raydium.Api({
        cluster: "mainnet",
        timeout: 50000, // Timeout in milliseconds (50 seconds)
      });


    // Fetch pool information by mint addresses
    const poolData = await raydiumApi.fetchPoolByMints({
      mint1: 'So11111111111111111111111111111111111111112', // Example SOL Mint
                    
      //mint2: 'D7vSSXQQazrbceXKxmhCZXWQrm5L4tSYiC68te6pump', // Example SDC Mint
      mint2: 'DjgujfEv2u2qz7PNuS6Ct7bctnxPFihfWE2zBpKZpump', // Example USDC Mint
    });


    console.log(poolData);
  } catch (error) {
    console.error('Error fetching pool:', error);
  }
})();

