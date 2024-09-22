// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface PackageChange {
    name: string;
    oldVersion: string;
    newVersion: string;
}
const viewTypes = [
		{
			type: 'nice',
			description : 'Table format with headings'
		},
		{
			type: 'minimal',
			description : 'Outputs just the package name and oldVersion -> newVersion'
		}
	];

// This method is called when the extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// This line of code will only be executed once when your extension is activated
	console.log('update-packages-summary is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const diffPackageLock = vscode.commands.registerCommand('update-packages-summary.diffPackageLock', async () => {
		await doOperation('package-lock.json');
	});

	const diffComposerLock = vscode.commands.registerCommand('update-packages-summary.diffComposerLock', async () => {
		await doOperation('composer.lock');
	});

	context.subscriptions.push(diffPackageLock);
	context.subscriptions.push(diffComposerLock);
}

async function doOperation(fileType: string) {
	  const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active file');
            return;
        }

        const filePath = editor.document.uri.fsPath;
        if (path.basename(filePath) !== fileType) {
            vscode.window.showErrorMessage(`This command only works with ${fileType} files`);
            return;
        }

        const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('File is not part of a workspace');
            return;
        }
		//Might use quickPick later, but want to keep unrestricted
		// // Get list of recent commits
        //     const { stdout: commitList } = await execAsync('git log --oneline -n 5', { cwd: workspaceFolder.uri.fsPath });
        //     const commits = commitList.split('\n').map(line => {
        //         const [hash, ...messageParts] = line.split(' ');
        //         return { hash, message: messageParts.join(' ') };
        //     });

        //     // Show  pick for old commit
        //     const oldCommit = await vscode.window.showQuickPick(
        //         commits.map(c => ({ label: c.hash, description: c.message })),
        //         { placeHolder: 'Select the old commit' }
        //     );

        const commit1 = await vscode.window.showInputBox({ prompt: 'Enter the hash of first commit' });
        const commit2 = await vscode.window.showInputBox({ prompt: 'Enter the hash of new commit' });

        if (!commit1 || !commit2) {
            vscode.window.showErrorMessage('Both commits are required');
            return;
        }

		 const view = await vscode.window.showQuickPick(
                viewTypes.map(v => ({ label: v.type, description: v.description })),
                { placeHolder: 'Select view type.' }
            );

        try {
            const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);
            const { stdout } = await execAsync(`git diff ${commit1}..${commit2} -- ${relativePath}`, { cwd: workspaceFolder.uri.fsPath });

            if (!stdout) {
                vscode.window.showInformationMessage('No differences found');
                return;
            }
			let packageChanges: PackageChange[] = [];
			switch (fileType) {
				case 'package-lock.json':
					packageChanges = parsePackageLockDiff(stdout);
					break;
				case 'composer.lock':
					packageChanges = parseComposerLockDiff(stdout);
					break;
				default:
					throw new Error("Cannot parse the lock file type: " + fileType);
			}
			displayPackageChanges(packageChanges, view?.label);
            
        } catch (error) {
            vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
}

function parsePackageLockDiff(diff: string): PackageChange[] {
    const changes: PackageChange[] = [];
    const lines = diff.split('\n'); //get lines from diff string
    let currentPackage = '';
	const versionRegex = /"version": "([^"]+)"/;
    const packageRegex = /"([^"]+)":/;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('         "')) { //line starting with 9 spaces add " to get package name.
			//1st group capture of characters in the double quotes which are not double quotes
            const packageName = line.match(packageRegex)?.[1]; 
            if (packageName) {
                currentPackage = packageName;
            }else{
				continue; //just go to next loop if the package name could not be extracted
			}
        } else if (line.startsWith('-            "version":')) { //line starts with - and 12 spaces to version
           const oldVersion = line.match(versionRegex)?.[1];//line should start with "version" and match the numbers in the quotes
			for (let j = i+1; j < lines.length; j++) {
				if(lines[j]?.startsWith('+            "version":')){
					const newVersion = lines[j].match(versionRegex)?.[1];
					if (oldVersion && newVersion) {
						changes.push({ name: currentPackage.trim(), oldVersion:oldVersion.trim(), newVersion: newVersion.trim() });
					}
					i = j; //let the next line for package name search start from after the new version name line
					break;
				}
			}
        }
    }

    return changes;
}

function parseComposerLockDiff(diff: string): PackageChange[] {
	 const changes: PackageChange[] = [];
    const lines = diff.split('\n'); //get lines from diff string
    let currentPackage = '';
	const versionRegex = /"version": "([^"]+)"/;
    const packageRegex = /"name": "([^"]+)"/;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
	
        if (line.startsWith('             "name":')) { //line starting with 13 spaces add " to get package name.
			//1st group capture of characters in the double quotes which are not double quotes
            const packageName = line.match(packageRegex)?.[1]; 
            if (packageName) {
                currentPackage = packageName;
            }else{
				continue; //just go to next loop if the package name could not be extracted
			}
        } else if (line.startsWith('-            "version":')) { //line starts with - and 12 spaces to version
           const oldVersion = line.match(versionRegex)?.[1];//line should start with "version" and match the numbers in the quotes
			for (let j = i+1; j < lines.length; j++) {
				if(lines[j]?.startsWith('+            "version":')){
					const newVersion = lines[j].match(versionRegex)?.[1];
					if (oldVersion && newVersion) {
						changes.push({ name: currentPackage.trim(), oldVersion:oldVersion.trim(), newVersion: newVersion.trim() });
					}
					i = j; //let the next line for package name search start from after the new version name line
					break;
				}
			}
        }
    }

    return changes;
}

function displayPackageChanges(changes: PackageChange[], display: string = 'minimal') {
    const panel = vscode.window.createWebviewPanel(
        'packageChanges',
        'Package-lock.json Changes',
        vscode.ViewColumn.One,
        {}
    );

	switch (display) {
		case 'nice':
			panel.webview.html = getWebviewContentNice(changes);
			break;
		case 'minimal':
			panel.webview.html = getWebviewContentMinimal(changes);
			break;
		default:
			panel.webview.html = getWebviewContentMinimal(changes);
			break;
	}
    
}

function getWebviewContentNice(changes: PackageChange[]): string {
    const tableRows = changes.map(change => `
        <tr>
            <td>${change.name}</td>
            <td>${change.oldVersion}</td>
            <td>${change.newVersion}</td>
        </tr>
    `).join('');

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Package-lock.json Changes</title>
        <style>
            body { font-family: Arial, sans-serif; }
            table { border-collapse: collapse; width: 100%; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f2f2f2; }
        </style>
    </head>
    <body>
        <h1>Package Version Changes</h1>
        <table>
            <tr>
                <th>Package Name</th>
                <th>Old Version</th>
                <th>New Version</th>
            </tr>
            ${tableRows}
        </table>
    </body>
    </html>`;
}

function getWebviewContentMinimal(changes: PackageChange[]): string {
    const tableRows = changes.map(change => `
        <p>${change.name} ${change.oldVersion} -> ${change.newVersion}</p>
    `).join('');

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Package-lock.json Changes</title>
    </head>
    <body>
        <h1>Package Version Changes</h1>
        <div>
            ${tableRows}
        </div>
    </body>
    </html>`;
}


// This method is called when the extension is deactivated
export function deactivate() {}
