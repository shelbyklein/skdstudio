import { spawn } from 'child_process';
import { resolve } from 'path';

const root = resolve( import.meta.dirname, '..' );

console.log( '=> Starting Electron...' );
const electronVite = spawn(
	'npx',
	[ 'electron-vite', 'dev', '--config', './electron.vite.config.ts', '--outDir=dist', '--watch' ],
	{
		stdio: 'inherit',
		cwd: resolve( root, 'apps/studio' ),
		shell: true,
		env: { ...process.env },
	}
);

electronVite.on( 'close', ( code ) => {
	process.exit( code ?? 0 );
} );

process.on( 'SIGINT', () => {
	if ( ! electronVite.killed ) {
		electronVite.kill();
	}
} );
