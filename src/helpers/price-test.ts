import { request, gql } from 'graphql-request';

const BITQUERY_ENDPOINT = 'https://graphql.bitquery.io';

async function checkBondingCurveStatus(mintAddress: string): Promise<boolean> {
    const query = gql`
        query ($mintAddress: String!) {
            solana {
                tokens(filter: { mint: { is: $mintAddress } }) {
                    bondingCurve {
                        status
                    }
                }
            }
        }
    `;

    const variables = { mintAddress };

    try {
        const data = await request(BITQUERY_ENDPOINT, query, variables);
        const status = data.solana.tokens[0]?.bondingCurve?.status;
        return status === 'bonded';
    } catch (error) {
        console.error("Error checking bonding curve status:", error);
        return false;
    }
}

async function getTokenPrice(mintAddress: string): Promise<number | null> {
    const query = gql`
        query ($mintAddress: String!) {
            solana {
                tokens(filter: { mint: { is: $mintAddress } }) {
                    price {
                        value
                    }
                }
            }
        }
    `;

    const variables = { mintAddress };

    try {
        const data = await request(BITQUERY_ENDPOINT, query, variables);
        const price = data.solana.tokens[0]?.price?.value;
        return price || null;
    } catch (error) {
        console.error("Error fetching token price:", error);
        return null;
    }
}

// Main function to test bonding curve status and get token price
async function main() {
    const mint = "F1McpqBcundL4LfpqARQnBRiirjGsoRQoVqH6JBJpump";
    const isBonded = await checkBondingCurveStatus(mint);
    if (!isBonded) {
        console.log("Token is not yet bonded.");
        const price = await getTokenPrice(mint);
        if (price !== null) {
            console.log(`Token price: ${price}`);
        } else {
            console.log("Failed to fetch token price.");
        }
    } else {
        console.log("Token is bonded.");
    }
}

// Run the main function
main().catch(console.error);