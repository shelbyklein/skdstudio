import { SupportedLocale } from '@studio/common/lib/locale';

// English is always required, and the other locales are optional.
type TranslatedLink = Partial< Record< SupportedLocale, string > > & { en: string };

const DOCS_LINKS = {
	docsStudio: {
		en: 'https://developer.wordpress.com/docs/developer-tools/studio/',
		es: 'https://developer.wordpress.com/es/docs/herramientas-para-desarrolladores/studio/',
	},
	docsImportExport: {
		en: 'https://developer.wordpress.com/docs/developer-tools/studio/import-export/',
		es: 'https://developer.wordpress.com/es/docs/herramientas-para-desarrolladores/studio/importar-exportar/',
	},
	docsSites: {
		en: 'https://developer.wordpress.com/docs/developer-tools/studio/sites/',
		es: 'https://developer.wordpress.com/es/docs/herramientas-para-desarrolladores/studio/sitios/',
	},
	docsCli: {
		en: 'https://developer.wordpress.com/docs/developer-tools/studio/cli/',
		es: 'https://developer.wordpress.com/es/docs/herramientas-para-desarrolladores/studio/cli/',
	},
	docsBlueprints: {
		en: 'https://developer.wordpress.com/docs/developer-tools/studio/blueprints/',
	},
	docsXdebug: {
		en: 'https://developer.wordpress.com/docs/developer-tools/studio/xdebug/',
	},
	docsSslInStudio: {
		en: 'https://developer.wordpress.com/docs/developer-tools/studio/ssl-in-studio/',
	},
	docsPhpRuntimes: {
		en: 'https://developer.wordpress.com/docs/developer-tools/studio/php-runtimes/',
	},
} satisfies Record< `docs${ string }`, TranslatedLink >;

const LINKS = {
	...DOCS_LINKS,
} as const satisfies Record< string, TranslatedLink >;

export type DocsLinkKey = keyof typeof LINKS;

/**
 * Returns the link for the given locale if it exists, otherwise, returns the English link.
 */
export function getLocalizedLink( locale: SupportedLocale, linkKey: DocsLinkKey ): string {
	const links = LINKS[ linkKey ];
	if ( locale in links ) {
		return links[ locale as keyof typeof links ];
	}
	return links.en;
}
