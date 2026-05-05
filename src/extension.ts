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
    { type: 'nice', description: 'Table format with headings' },
    { type: 'minimal', description: 'Outputs just the package name and oldVersion -> newVersion' },
];

const ENTER_MANUALLY_LABEL = 'Enter hash manually...';

export function activate(context: vscode.ExtensionContext) {
    console.log('update-packages-summary is now active!');

    const diffPackageLock = vscode.commands.registerCommand('update-packages-summary.diffPackageLock', async () => {
        await doOperation('package-lock.json');
    });

    const diffComposerLock = vscode.commands.registerCommand('update-packages-summary.diffComposerLock', async () => {
        await doOperation('composer.lock');
    });

    const diffPubspecYaml = vscode.commands.registerCommand('update-packages-summary.diffPubspecYaml', async () => {
        await doOperation('pubspec.yaml');
    });

    context.subscriptions.push(diffPackageLock, diffComposerLock, diffPubspecYaml);
}

/**
 * Shows a QuickPick populated with the last 20 commits from git log.
 * A "Enter hash manually..." item at the top lets the user type any hash freely.
 * Returns the selected/typed commit hash, or undefined if the user cancelled.
 */
async function pickCommit(workspacePath: string, placeHolder: string): Promise<string | undefined> {
    let commitItems: vscode.QuickPickItem[] = [];

    try {
        const { stdout } = await execAsync('git log --oneline -n 10', { cwd: workspacePath });
        commitItems = stdout
            .trim()
            .split('\n')
            .filter(Boolean)
            .map(line => {
                const spaceIdx = line.indexOf(' ');
                const hash = line.slice(0, spaceIdx);
                const message = line.slice(spaceIdx + 1);
                return { label: hash, description: message };
            });
    } catch {
        // git log failed (no commits yet, etc.) — fall through to manual entry
    }

    const items: vscode.QuickPickItem[] = [
        { label: ENTER_MANUALLY_LABEL, description: 'Type any commit hash or ref' },
        ...commitItems,
    ];

    const picked = await vscode.window.showQuickPick(items, { placeHolder });
    if (!picked) {
        return undefined;
    }

    if (picked.label === ENTER_MANUALLY_LABEL) {
        return vscode.window.showInputBox({ prompt: placeHolder, placeHolder: 'e.g. a1b2c3d' });
    }

    return picked.label;
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

    const workspacePath = workspaceFolder.uri.fsPath;

    const commit1 = await pickCommit(workspacePath, 'Select or enter the old (before) commit');
    if (!commit1) {
        vscode.window.showErrorMessage('Old commit is required');
        return;
    }

    const commit2 = await pickCommit(workspacePath, 'Select or enter the new (after) commit');
    if (!commit2) {
        vscode.window.showErrorMessage('New commit is required');
        return;
    }

    const view = await vscode.window.showQuickPick(
        viewTypes.map(v => ({ label: v.type, description: v.description })),
        { placeHolder: 'Select view type.' }
    );

    try {
        const relativePath = path.relative(workspacePath, filePath);
        const { stdout } = await execAsync(
            `git diff ${commit1}..${commit2} -- ${relativePath}`,
            { cwd: workspacePath }
        );

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
            case 'pubspec.yaml':
                packageChanges = parsePubspecYamlDiff(stdout);
                break;
            default:
                throw new Error('Cannot parse the lock file type: ' + fileType);
        }

        displayPackageChanges(packageChanges, view?.label);
    } catch (error) {
        vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export function parsePackageLockDiff(diff: string): PackageChange[] {
    const changes: PackageChange[] = [];
    const lines = diff.split('\n');
    let currentPackage = '';
    const versionRegex = /"version":\s*"([^"]+)"/;
    const packageRegex = /"([^"]+)":\s*{/;
    const nodeModulesPrefix = 'node_modules/';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line.match(packageRegex)) {
            const packageName = line.match(packageRegex)?.[1];
            if (packageName) {
                currentPackage = packageName.startsWith(nodeModulesPrefix)
                    ? packageName.slice(nodeModulesPrefix.length)
                    : packageName;
            } else {
                continue;
            }
        } else if (line.startsWith('-') && line.includes('"version":')) {
            const oldVersion = line.match(versionRegex)?.[1];
            for (let j = i + 1; j < lines.length; j++) {
                const newLine = lines[j].trim();
                if (newLine.startsWith('+') && newLine.includes('"version":')) {
                    const newVersion = lines[j].match(versionRegex)?.[1];
                    if (oldVersion && newVersion) {
                        changes.push({ name: currentPackage.trim(), oldVersion: oldVersion.trim(), newVersion: newVersion.trim() });
                    }
                    i = j;
                    break;
                }
            }
        }
    }

    return changes;
}

export function parseComposerLockDiff(diff: string): PackageChange[] {
    const changes: PackageChange[] = [];
    const lines = diff.split('\n');
    let currentPackage = '';
    const versionRegex = /"version":\s*"([^"]+)"/;
    const packageRegex = /"name": "([^"]+)"/;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Only update currentPackage from context lines (space-prefixed in the diff).
        // Removed (-) or added (+) "name": lines belong to packages being wholly
        // deleted/added, not version-bumped, so they must not overwrite the tracker.
        const rawLine = lines[i];
        const isContextLine = !rawLine.startsWith('-') && !rawLine.startsWith('+');

        if (isContextLine && line.startsWith('"name":')) {
            const packageName = line.match(packageRegex)?.[1];
            if (packageName) {
                currentPackage = packageName;
            } else {
                continue;
            }
        } else if (line.startsWith('-') && line.includes('"version":')) {
            const oldVersion = line.match(versionRegex)?.[1];
            for (let j = i + 1; j < lines.length; j++) {
                const newLine = lines[j].trim();
                if (newLine.startsWith('+') && newLine.includes('"version":')) {
                    const newVersion = lines[j].match(versionRegex)?.[1];
                    if (oldVersion && newVersion) {
                        changes.push({ name: currentPackage.trim(), oldVersion: oldVersion.trim(), newVersion: newVersion.trim() });
                    }
                    i = j;
                    break;
                }
            }
        }
    }

    return changes;
}

/**
 * Parses a git diff of pubspec.yaml and returns changed package versions.
 *
 * Handles the standard single-line format used for pub.dev packages:
 *   dependencies:
 *     http: ^0.13.0   →   http: ^1.2.0
 *
 * Each removed line (-) with `name: version` is paired with the nearest
 * following added line (+) for the same package name.
 */
export function parsePubspecYamlDiff(diff: string): PackageChange[] {
    const changes: PackageChange[] = [];
    const lines = diff.split('\n');

    // Matches a removed dependency line: `-  package_name: <version_constraint>`
    // The version constraint must start with a digit or ^ so we avoid section
    // headers like `- dependencies:` (no value) or `- flutter:` (sub-keys only).
    const removedLineRegex = /^-[ \t]+([\w][\w_-]*):\s+(\S.*)/;

    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(removedLineRegex);
        if (!match) {
            continue;
        }

        const packageName = match[1];
        const oldVersion = match[2].trim();

        // Skip lines that look like YAML section keys rather than version values
        // (a bare key with no version digit anywhere, e.g. `- flutter:  `)
        if (!/\d/.test(oldVersion)) {
            continue;
        }

        // Escape special regex characters in the package name before reusing it
        const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const addedLineRegex = new RegExp(`^\\+[ \\t]+${escapedName}:\\s+(\\S.*)`);

        for (let j = i + 1; j < lines.length; j++) {
            const newMatch = lines[j].match(addedLineRegex);
            if (newMatch) {
                const newVersion = newMatch[1].trim();
                changes.push({ name: packageName, oldVersion, newVersion });
                i = j;
                break;
            }

            // Stop scanning ahead if we hit another removed line for a different package
            if (removedLineRegex.test(lines[j])) {
                break;
            }
        }
    }

    return changes;
}

function displayPackageChanges(changes: PackageChange[], display: string = 'minimal') {
    const panel = vscode.window.createWebviewPanel(
        'packageChanges',
        'Package Changes',
        vscode.ViewColumn.One,
        {}
    );

    switch (display) {
        case 'nice':
            panel.webview.html = getWebviewContentNice(changes);
            break;
        case 'minimal':
        default:
            panel.webview.html = getWebviewContentMinimal(changes);
            break;
    }
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function getWebviewContentNice(changes: PackageChange[]): string {
    const tableRows = changes.map(change => `
        <tr>
            <td>${escapeHtml(change.name)}</td>
            <td>${escapeHtml(change.oldVersion)}</td>
            <td>${escapeHtml(change.newVersion)}</td>
        </tr>
    `).join('');

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Package Changes</title>
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

export function getWebviewContentMinimal(changes: PackageChange[]): string {
    const rows = changes.map(change => `
        <p>${escapeHtml(change.name)} ${escapeHtml(change.oldVersion)} -&gt; ${escapeHtml(change.newVersion)}</p>
    `).join('');

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Package Changes</title>
    </head>
    <body>
        <h1>Package Version Changes</h1>
        <div>
            ${rows}
        </div>
    </body>
    </html>`;
}

// This method is called when the extension is deactivated
export function deactivate() {}
