// MEV Opportunity Metrics Calculation

// Constants to be imported from another file
const X = 1000; // Reserve of base token (e.g., USDC)
const Y = 1000; // Reserve of quote token (e.g., MEME)
const TRADE_SIZE = 100; // Trade size (amount of base token to buy)
const FEE_RATE = 0.003; // AMM fee rate (e.g., 0.3%)
const EXTERNAL_PRICE = 1.2; // External market price for arbitrage comparison

// Price Impact Calculation
export const calculatePriceImpact = (reserveBase: number, reserveQuote: number, tradeSize: number) => {
  const initialPrice = reserveQuote / reserveBase;
  const newReserveBase = reserveBase + tradeSize;
  const newReserveQuote = reserveQuote * (reserveBase / newReserveBase);
  const newPrice = newReserveQuote / newReserveBase;
  const priceImpact = ((newPrice - initialPrice) / initialPrice) * 100;
  return priceImpact;
};

// Slippage Calculation
export const calculateSlippage = (reserveBase: number, reserveQuote: number, tradeSize: number) => {
  const initialPrice = reserveQuote / reserveBase;
  const newReserveBase = reserveBase + tradeSize;
  const newReserveQuote = reserveQuote * (reserveBase / newReserveBase);
  const newPrice = newReserveQuote / newReserveBase;
  const slippage = Math.abs((newPrice - initialPrice) / initialPrice) * 100;
  return slippage;
};

// Trading Fee Calculation
export const calculateFees = (tradeSize: number, feeRate: number) => {
  return tradeSize * feeRate;
};

// Profitability Check
export const checkProfitability = (
  reserveBase: number,
  reserveQuote: number,
  tradeSize: number,
  feeRate: number,
  externalPrice: number
) => {
  const initialPrice = reserveQuote / reserveBase;
  const newReserveBase = reserveBase + tradeSize;
  const newReserveQuote = reserveQuote * (reserveBase / newReserveBase);
  const newPrice = newReserveQuote / newReserveBase;

  const tokensBought = tradeSize / initialPrice;
  const tokensSoldValue = tokensBought * externalPrice;

  const fees = calculateFees(tradeSize, feeRate) + calculateFees(tokensSoldValue, feeRate);
  const profit = tokensSoldValue - tradeSize - fees;

  return {
    profit,
    isProfitable: profit > 0,
  };
};

// Example Execution (for testing purposes, replace with actual imports later)
console.log("Price Impact:", calculatePriceImpact(X, Y, TRADE_SIZE), "%");
console.log("Slippage:", calculateSlippage(X, Y, TRADE_SIZE), "%");
console.log("Fees:", calculateFees(TRADE_SIZE, FEE_RATE), "base tokens");
const profitability = checkProfitability(X, Y, TRADE_SIZE, FEE_RATE, EXTERNAL_PRICE);
console.log("Profitability:", profitability);
if (profitability.isProfitable) {
  console.log(`MEV opportunity detected, Profit: ${profitability.profit}`);
}
