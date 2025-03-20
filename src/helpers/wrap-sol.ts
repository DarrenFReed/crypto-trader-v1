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
    closeAccount,
    createCloseAccountInstruction
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


export async function unwrapSOL(
    connection: Connection,
    payer: Keypair
): Promise<number> {
    try {
        // Derive the WSOL Associated Token Account (ATA) for the user
        const wsolATA = await getAssociatedTokenAddress(
            NATIVE_MINT, // WSOL mint address
            payer.publicKey // Owner of the ATA (user's wallet)
        );

        // Fetch the WSOL account to get the balance
        const wsolAccount = await getAccount(connection, wsolATA);
        const wsolBalance = wsolAccount.amount;

        // Close the WSOL ATA and transfer the balance back to the owner
        const closeAccountTx = new Transaction().add(
            createCloseAccountInstruction(
                wsolATA, // WSOL ATA to close
                payer.publicKey, // SOL will be sent back to the owner
                payer.publicKey, // Owner of the WSOL ATA
                [] // Optional multi-signers
            )
        );

        await sendAndConfirmTransaction(connection, closeAccountTx, [payer]);

        console.log(`✅ Unwrapped ${Number(wsolBalance) / 1_000_000_000} SOL from WSOL at ${wsolATA.toBase58()}`);

        return Number(wsolBalance); // Return the amount of SOL unwrapped (in lamports)
    } catch (err) {
        console.error("❌ Failed to unwrap SOL:", err);
        throw err;
    }
}
