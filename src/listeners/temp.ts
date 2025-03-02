async function fetchTransactions(transactionSignatures: string[]) {
    
    console.log(chalk.green(`Transaction signatures input:`), transactionSignatures);
    console.log(chalk.green(`Number of transaction signatures:`), transactionSignatures.length);

    const url = `https://api.helius.xyz/v0/transactions?api-key=${HELIUS_API_KEY}`;

    try {

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                transactions: transactionSignatures, // Match the Helius example
            }),
        });

        const data = await response.json();

        console.log(chalk.green(`Retrieved ${data.length} transactions from Helius.`));
        console.log(chalk.green(`Response Status: ${response.status}`));
        console.log(chalk.green(`Response Headers:`), response.headers);

        if (response.error) {
            console.error(chalk.red(` API Error: ${response.data.error}`));
            return [];
        }

        if (data.length !== transactionSignatures.length) {
            console.warn(chalk.red(`⚠️ Mismatch: Expected ${transactionSignatures.length}, got ${data.length}.`));
        }

        return data;
    } catch (error) {
        if (error instanceof Error) {
            console.error(chalk.red(` Error fetching transactions from Helius: ${error.message}`));
        } else {
            console.error(chalk.red(` Error fetching transactions from Helius: ${error}`));
        }
        return [];
    }
}