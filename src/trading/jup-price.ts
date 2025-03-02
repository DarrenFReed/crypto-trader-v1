async function getSymbolPrice(symbol: string) {
    const url = `https://price.jup.ag/v6/price?ids=${symbol}`;
    try {
        const response = await axios.get(url);
        const data = response.data;
        console.log(data)
    } catch (error) {
        console.error('Error fetching symbol price:', error);
    }
}