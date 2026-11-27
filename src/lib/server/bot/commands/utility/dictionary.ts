import {
	EmbedBuilder,
	Locale,
	MessageFlags,
	SlashCommandBuilder,
	type ChatInputCommandInteraction
} from 'discord.js';
import { getLanguage } from '$lib/server/bot/i18n';

const data = new SlashCommandBuilder()
	.setName('dictionary')
	.setNameLocalizations({ [Locale.Korean]: '사전', [Locale.Japanese]: '辞書' })
	.setDescription('Search the Zasoque dictionary.')
	.setDescriptionLocalizations({
		[Locale.Korean]: '자소크어 사전에서 어휘를 검색합니다.',
		[Locale.Japanese]: 'ザソク語辞典で語彙を検索します。'
	})
	.addStringOption((option) =>
		option
			.setName('query')
			.setNameLocalizations({ [Locale.Korean]: '검색어', [Locale.Japanese]: '検索語' })
			.setDescription('Word or text to search for.')
			.setDescriptionLocalizations({
				[Locale.Korean]: '검색할 단어 또는 문자열입니다.',
				[Locale.Japanese]: '検索する単語または文字列です。'
			})
			.setMaxLength(100)
			.setRequired(true)
	)
	.addIntegerOption((option) =>
		option
			.setName('count')
			.setNameLocalizations({ [Locale.Korean]: '개수', [Locale.Japanese]: '件数' })
			.setDescription('Maximum number of entries to show (1–5).')
			.setDescriptionLocalizations({
				[Locale.Korean]: '표시할 어휘의 최대 개수입니다 (1~5).',
				[Locale.Japanese]: '表示する語彙の最大件数です（1～5）。'
			})
			.setMinValue(1)
			.setMaxValue(5)
	)
	.addBooleanOption((option) =>
		option
			.setName('public')
			.setNameLocalizations({ [Locale.Korean]: '공개', [Locale.Japanese]: '公開' })
			.setDescription('Let everyone in the channel see the results.')
			.setDescriptionLocalizations({
				[Locale.Korean]: '채널의 다른 사용자에게도 검색 결과를 공개합니다.',
				[Locale.Japanese]: 'チャンネルの他のユーザーにも検索結果を公開します。'
			})
	)
	.setDMPermission(false);

interface DictionaryEntry {
	id: string | number;
	표제어: string;
	음소?: string;
	명사?: string;
	형용사?: string;
	동사?: string;
	부사?: string;
	기타?: string;
	비고?: string;
	한자?: string;
	'어원 언어'?: string;
	어원?: string;
	similarity: number;
}

interface DictionaryResponse {
	total: number;
	data: DictionaryEntry[];
}

class DictionaryResponseError extends Error {}

const messages = {
	query: {
		en: 'Please enter a search term.',
		ko: '검색어를 입력해 주세요.',
		ja: '検索語を入力してください。'
	},
	noResults: {
		en: 'No search results.',
		ko: '검색 결과가 없습니다.',
		ja: '検索結果がありません。'
	},
	connection: {
		en: 'Could not connect to the dictionary.',
		ko: '사전에 연결할 수 없습니다.',
		ja: '辞典に接続できません。'
	},
	format: {
		en: 'Could not load dictionary data.',
		ko: '사전 데이터를 불러올 수 없습니다.',
		ja: '辞典データを読み込めませんでした。'
	},
	timeout: {
		en: 'The dictionary response timed out.',
		ko: '사전 응답 시간이 초과되었습니다.',
		ja: '辞典の応答がタイムアウトしました。'
	}
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseResponse(value: unknown): DictionaryResponse {
	if (!isRecord(value) || !Array.isArray(value.data)) throw new DictionaryResponseError();
	const total = value.total;
	if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) {
		throw new DictionaryResponseError();
	}
	const entries = value.data.map((item): DictionaryEntry => {
		if (
			!isRecord(item) ||
			!(typeof item.id === 'string' || typeof item.id === 'number') ||
			typeof item['표제어'] !== 'string' ||
			typeof item.similarity !== 'number' ||
			!Number.isFinite(item.similarity)
		) {
			throw new DictionaryResponseError();
		}
		return item as unknown as DictionaryEntry;
	});
	return { total, data: entries };
}

async function searchDictionary(query: string, count: number): Promise<DictionaryResponse> {
	const configuredUrl = process.env.CRISPIQUETION_API_URL;
	if (!configuredUrl) throw new Error('Dictionary API URL is not configured.');

	let url: URL;
	try {
		url = new URL(configuredUrl);
	} catch {
		throw new Error('Dictionary API URL is invalid.');
	}
	url.searchParams.set('sheet', '자소크어');
	url.searchParams.set('q', query);
	url.searchParams.set('limit', String(count));

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 15_000);
	try {
		const response = await fetch(url, {
			method: 'GET',
			redirect: 'follow',
			signal: controller.signal
		});
		if (!response.ok) throw new Error(`Dictionary API returned ${response.status}.`);
		let body: unknown;
		try {
			body = await response.json();
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') throw error;
			throw new DictionaryResponseError();
		}
		return parseResponse(body);
	} finally {
		clearTimeout(timeout);
	}
}

function clip(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	return maxLength <= 1 ? '…' : `${value.slice(0, maxLength - 1)}…`;
}

function entryValue(entry: DictionaryEntry): string {
	const lines: string[] = [];
	for (const [label, value] of [
		['명사', entry.명사],
		['형용사', entry.형용사],
		['동사', entry.동사],
		['부사', entry.부사],
		['기타', entry.기타],
		['한자', entry.한자],
		['비고', entry.비고],
		['어원 언어', entry['어원 언어']],
		['어원', entry.어원]
	] as const) {
		if (typeof value === 'string' && value.trim()) lines.push(`**${label}:** ${value}`);
	}
	lines.push(`**ID:** ${entry.id}`);
	lines.push(`**유사도:** ${clip((entry.similarity * 100).toFixed(2).replace(/\.?0+$/, ''), 20)}%`);
	return lines.join('\n');
}

function buildEmbed(query: string, result: DictionaryResponse, count: number) {
	const entries = result.data.slice(0, count);
	const description = `검색어: **${query}**\n전체 검색 결과: **${result.total}개** · 출력: **${entries.length}개**`;
	const embed = new EmbedBuilder()
		.setTitle('Crispiquétion')
		.setDescription(clip(description, 4096))
		.setFooter({ text: '자소크어 사전' });

	let remaining = 6000 - 'Crispiquétion'.length - description.length - '자소크어 사전'.length;
	for (const entry of entries) {
		if (remaining <= 0) break;
		const name = clip(`${entry.표제어}${entry.음소 ? ` (${entry.음소})` : ''}`, 256);
		const nameCost = name.length;
		const valueBudget = Math.min(1024, remaining - nameCost);
		if (valueBudget < 1) break;
		const value = clip(entryValue(entry), valueBudget);
		embed.addFields({ name, value, inline: false });
		remaining -= nameCost + value.length;
	}
	return embed;
}

async function execute(interaction: ChatInputCommandInteraction) {
	const language = getLanguage(interaction.locale);
	const query = interaction.options.getString('query', true).trim();
	const count = interaction.options.getInteger('count') ?? 1;
	const isPublic = interaction.options.getBoolean('public') ?? false;
	const flags = isPublic ? undefined : MessageFlags.Ephemeral;
	const reply = (content: string) => interaction.editReply({ content });
	await interaction.deferReply({ flags });

	if (!query) {
		await reply(messages.query[language]);
		return;
	}

	try {
		const result = await searchDictionary(query, count);
		if (!result.data.length) {
			await reply(messages.noResults[language]);
			return;
		}
		await interaction.editReply({ embeds: [buildEmbed(query, result, count)] });
	} catch (error) {
		if (error instanceof DictionaryResponseError) {
			await reply(messages.format[language]);
		} else if (error instanceof Error && error.name === 'AbortError') {
			await reply(messages.timeout[language]);
		} else {
			console.error('Dictionary API request failed:', error);
			await reply(messages.connection[language]);
		}
	}
}

export default { data, execute };
