import { Connection, PublicKey } from "@solana/web3.js";
import dotenv from "dotenv";

dotenv.config();

// Load environment variables
// good wallet  FgfzLpCJhHYZVji6Sw7omJDEdTq5C12FrV72HzDtwvb5


const WSS_URL = process.env.RPC_WEBSOCKET_ENDPOINT;
const RPC_URL = process.env.RPC_ENDPOINT;
const WALLET_ADDRESS = "niggerd597QYedtvjQDVHZTCCGyJrwHNm2i49dkm5zS";

if (!RPC_URL) {
    throw new Error("RPC_ENDPOINT is not defined");
}
const connection = new Connection(RPC_URL, "confirmed");
if (!WALLET_ADDRESS) {
    throw new Error("WALLET_PUBLIC_KEY is not defined");
}
const walletPublicKey = new PublicKey(WALLET_ADDRESS);

async function listenForTransactions() {
    console.log(`Listening for transactions on wallet: ${walletPublicKey.toBase58()}`);

    connection.onLogs(walletPublicKey, async (logInfo) => {
        console.log("New transaction detected:");
        
        const signature = logInfo.signature;
        const tx = await connection.getTransaction(signature, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
        });

        if (tx && tx.meta && tx.meta.preTokenBalances && tx.meta.postTokenBalances) {
            tx.meta.postTokenBalances.forEach((postBalance) => {
                const preBalance = tx.meta?.preTokenBalances?.find(pb => pb.mint === postBalance.mint);
                const previousAmount = preBalance ? preBalance.uiTokenAmount.uiAmount || 0 : 0;
                const newAmount = postBalance.uiTokenAmount.uiAmount || 0;
                
                if (newAmount > previousAmount) {
                    console.log(`✅ BUY detected! Mint Address: ${postBalance.mint}, Amount: ${newAmount - previousAmount}`);
                } else if (newAmount < previousAmount) {
                    console.log(`❌ SELL detected! Mint Address: ${postBalance.mint}, Amount: ${previousAmount - newAmount}`);
                }
            });
        }
    }, "confirmed");
}

listenForTransactions();
