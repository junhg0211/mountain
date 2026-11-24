export function formatMoneyDisplay(value: string | number | bigint): string {
	const text = String(value);
	const sign = text.startsWith('-') ? '-' : '';
	const unsigned = sign ? text.slice(1) : text;
	const [integer, fraction] = unsigned.split('.');
	const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	return `${sign}${grouped}${fraction === undefined ? '' : `.${fraction}`}`;
}

/** Formats a decimal for display without changing the stored monetary value. */
export function formatSignificantDigits(value: string | number | bigint, significantDigits = 6): string {
	const text = String(value);
	if (!/^[-+]?\d+(?:\.\d+)?$/.test(text) || significantDigits < 1) return text;
	const negative = text.startsWith('-');
	const unsigned = text.replace(/^[-+]/, '');
	const [whole, fraction = ''] = unsigned.split('.');
	const nonZeroWhole = whole.replace(/^0+/, '');
	const firstFractionDigit = fraction.search(/[1-9]/);
	if (!nonZeroWhole && firstFractionDigit === -1) return '0';

	const exponent = nonZeroWhole
		? nonZeroWhole.length - 1
		: -(firstFractionDigit + 1);
	const decimalPlaces = significantDigits - 1 - exponent;
	const shift = fraction.length - decimalPlaces;
	if (shift <= 0) return `${negative ? '-' : ''}${trimDecimal(unsigned)}`;

	const divisor = 10n ** BigInt(shift);
	const source = BigInt(`${whole}${fraction}`);
	const quotient = source / divisor;
	const remainder = source % divisor;
	const rounded = (remainder * 2n >= divisor ? quotient + 1n : quotient) * divisor;
	if (!fraction.length) return `${negative ? '-' : ''}${rounded}`;
	const digits = rounded.toString().padStart(fraction.length + 1, '0');
	const result = `${digits.slice(0, -fraction.length)}.${digits.slice(-fraction.length)}`;
	return `${negative ? '-' : ''}${trimDecimal(result)}`;
}

function trimDecimal(value: string): string {
	const trimmed = value.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
	return trimmed.replace(/^0+(?=\d)/, '') || '0';
}
