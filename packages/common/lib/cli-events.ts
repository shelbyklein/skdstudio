/**
 * Shared types for CLI events between CLI and Studio app.
 *
 * The CLI emits these events via the `_events` command, and Studio
 * subscribes to them to maintain its state without reading config files.
 */
import { z } from 'zod';
import { deployTargetSchema } from '@studio/common/lib/deploy-target';
import { siteFileAccessSchema } from '@studio/common/lib/site-file-access';
import { siteOperationSchema } from '@studio/common/lib/site-operation';
import { siteRuntimeSchema } from '@studio/common/lib/site-runtime';
import { wpEnvironmentTypeSchema } from '@studio/common/lib/wp-environment-type';

/**
 * Site data included in events. This is the data Studio needs to display sites.
 */
export const siteDetailsSchema = z.object( {
	id: z.string(),
	name: z.string(),
	path: z.string(),
	port: z.number(),
	url: z.string(),
	phpVersion: z.string(),
	runtime: siteRuntimeSchema.optional(),
	fileAccess: siteFileAccessSchema.optional(),
	customDomain: z.string().optional(),
	enableHttps: z.boolean().optional(),
	adminUsername: z.string().optional(),
	adminPassword: z.string().optional(),
	adminEmail: z.string().optional(),
	isWpAutoUpdating: z.boolean().optional(),
	enableXdebug: z.boolean().optional(),
	enableDebugLog: z.boolean().optional(),
	enableDebugDisplay: z.boolean().optional(),
	enableScriptDebug: z.boolean().optional(),
	environmentType: wpEnvironmentTypeSchema.optional(),
	technicalSiteDirectory: z.string().optional(),
	// The server `studio deploy` pushes this site to, when one has been set up.
	deployTarget: deployTargetSchema.optional(),
	runtimeBlueprintPath: z.string().optional(),
	landingPage: z.string().optional(),
	// The in-flight Studio operation holding the site, if any. The UI disables
	// the actions it blocks, so it stays correct even when the agent started it.
	operation: siteOperationSchema.optional(),
} );

export type SiteDetails = z.infer< typeof siteDetailsSchema >;

export const siteListItemSchema = siteDetailsSchema.extend( {
	running: z.boolean(),
} );

export type SiteListItem = z.infer< typeof siteListItemSchema >;

export const siteListSchema = z.array( siteListItemSchema );

export enum SITE_EVENTS {
	CREATED = 'site-created',
	UPDATED = 'site-updated',
	DELETED = 'site-deleted',
	// An operation was claimed or released. Deliberately not `UPDATED`: that one
	// asserts whether the site is running and consumers treat it as
	// authoritative, which this event knows nothing about. Reusing it here is
	// what broke the startup performance metric.
	OPERATIONS_CHANGED = 'site-operations-changed',
}

export const siteEventSchema = z.object( {
	event: z.enum( SITE_EVENTS ),
	siteId: z.string(),
	site: siteDetailsSchema.optional(),
	running: z.boolean(),
} );

export type SiteEvent = z.infer< typeof siteEventSchema >;

/**
 * Socket-level schemas for events sent between daemon-client and the _events command.
 */
export const socketEventSchema = z.object( {
	event: z.enum( SITE_EVENTS ),
	data: z.object( {
		siteId: z.string(),
	} ),
} );
export type SocketEvent = z.infer< typeof socketEventSchema >;

/**
 * CLI stdout key-value pair schemas for events parsed by Studio's cli-events-subscriber.
 */
export const cliSiteEventSchema = z.object( {
	action: z.literal( 'keyValuePair' ),
	key: z.literal( 'site-event' ),
	value: z
		.string()
		.transform( ( val ) => JSON.parse( val ) )
		.pipe( siteEventSchema ),
} );
