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

    const diffPubspecLock = vscode.commands.registerCommand('update-packages-summary.diffPubspecLock', async () => {
        await doOperation('pubspec.lock');
    });

    const diffYarnLock = vscode.commands.registerCommand('update-packages-summary.diffYarnLock', async () => {
        await doOperation('yarn.lock');
    });

    context.subscriptions.push(diffPackageLock, diffComposerLock, diffPubspecLock, diffYarnLock);
}

/**
 * Shows a QuickPick populated with the last 10 commits from git log.
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
            case 'pubspec.lock':
                packageChanges = parsePubspecLockDiff(stdout);
                break;
            case 'yarn.lock':
                packageChanges = parseYarnLockDiff(stdout);
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
 * Parses a git diff of pubspec.lock and returns changed package versions.
 *
 * pubspec.lock structure (per package):
 *   <package-name>:          ← 2-space indent, bare key — this is the name
 *     dependency: ...
 *     description:
 *       name: <package-name>
 *       sha256: ...
 *       url: ...
 *     source: hosted
 *     version: "1.2.3"       ← 4-space indent — this is the version
 *
 * Strategy:
 *  - Track currentPackage from context lines (space-prefixed) that match the
 *    2-space-indented bare-key pattern. Only context lines are used so that
 *    wholly-added or wholly-removed package blocks don't corrupt the tracker.
 *  - Pair each removed `version:` line with the next added `version:` line.
 */
export function parsePubspecLockDiff(diff: string): PackageChange[] {
    const changes: PackageChange[] = [];
    const lines = diff.split('\n');
    let currentPackage = '';

    // In the raw diff a context line starts with ' ' (space).
    // A 2-space-indented bare key in the file becomes 3 leading spaces in the diff:
    // " " (diff marker) + "  " (file indent) + "package-name:"
    const packageNameRegex = /^ {3}([\w][\w_-]*):\s*$/;

    // Matches the version value inside quotes or unquoted: version: "1.2.3" or version: 1.2.3
    const versionRegex = /version:\s+"?([^"\s]+)"?/;

    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const isContext = !rawLine.startsWith('-') && !rawLine.startsWith('+');

        // Only update currentPackage from context lines at the package-name indent level.
        if (isContext) {
            const pkgMatch = rawLine.match(packageNameRegex);
            if (pkgMatch) {
                currentPackage = pkgMatch[1];
            }
        }

        // Detect a removed version line and pair it with the next added version line.
        if (rawLine.startsWith('-') && rawLine.includes('version:')) {
            const oldVersion = rawLine.match(versionRegex)?.[1];
            for (let j = i + 1; j < lines.length; j++) {
                if (lines[j].startsWith('+') && lines[j].includes('version:')) {
                    const newVersion = lines[j].match(versionRegex)?.[1];
                    if (oldVersion && newVersion && currentPackage) {
                        changes.push({ name: currentPackage, oldVersion, newVersion });
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
 * Parses a git diff of yarn.lock and returns changed package versions.
 *
 * Supports both yarn classic (v1) and yarn berry (v2) lock file formats.
 *
 * yarn.lock v1 structure (per package):
 *   react@^18.0.0:          ← top-level key, no indent
 *     version "18.3.1"      ← 2-space indent, quoted value
 *
 * yarn.lock v2 (berry) structure:
 *   "react@npm:^18.0.0":    ← quoted top-level key
 *     version: 18.3.1       ← 2-space indent, unquoted value
 *
 * Strategy:
 *  - Track currentPackage only from context lines (space-prefixed in the diff)
 *    that match the top-level, no-indent, contains-'@', ends-with-':' pattern.
 *    Skipping +/- header lines prevents wholly-added/removed entries from
 *    corrupting the tracker.
 *  - Pair each removed `version` line with the next added `version` line.
 */
export function parseYarnLockDiff(diff: string): PackageChange[] {
    const changes: PackageChange[] = [];
    const lines = diff.split('\n');
    let currentPackage = '';

    // Matches the package name from a yarn.lock header entry.
    // Handles scoped packages (@scope/name@...) and regular names (react@...),
    // as well as quoted entries ("react@npm:...") used by yarn berry.
    const packageHeaderRegex = /^"?(@[^@]+|[^@"]+)@/;

    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];

        // Context lines in a diff start with exactly one space.
        // Package headers in yarn.lock have no file-level indentation, so after
        // stripping the diff space marker the content must not start with a space.
        if (rawLine.startsWith(' ')) {
            const content = rawLine.slice(1);
            if (!content.startsWith(' ') && content.includes('@') && content.trimEnd().endsWith(':')) {
                const match = content.match(packageHeaderRegex);
                if (match) {
                    currentPackage = match[1];
                }
            }
        }

        // Detect a removed version line and pair it with the next added version line.
        if (rawLine.startsWith('-') && rawLine.includes('version')) {
            const content = rawLine.slice(1);
            // v1: `  version "1.0.0"`   v2: `  version: 1.0.0` or `  version: "1.0.0"`
            const oldVersion =
                content.match(/^\s+version "([^"]+)"/)?.[1] ??
                content.match(/^\s+version:\s+"?([^"\s]+)"?/)?.[1];

            if (!oldVersion) { continue; }

            for (let j = i + 1; j < lines.length; j++) {
                if (lines[j].startsWith('+') && lines[j].includes('version')) {
                    const nc = lines[j].slice(1);
                    const newVersion =
                        nc.match(/^\s+version "([^"]+)"/)?.[1] ??
                        nc.match(/^\s+version:\s+"?([^"\s]+)"?/)?.[1];
                    if (newVersion && currentPackage) {
                        changes.push({ name: currentPackage, oldVersion, newVersion });
                    }
                    i = j;
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
