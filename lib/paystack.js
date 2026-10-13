function expectedPaymentAmountKobo(order) {
  const orderTotal = Number(order.totalAmount);
  if (Number.isFinite(orderTotal) && orderTotal > 0) {
    const amountKobo = Math.round(orderTotal * 100);
    if (Number.isSafeInteger(amountKobo) &&
        Math.abs(amountKobo / 100 - orderTotal) <= 1e-7) return amountKobo;
  }

  const storedAmount = Number(order.paymentAmountKobo);
  return Number.isSafeInteger(storedAmount) && storedAmount > 0 ? storedAmount : null;
}

function paystackTransactionMismatches(order, transaction, reference) {
  const expectedAmount = expectedPaymentAmountKobo(order);
  const receivedAmount = Number(transaction.amount);
  const mismatches = [];

  if (transaction.reference !== reference) mismatches.push('reference');
  if (expectedAmount == null || !Number.isSafeInteger(receivedAmount) ||
      receivedAmount < expectedAmount) mismatches.push('amount');
  if (transaction.currency !== 'NGN') mismatches.push('currency');

  return mismatches;
}

function paymentAmountMismatchDetails(order, transaction) {
  return {
    expectedKobo: expectedPaymentAmountKobo(order),
    receivedKobo: Number.isSafeInteger(Number(transaction.amount))
      ? Number(transaction.amount)
      : null,
  };
}

module.exports = {
  expectedPaymentAmountKobo,
  paystackTransactionMismatches,
  paymentAmountMismatchDetails,
};
