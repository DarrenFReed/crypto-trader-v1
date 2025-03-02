import {
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    Transaction,
    sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
    createAssociatedTokenAccountInstruction,
    createSyncNativeInstruction,
    getAccount,
    getAssociatedTokenAddress,
    NATIVE_MINT,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

/**
 * Wraps SOL into WSOL
 * @param connection - Solana connection
 * @param payer - User's Keypair (signs the transaction)
 * @param amount - Amount of SOL to wrap (in lamports)
 * @returns The WSOL public key (ATA)
 */
export async function wrapSOL(
    connection: Connection,
    payer: Keypair,
    amount: number
): Promise<PublicKey> {
    const wsolATA = await getAssociatedTokenAddress(NATIVE_MINT, payer.publicKey);

    try {
        // Check if WSOL account already exists
        await getAccount(connection, wsolATA);
    } catch (err) {
        // Create WSOL ATA if it doesn't exist
        const createATA = new Transaction().add(
            createAssociatedTokenAccountInstruction(
                payer.publicKey, // Payer
                wsolATA, // WSOL Associated Token Account
                payer.publicKey, // Owner
                NATIVE_MINT // Wrapped SOL Mint Address
            )
        );
        await sendAndConfirmTransaction(connection, createATA, [payer]);
        console.log(`✅ Created WSOL Account: ${wsolATA.toBase58()}`);
    }

    // Wrap SOL by sending SOL to the WSOL ATA
    const wrapSolTx = new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: wsolATA,
            lamports: amount, // Amount in lamports (1 SOL = 1_000_000_000 lamports)
        }),
        createSyncNativeInstruction(wsolATA) // Sync the WSOL balance
    );

    await sendAndConfirmTransaction(connection, wrapSolTx, [payer]);

    console.log(`✅ Wrapped ${amount / 1_000_000_000} SOL into WSOL at ${wsolATA.toBase58()}`);

    return wsolATA;
}
