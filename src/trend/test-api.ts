import fetch from 'node-fetch';
import fs from 'fs';

const HELIUS_API_KEY = "d4a0e249-aecd-4f2f-9e05-a0985a90650a"; // 🔑 Replace with your actual API key
const OUTPUT_FILE = "output.json"; // 📂 File to save response

// 🔧 Hardcoded transaction signatures for testing

export async function fetchTransactions( transactionSignatures?: string[]) {
  try {
    console.log("📡 Sending request to Helius...");

    const url = `https://api.helius.xyz/v0/transactions?api-key=${HELIUS_API_KEY}`;
    
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ transactions: transactionSignatures }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const jsonResponse = await response.json();
    
    console.log(` Transaction count: ${jsonResponse.length}`);
    // Save response to a file
    //fs.writeFileSync(OUTPUT_FILE, JSON.stringify(jsonResponse, null, 2), 'utf-8');

    //console.log(`✅ Response saved to ${OUTPUT_FILE}`);
    return jsonResponse;

  } catch (error) {
    console.error(" Error fetching transactions:", error);
  }
}

