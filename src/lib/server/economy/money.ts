export const MONEY_DECIMAL_PLACES = 2;
export const MINIMUM_MONEY_UNIT = 0.01;
export const MAXIMUM_MONEY_INTEGER_DIGITS = 13;

export function parseMoney(value: string): string | null {
	const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value);
	if (!match || match[1].length > MAXIMUM_MONEY_INTEGER_DIGITS) return null;

	const fraction = (match[2] || '').padEnd(MONEY_DECIMAL_PLACES, '0');
	if (match[1] === '0' && fraction === '00') return null;

	return `${match[1]}.${fraction}`;
}

export function moneyToCents(value: string): bigint {
	const [integer, fraction = ''] = value.split('.');
	return BigInt(integer) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
}

export function centsToMoney(value: bigint): string {
	const integer = value / 100n;
	const fraction = String(value % 100n).padStart(2, '0');
	return `${integer}.${fraction}`;
}
