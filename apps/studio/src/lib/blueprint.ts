/**
 * A Blueprint the user picked in the add-site flow. Only file-based Blueprints
 * (a JSON file or a zip bundle) are supported; `filePath` points at the
 * extracted `blueprint.json` so the CLI can resolve bundled resources.
 */
export interface Blueprint {
	slug: string;
	title: string;
	excerpt: string;
	image: string;
	playground_url: string;
	blueprint: Record< string, unknown >;
	filePath?: string;
}
