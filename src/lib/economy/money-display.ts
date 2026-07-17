export function formatMoneyDisplay(value: string | number | bigint): string {
	const text = String(value);
	const sign = text.startsWith('-') ? '-' : '';
	const unsigned = sign ? text.slice(1) : text;
	const [integer, fraction] = unsigned.split('.');
	const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	return `${sign}${grouped}${fraction === undefined ? '' : `.${fraction}`}`;
}
