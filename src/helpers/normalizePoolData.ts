import { PublicKey } from '@solana/web3.js';
import { LiquidityStateV4 } from '@raydium-io/raydium-sdk';


export function normalizePoolData(poolState: LiquidityStateV4, expectedBaseMint: PublicKey): LiquidityStateV4 {
  const needsSwap = poolState.baseMint.toString() !== expectedBaseMint.toString();
  console.log(`🔍 Checking Normalization:`);
  console.log(`   Starting Base Mint: ${poolState.baseMint.toString()}`);
  console.log(`   Starting Quote Mint: ${poolState.quoteMint.toString()}`);
  console.log(`   Expected Base Mint: ${expectedBaseMint.toString()}`);
  if (needsSwap) {
    console.log(`⚠️ Pool is reversed, swapping base/quote tokens...`);

    return {
      ...poolState,
      baseMint: poolState.quoteMint,
      quoteMint: poolState.baseMint,
      baseDecimal: poolState.quoteDecimal,
      quoteDecimal: poolState.baseDecimal,
      baseVault: poolState.quoteVault,
      quoteVault: poolState.baseVault,
    };
  }
 
  return poolState;
}
