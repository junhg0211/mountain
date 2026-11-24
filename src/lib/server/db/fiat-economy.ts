import { getDB } from '$lib/server/db';
import { centsToMoney, moneyToCents } from '$lib/server/economy/money';

export const FIAT_ECONOMY_NOTICE =
	'표시된 준비금 및 환율은 서버 운영자가 등록한 정보를 기반으로 산정됩니다. Mountain은 준비금의 실재 여부를 검증하지 않으며, 현실 재화의 보관·지급·환전을 보장하지 않습니다.';

export interface FiatEconomySettings {
	enabled: boolean;
	currencyCode: string;
	exchangeRatePublic: boolean;
	reservePublic: boolean;
	supplyPublic: boolean;
	payoutNotice: string | null;
}

export interface FiatEconomySnapshot extends FiatEconomySettings {
	reserveAmount: string;
	tokenSupply: string;
	exchangeRate: string | null;
}

export class FiatEconomyDisabledError extends Error {}
export class InsufficientReserveError extends Error {}
export class InvalidRedemptionError extends Error {}

function formatMoney(value: unknown): string {
	const [integer, fraction = ''] = String(value ?? 0).split('.');
	return `${integer}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}

function rateFromCents(reserveCents: bigint, supplyCents: bigint, precision = 12): string | null {
	if (supplyCents <= 0n) return null;
	const whole = reserveCents / supplyCents;
	let remainder = reserveCents % supplyCents;
	let fraction = '';
	for (let index = 0; index < precision; index += 1) {
		remainder *= 10n;
		fraction += String(remainder / supplyCents);
		remainder %= supplyCents;
	}
	return `${whole}.${fraction}`;
}

async function totalSupply(tx: Awaited<ReturnType<typeof getDB>>, guildId: string): Promise<string> {
	const rows = await tx`
		SELECT
			(SELECT COALESCE(SUM(balance), 0.00) FROM accounts WHERE guild_id=${guildId}) +
			(SELECT COALESCE(SUM(betting_entries.amount), 0.00)
			 FROM betting_entries JOIN betting_pools ON betting_pools.id=betting_entries.pool_id
			 WHERE betting_pools.guild_id=${guildId} AND betting_pools.status='open') +
			(SELECT COALESCE(SUM(house_balance), 0.00) FROM betting_pools
			 WHERE guild_id=${guildId} AND status<>'archived') AS total
	`;
	return formatMoney(rows[0]?.total);
}

function rowSettings(row: Record<string, unknown>): FiatEconomySettings {
	return {
		enabled: Boolean(row.fiat_economy_enabled),
		currencyCode: String(row.fiat_currency_code || 'KRW'),
		exchangeRatePublic: Boolean(row.exchange_rate_public),
		reservePublic: Boolean(row.reserve_public),
		supplyPublic: Boolean(row.supply_public),
		payoutNotice: row.fiat_payout_notice ? String(row.fiat_payout_notice) : null
	};
}

export async function getFiatEconomy(guildId: string): Promise<FiatEconomySnapshot> {
	const db = await getDB();
	const [settingsRows, reserveRows, supply] = await Promise.all([
		db`SELECT fiat_economy_enabled, fiat_currency_code, exchange_rate_public, reserve_public, supply_public, fiat_payout_notice FROM guild_settings WHERE guild_id=${guildId} LIMIT 1`,
		db`SELECT amount FROM fiat_reserves WHERE guild_id=${guildId} LIMIT 1`,
		totalSupply(db, guildId)
	]);
	const settings = rowSettings(settingsRows[0] || {});
	const reserveAmount = formatMoney(reserveRows[0]?.amount);
	return {
		...settings,
		reserveAmount,
		tokenSupply: supply,
		exchangeRate: rateFromCents(moneyToCents(reserveAmount), moneyToCents(supply))
	};
}

export async function setFiatEconomySettings(guildId: string, settings: FiatEconomySettings) {
	const db = await getDB();
	await db`
		INSERT INTO guild_settings (
			guild_id, fiat_economy_enabled, fiat_currency_code, exchange_rate_public,
			reserve_public, supply_public, fiat_payout_notice
		) VALUES (
			${guildId}, ${settings.enabled}, ${settings.currencyCode}, ${settings.exchangeRatePublic},
			${settings.reservePublic}, ${settings.supplyPublic}, ${settings.payoutNotice}
		)
		ON DUPLICATE KEY UPDATE
			fiat_economy_enabled=VALUES(fiat_economy_enabled), fiat_currency_code=VALUES(fiat_currency_code),
			exchange_rate_public=VALUES(exchange_rate_public), reserve_public=VALUES(reserve_public),
			supply_public=VALUES(supply_public), fiat_payout_notice=VALUES(fiat_payout_notice)
	`;
}

async function writeRateHistory(
	tx: Awaited<ReturnType<typeof getDB>>,
	guildId: string,
	reserveAmount: string,
	tokenSupply: string,
	eventType: string,
	reserveEventId: string | null,
	redemptionId: string | null
) {
	await tx`
		INSERT INTO exchange_rate_history (
			guild_id, reserve_amount, token_supply, exchange_rate, event_type, reserve_event_id, redemption_id
		) VALUES (
			${guildId}, ${reserveAmount}, ${tokenSupply},
			${rateFromCents(moneyToCents(reserveAmount), moneyToCents(tokenSupply))}, ${eventType},
			${reserveEventId}, ${redemptionId}
		)
	`;
}

export async function adjustReportedReserve(input: {
	guildId: string;
	administratorId: string;
	delta: string;
	reason: string;
	referenceNumber?: string | null;
	notes?: string | null;
}) {
	const db = await getDB();
	return db.begin(async (tx) => {
		await tx`INSERT IGNORE INTO fiat_reserves (guild_id) VALUES (${input.guildId})`;
		const rows = await tx`SELECT amount FROM fiat_reserves WHERE guild_id=${input.guildId} FOR UPDATE`;
		const before = moneyToCents(formatMoney(rows[0]?.amount));
		const delta = moneyToCents(input.delta);
		const after = before + delta;
		if (after < 0n) throw new InsufficientReserveError();
		const beforeAmount = centsToMoney(before);
		const afterAmount = centsToMoney(after);
		await tx`UPDATE fiat_reserves SET amount=${afterAmount} WHERE guild_id=${input.guildId}`;
		const event = await tx`
			INSERT INTO fiat_reserve_events (
				guild_id, event_type, amount_delta, reserve_before, reserve_after, reason, reference_number, notes, created_by
			) VALUES (
				${input.guildId}, ${delta > 0n ? 'reserve_addition' : 'reserve_adjustment'}, ${input.delta},
				${beforeAmount}, ${afterAmount}, ${input.reason}, ${input.referenceNumber || null}, ${input.notes || null}, ${input.administratorId}
			)
		`;
		const supply = await totalSupply(tx, input.guildId);
		await writeRateHistory(
			tx,
			input.guildId,
			afterAmount,
			supply,
			delta > 0n ? 'reserve_addition' : 'reserve_adjustment',
			String(event.lastInsertRowid),
			null
		);
		return {
			reserveBefore: beforeAmount,
			reserveAfter: afterAmount,
			tokenSupply: supply,
			rateBefore: rateFromCents(before, moneyToCents(supply)),
			rateAfter: rateFromCents(after, moneyToCents(supply))
		};
	});
}

export async function redeemAndBurn(input: {
	guildId: string;
	userId: string;
	administratorId: string;
	tokenAmount: string;
	referenceNumber?: string | null;
	notes?: string | null;
}) {
	const db = await getDB();
	return db.begin(async (tx) => {
		const settingsRows = await tx`SELECT fiat_economy_enabled FROM guild_settings WHERE guild_id=${input.guildId} LIMIT 1 FOR UPDATE`;
		if (!settingsRows[0] || !Boolean(settingsRows[0].fiat_economy_enabled))
			throw new FiatEconomyDisabledError();
		await tx`INSERT IGNORE INTO fiat_reserves (guild_id) VALUES (${input.guildId})`;
		const reserveRows = await tx`SELECT amount FROM fiat_reserves WHERE guild_id=${input.guildId} FOR UPDATE`;
		await tx`INSERT IGNORE INTO accounts (guild_id, user_id) VALUES (${input.guildId}, ${input.userId})`;
		const accountRows = await tx`SELECT balance FROM accounts WHERE guild_id=${input.guildId} AND user_id=${input.userId} FOR UPDATE`;
		const reserveBefore = moneyToCents(formatMoney(reserveRows[0]?.amount));
		const balance = moneyToCents(formatMoney(accountRows[0]?.balance));
		const tokenAmount = moneyToCents(input.tokenAmount);
		if (balance < tokenAmount) throw new InvalidRedemptionError();
		const supplyBefore = moneyToCents(await totalSupply(tx, input.guildId));
		if (reserveBefore <= 0n || supplyBefore <= 0n) throw new InvalidRedemptionError();
		const fiatAmount = (tokenAmount * reserveBefore) / supplyBefore;
		if (fiatAmount < 1n) throw new InvalidRedemptionError();
		if (reserveBefore < fiatAmount) throw new InsufficientReserveError();
		const reserveAfter = reserveBefore - fiatAmount;
		const supplyAfter = supplyBefore - tokenAmount;
		const redemptionId = crypto.randomUUID();
		await tx`UPDATE accounts SET balance=${centsToMoney(balance - tokenAmount)} WHERE guild_id=${input.guildId} AND user_id=${input.userId}`;
		await tx`UPDATE fiat_reserves SET amount=${centsToMoney(reserveAfter)} WHERE guild_id=${input.guildId}`;
		await tx`INSERT INTO transactions (guild_id, sender_id, recipient_id, amount, transaction_type) VALUES (${input.guildId}, ${input.userId}, ${null}, ${input.tokenAmount}, 'redemption_burn')`;
		await tx`
			INSERT INTO currency_redemptions (
				id, guild_id, user_id, administrator_id, token_amount, fiat_amount, reserve_before, reserve_after,
				supply_before, supply_after, reference_number, notes
			) VALUES (
				${redemptionId}, ${input.guildId}, ${input.userId}, ${input.administratorId}, ${input.tokenAmount}, ${centsToMoney(fiatAmount)},
				${centsToMoney(reserveBefore)}, ${centsToMoney(reserveAfter)}, ${centsToMoney(supplyBefore)}, ${centsToMoney(supplyAfter)},
				${input.referenceNumber || null}, ${input.notes || null}
			)
		`;
		const reserveEvent = await tx`
			INSERT INTO fiat_reserve_events (
				guild_id, event_type, amount_delta, reserve_before, reserve_after, reason, reference_number, notes, created_by
			) VALUES (
				${input.guildId}, 'redemption_burn', ${centsToMoney(-fiatAmount)}, ${centsToMoney(reserveBefore)}, ${centsToMoney(reserveAfter)},
				'준비금 연계 소각', ${input.referenceNumber || null}, ${input.notes || null}, ${input.administratorId}
			)
		`;
		await writeRateHistory(tx, input.guildId, centsToMoney(reserveAfter), centsToMoney(supplyAfter), 'redemption_burn', String(reserveEvent.lastInsertRowid), redemptionId);
		return {
			id: redemptionId,
			fiatAmount: centsToMoney(fiatAmount),
			reserveBefore: centsToMoney(reserveBefore),
			reserveAfter: centsToMoney(reserveAfter),
			supplyBefore: centsToMoney(supplyBefore),
			supplyAfter: centsToMoney(supplyAfter),
			rateBefore: rateFromCents(reserveBefore, supplyBefore),
			rateAfter: rateFromCents(reserveAfter, supplyAfter)
		};
	});
}

export function calculateFiatValue(snapshot: FiatEconomySnapshot, tokenAmount: string): string | null {
	if (!snapshot.enabled) return null;
	const reserve = moneyToCents(snapshot.reserveAmount);
	const supply = moneyToCents(snapshot.tokenSupply);
	if (reserve <= 0n || supply <= 0n) return null;
	return centsToMoney((moneyToCents(tokenAmount) * reserve) / supply);
}

export async function listExchangeRateCandles(guildId: string, limit = 120) {
	const db = await getDB();
	const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 240));
	const rows = await db`
		SELECT exchange_rate, created_at
		FROM exchange_rate_history
		WHERE guild_id=${guildId} AND exchange_rate IS NOT NULL
		ORDER BY id DESC
		LIMIT ${safeLimit}
	`;
	const buckets = new Map<string, { time: number; label: string; open: string; high: string; low: string; close: string }>();
	for (const row of [...rows].reverse() as Array<Record<string, unknown>>) {
		const date = new Date(row.created_at as string | number | Date);
		const label = new Intl.DateTimeFormat('sv-SE', {
			timeZone: 'Asia/Seoul',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit'
		}).format(date);
		const value = String(row.exchange_rate);
		const existing = buckets.get(label);
		if (!existing) {
			buckets.set(label, {
				time: Math.floor(date.getTime() / 1000),
				label,
				open: value,
				high: value,
				low: value,
				close: value
			});
			continue;
		}
		existing.close = value;
		if (Number(value) > Number(existing.high)) existing.high = value;
		if (Number(value) < Number(existing.low)) existing.low = value;
	}
	return [...buckets.values()];
}
