import { Locale } from 'discord.js';

export type SupportedLanguage = 'en' | 'ko' | 'ja';

export function getLanguage(locale: Locale): SupportedLanguage {
	if (locale === Locale.Korean) return 'ko';
	if (locale === Locale.Japanese) return 'ja';
	return 'en';
}
