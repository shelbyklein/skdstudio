import path from 'path';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';

export const STUDIO_CLI_HOME = getConfigDirectory();

export const PROCESS_MANAGER_HOME =
	process.env.STUDIO_PROCESS_MANAGER_HOME ?? path.join( STUDIO_CLI_HOME, 'daemon' );
export const PROCESS_MANAGER_LOGS_DIR = path.join( PROCESS_MANAGER_HOME, 'logs' );
export const PROCESS_MANAGER_CONTROL_SOCKET_PATH =
	process.platform === 'win32'
		? '\\\\.\\pipe\\skdstudio-daemon.sock'
		: path.join( PROCESS_MANAGER_HOME, 'daemon.sock' );
export const PROCESS_MANAGER_EVENTS_SOCKET_PATH =
	process.platform === 'win32'
		? '\\\\.\\pipe\\skdstudio-daemon-events.sock'
		: path.join( PROCESS_MANAGER_HOME, 'daemon-events.sock' );
