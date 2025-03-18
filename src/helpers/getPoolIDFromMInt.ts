// Importing necessary modules and types
import { Connection, PublicKey, Commitment } from "@solana/web3.js";
import { 
    LIQUIDITY_STATE_LAYOUT_V4, 
    MARKET_STATE_LAYOUT_V3, 
    MAINNET_PROGRAM_ID 
} from '@raydium-io/raydium-sdk';
import BN from "bn.js";

// Interface for PoolKeys
interface PoolKeys {
    id: PublicKey;
    programId: PublicKey;
    status: BN;
    baseDecimals: number;
    quoteDecimals: number;
    lpDecimals: number;
    baseMint: PublicKey;
    quoteMint: PublicKey;
    version: number;
    authority: PublicKey;
    openOrders: PublicKey;
    baseVault: PublicKey;
    quoteVault: PublicKey;
    marketProgramId: PublicKey;
    marketId: PublicKey;
    marketBids: PublicKey;
    marketAsks: PublicKey;
    marketEventQueue: PublicKey;
    marketBaseVault: PublicKey;
    marketQuoteVault: PublicKey;
    marketAuthority: PublicKey;
    targetOrders: PublicKey;
    lpMint: PublicKey;
}

// Function to fetch market accounts
const fetchMarketAccounts = async (
    connection: Connection, 
    base: PublicKey, 
    quote: PublicKey, 
    commitment: Commitment
): Promise<{ id: string; data: any } | undefined> => {
    try {
        const accounts = await connection.getProgramAccounts(
            MAINNET_PROGRAM_ID.AmmV4,
            {
                commitment,
                filters: [
                    { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
                    {
                        memcmp: {
                            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf("baseMint"),
                            bytes: base.toBase58(),
                        },
                    },
                    {
                        memcmp: {
                            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf("quoteMint"),
                            bytes: quote.toBase58(),
                        },
                    },
                ],
            }
        );

        const rawData = accounts.map(({ pubkey, account }) => ({
            id: pubkey.toString(),
            data: LIQUIDITY_STATE_LAYOUT_V4.decode(account.data),
        }));

        return rawData[0];
    } catch (error) {
        console.error('fetchMarketAccounts', error);
    }
};

// Function to get pool keys by pool ID
const getPoolKeysByPoolId = async (
    ammId: string, 
    connection: Connection
): Promise<PoolKeys | undefined> => {
    console.log(`Getting pool keys for ${ammId}`);

    const ammAccount = await connection.getAccountInfo(new PublicKey(ammId));
    if (ammAccount) {
        const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(ammAccount.data);

        const marketAccount = await connection.getAccountInfo(poolState.marketId);
        if (marketAccount) {
            const marketState = MARKET_STATE_LAYOUT_V3.decode(marketAccount.data);

            const marketAuthority = PublicKey.createProgramAddressSync(
                [
                    marketState.ownAddress.toBuffer(),
                    marketState.vaultSignerNonce.toArrayLike(Buffer, "le", 8),
                ],
                MAINNET_PROGRAM_ID.OPENBOOK_MARKET,
            );

            return {
                id: new PublicKey(ammId),
                programId: MAINNET_PROGRAM_ID.AmmV4,
                status: poolState.status,
                baseDecimals: poolState.baseDecimal.toNumber(),
                quoteDecimals: poolState.quoteDecimal.toNumber(),
                lpDecimals: 9,
                baseMint: poolState.baseMint,
                quoteMint: poolState.quoteMint,
                version: 4,
                authority: new PublicKey("5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1"),
                openOrders: poolState.openOrders,
                baseVault: poolState.baseVault,
                quoteVault: poolState.quoteVault,
                marketProgramId: MAINNET_PROGRAM_ID.OPENBOOK_MARKET,
                marketId: marketState.ownAddress,
                marketBids: marketState.bids,
                marketAsks: marketState.asks,
                marketEventQueue: marketState.eventQueue,
                marketBaseVault: marketState.baseVault,
                marketQuoteVault: marketState.quoteVault,
                marketAuthority: marketAuthority,
                targetOrders: poolState.targetOrders,
                lpMint: poolState.lpMint,
            };
        }
    }
};

// Main function to fetch the Raydium pool ID
export const getRaydiumPoolId = async (
    connection: Connection, 
    tokenA: string, 
    tokenB: string
): Promise<PoolKeys | undefined> => {
    const base = new PublicKey(tokenA);
    const quote = new PublicKey(tokenB);

    const marketData = await fetchMarketAccounts(connection, base, quote, "confirmed");
    if (marketData) {
        const poolKeys = await getPoolKeysByPoolId(marketData.id, connection);
        return poolKeys;
    }
};

// Example usage
// const connection = new Connection("https://api.mainnet-beta.solana.com");
// const tokenA = "YourTokenAMintAddress";
// const tokenB = "YourTokenBMintAddress";
// getRaydiumPoolId(connection, tokenA, tokenB).then(console.log).catch(console.error);