export const MONEY_DECIMAL_PLACES = 2;
export const MINIMUM_MONEY_UNIT = 0.01;

export function parseMoney(value: string): string | null {
	if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) return null;

	const amount = Number(value);
	if (!Number.isFinite(amount) || amount < MINIMUM_MONEY_UNIT) return null;

	return amount.toFixed(MONEY_DECIMAL_PLACES);
}
