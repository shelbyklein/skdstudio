/**
 * Progress the deploy CLI reports back to the desktop app.
 *
 * Deploys have no structured payload to stream the way import and export do —
 * the useful information is the step the CLI is on and how it went — so the
 * Logger's own messages are forwarded as-is rather than mirrored into a second
 * set of event types that would have to be kept in step with them.
 */
import { z } from 'zod';

export const deployProgressSchema = z.object( {
	action: z.string(),
	status: z.enum( [ 'inprogress', 'success', 'warning', 'fail' ] ),
	message: z.string(),
} );

export type DeployProgress = z.infer< typeof deployProgressSchema >;

/** What a caller can vary about a single deploy. */
export interface DeployRequest {
	/** Copy files only and leave the server's database alone. */
	skipDatabase?: boolean;
	/** Save a copy of the server's database before replacing it. Defaults to true. */
	backup?: boolean;
	/** Report what would change without writing anything to the server. */
	dryRun?: boolean;
}

export interface DeployState {
	/** True from the moment a deploy starts until it finishes or fails. */
	isDeploying: boolean;
	/** The step the deploy is on, for display. */
	statusMessage?: string;
	/** Set when the last deploy failed, cleared when a new one starts. */
	errorMessage?: string;
	/** Set when the last deploy finished, cleared when a new one starts. */
	completedAt?: number;
	/** Warnings the CLI reported along the way, such as an unrecognised remote directory. */
	warnings: string[];
}

export const INITIAL_DEPLOY_STATE: DeployState = {
	isDeploying: false,
	warnings: [],
};
