import zh from './zh';
import en from './en';

export type Locale = typeof zh;

const locales: Record<string, Locale> = { zh, en };

export function getLocale(lang: string): Locale {
  return locales[lang] || locales.zh;
}

export { zh, en };
