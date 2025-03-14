import { Connection, PublicKey } from '@solana/web3.js';
import {  RPC_ENDPOINT,
    RPC_WEBSOCKET_ENDPOINT,
    COMMITMENT_LEVEL } from '../helpers';

import { Raydium, MARKET_STATE_LAYOUT_V3, SPL_MINT_LAYOUT, Market } from '@raydium-io/raydium-sdk-v2'
import {LIQUIDITY_STATE_LAYOUT_V4, Liquidity, LiquidityPoolKeys} from '@raydium-io/raydium-sdk'

const connection = new Connection(RPC_ENDPOINT, {
    wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
    commitment: COMMITMENT_LEVEL,
});

const wsol = "So11111111111111111111111111111111111111112"

async function getPoolId(connection: Connection, tokenAddress: string, maxRetries: number = 10) {
  console.log("Token Address:", tokenAddress);

  let raydium: any = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempt ${attempt} to fetch pool ID...`);

      // Load Raydium SDK
      raydium = await Raydium.load({
        connection: connection,
        cluster: 'mainnet',
        disableFeatureCheck: true,
        disableLoadToken: true,
        blockhashCommitment: "confirmed",
      });

      // Fetch pools by mints (WSOL as mint1, tokenAddress as mint2)
      const data1 = await raydium.api.fetchPoolByMints({
        mint1: wsol,
        mint2: tokenAddress,
      });

      // Fetch pools by mints (tokenAddress as mint1, WSOL as mint2)
      const data2 = await raydium.api.fetchPoolByMints({
        mint1: tokenAddress,
        mint2: wsol,
      });

      // Combine the results from both queries
      const pools = [...data1.data, ...data2.data];

      // Find the first Standard AMM pool
      for (const obj of pools) {
        /* if (obj.type === "Standard"|| obj.type === "Stable" ) {
          console.log(`AMM Pool ID: ${obj.id}`);
          return obj;
        } */
      return obj
      }

      console.log("No Standard AMM pool found for the given token pair.");
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error);
      if (attempt === maxRetries) {
        console.error("Max retries reached. Giving up.");
        return null;
      }
    }

    // Wait for a short delay before retrying (e.g., 1 second)
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }

  return null;
}
  
  export async function getPoolKeys(connection: Connection, tokenMint: string) {
    const poolData =  await getPoolId(connection, tokenMint);
    // Fetch pool account info
    const poolAccount = await connection.getAccountInfo(new PublicKey(poolData.id.toString()));
    if (poolAccount === null) throw new Error('Failed to fetch pool account');
    const info = LIQUIDITY_STATE_LAYOUT_V4.decode(poolAccount.data);
  
    // Fetch market account info
    const marketId = info.marketId;
    const marketAccount = await connection.getAccountInfo(marketId);
    if (marketAccount === null) throw new Error('Failed to fetch market account');
    const marketInfo = MARKET_STATE_LAYOUT_V3.decode(marketAccount.data);
  
    // Fetch LP mint account info
    const lpMint = info.lpMint;
    const lpMintAccount = await connection.getAccountInfo(lpMint);
    if (lpMintAccount === null) throw new Error('Failed to fetch LP mint account');
    const lpMintInfo = SPL_MINT_LAYOUT.decode(lpMintAccount.data);
  
    return {
      id: poolData.id,
      baseMint: info.baseMint,
      quoteMint: info.quoteMint,
      lpMint: info.lpMint,
      baseDecimals: info.baseDecimal.toNumber(),
      quoteDecimals: info.quoteDecimal.toNumber(),
      lpDecimals: lpMintInfo.decimals,
      version: 4,
      programId: poolAccount.owner,
      authority: Liquidity.getAssociatedAuthority({ programId: poolAccount.owner }).publicKey,
      openOrders: info.openOrders,
      targetOrders: info.targetOrders,
      baseVault: info.baseVault,
      quoteVault: info.quoteVault,
      withdrawQueue: info.withdrawQueue,
      lpVault: info.lpVault,
      marketVersion: 3,
      marketProgramId: info.marketProgramId,
      marketId: info.marketId,
      marketAuthority: Market.getAssociatedAuthority({ programId: info.marketProgramId, marketId: info.marketId }).publicKey,
      marketBaseVault: marketInfo.baseVault,
      marketQuoteVault: marketInfo.quoteVault,
      marketBids: marketInfo.bids,
      marketAsks: marketInfo.asks,
      marketEventQueue: marketInfo.eventQueue,
      lookupTableAccount: PublicKey.default,
    };
  }



  // Example usage
  (async () => {
    const tokenA = "7VTcbtcizjx5qYyjQmmMNe4k9bPiVgK4fmhnSoWwpump"; // Replace with your token address
    //const poolID = await getPoolId(connection, tokenA);
    const poolKeys = await getPoolKeys(connection, tokenA);
    console.log(poolKeys);
  })();