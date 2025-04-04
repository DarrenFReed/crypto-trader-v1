
import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import fs from 'fs';
import chalk from 'chalk';
import path from 'path';
import { MAINNET_PROGRAM_ID } from '@raydium-io/raydium-sdk';

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { EventEmitter } from 'events';

export const tokenEmitter = new EventEmitter();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RPC_ENDPOINT= "https://mainnet.helius-rpc.com/?api-key=d3b9094d-91fa-4531-9f6c-019cebcedead"
const RPC_WEBSOCKET_ENDPOINT= "wss://mainnet.helius-rpc.com/?api-key=d3b9094d-91fa-4531-9f6c-019cebcedead"

const solanaConnection = new Connection(RPC_ENDPOINT, {
    wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  });
  
const dataPath = path.join(__dirname, 'data', 'new_solana_tokens.json');
const rayFee = new PublicKey(
    '7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5'
  );

async function monitorNewTokens(connection: Connection) {
  console.log(chalk.green(`monitoring new solana tokens...`));

  try {
    connection.onLogs(
      rayFee,
      async ({ logs, err, signature }) => {
        try {
          if (err) {
            console.error(`connection contains error, ${err}`);
            return;
          }

          console.log(chalk.bgGreen(`found new token signature: ${signature}`));

          let signer = '';
          let baseAddress = '';
          let baseDecimals = 0;
          let baseLpAmount = 0;
          let quoteAddress = '';
          let quoteDecimals = 0;
          let quoteLpAmount = 0;

          /**You need to use a RPC provider for getparsedtransaction to work properly.
           * Check README.md for suggestions.
           */
          const parsedTransaction = await connection.getParsedTransaction(
            signature,
            {
              maxSupportedTransactionVersion: 0,
              commitment: 'confirmed',
            }
          );

          if (parsedTransaction && parsedTransaction.meta && parsedTransaction.meta.err == null) {
            console.log(`successfully parsed transaction`);

            signer =
              parsedTransaction?.transaction.message.accountKeys[0].pubkey.toString();

            console.log(`creator, ${signer}`);

            const postTokenBalances = parsedTransaction?.meta.postTokenBalances;

            const baseInfo = postTokenBalances?.find(
              (balance) =>
                balance.owner ===
                  '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1' &&
                balance.mint !== 'So11111111111111111111111111111111111111112'
            );

            if (baseInfo) {
              baseAddress = baseInfo.mint;
              baseDecimals = baseInfo.uiTokenAmount.decimals;
              baseLpAmount = baseInfo.uiTokenAmount.uiAmount ?? 0;
              console.log(`baseAddress: , ${baseAddress}`);
            }

            const quoteInfo = postTokenBalances?.find(
              (balance) =>
                balance.owner ==
                  '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1' &&
                balance.mint == 'So11111111111111111111111111111111111111112'
            );

            if (quoteInfo) {
              quoteAddress = quoteInfo.mint;
              quoteDecimals = quoteInfo.uiTokenAmount.decimals;
              quoteLpAmount = quoteInfo.uiTokenAmount.uiAmount ?? 0;
            }
          }

          const newTokenData = {
            lpSignature: signature,
            creator: signer,
            timestamp: new Date().toISOString(),
            baseInfo: {
              baseAddress,
              baseDecimals,
              baseLpAmount,
            },
            quoteInfo: {
              quoteAddress: quoteAddress,
              quoteDecimals: quoteDecimals,
              quoteLpAmount: quoteLpAmount,
            },
            logs: logs,
          };
          
          try {
            const pool = await findPoolByMints(baseAddress, quoteAddress);
            if (pool) {
              console.log('Market ID:', pool.marketId.toString());
              console.log('Pool State:', pool);
              newTokenData.poolInfo = {
                marketId: pool.marketId.toString(),
                poolKeys: pool,
              };
            }
          } catch (error) {
            console.error('Error fetching pool:', error);
          }


          tokenEmitter.emit('newToken', newTokenData);

          //store new tokens data in data folder
          await storeData(dataPath, newTokenData);
        } catch (error) {
          const errorMessage = `error occured in new solana token log callback function, ${JSON.stringify(error, null, 2)}`;
          console.log(chalk.red(errorMessage));
          // Save error logs to a separate file
          fs.appendFile(
            'errorNewLpsLogs.txt',
            `${errorMessage}\n`,
            function (err) {
              if (err) console.log('error writing errorlogs.txt', err);
            }
          );
        }
      },
      'confirmed'
    );
  } catch (error) {
    const errorMessage = `error occured in new sol lp monitor, ${JSON.stringify(error, null, 2)}`;
    console.log(chalk.red(errorMessage));
    // Save error logs to a separate file
    fs.appendFile('errorNewLpsLogs.txt', `${errorMessage}\n`, function (err) {
      if (err) console.log('error writing errorlogs.txt', err);
    });
  }
}

function storeData(dataPath: string, newData: any) {
    fs.readFile(dataPath, (err, fileData) => {
      if (err) {
        console.error(`Error reading file: ${err}`);
        return;
      }
      let json;
      try {
        json = JSON.parse(fileData.toString());
      } catch (parseError) {
        console.error(`Error parsing JSON from file: ${parseError}`);
        return;
      }
      json.push(newData);
  
      fs.writeFile(dataPath, JSON.stringify(json, null, 2), (writeErr) => {
        if (writeErr) {
          console.error(`Error writing file: ${writeErr}`);
        } else {
          console.log(`New token data stored successfully.`);
        }
      });
    });
  }

monitorNewTokens(solanaConnection);