import * as path from 'path';
import Mocha from 'mocha';
import {glob} from 'glob';

export function run(): Promise<void> {
	// Create the mocha test
	const mocha = new Mocha({
		ui: 'tdd'
	});
 
	const testsRoot = path.resolve(__dirname, '..');

	return new Promise(async (resolve, reject) => {
		try {
			
			const files = await glob('**/**.test.js', { cwd: testsRoot });
			files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

			
			mocha.run(failures => {
				if (failures > 0) {
					reject(new Error(`${failures} tests failed.`));
				} else {
					resolve();
				}
			});
		} catch (err) {
			console.error(err);
			reject(err);
		}
	});
}