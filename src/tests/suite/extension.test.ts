import * as assert from 'assert';
import * as vscode from 'vscode';
import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    suiteSetup(async () => {
        const extension = vscode.extensions.getExtension('archie20.update-packages-summary');
        if (extension) {
            await extension.activate();
        }
    });

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('archie20.update-packages-summary'));
    });

    test('Should register commands', async () => {
        const commands = await vscode.commands.getCommands();
        assert.ok(commands.includes('update-packages-summary.diffPackageLock'));
        assert.ok(commands.includes('update-packages-summary.diffComposerLock'));
        assert.ok(commands.includes('update-packages-summary.diffPubspecYaml'));
    });

    // ── parsePackageLockDiff ──────────────────────────────────────────────────

    test('parsePackageLockDiff should return correct changes', () => {
        const diff = `
         "package-name": {
-            "version": "1.0.0"
+            "version": "1.1.0"
        `;
        const changes = myExtension.parsePackageLockDiff(diff);
        assert.deepStrictEqual(changes, [
            { name: 'package-name', oldVersion: '1.0.0', newVersion: '1.1.0' },
        ]);
    });

    test('parsePackageLockDiff should strip node_modules/ prefix from package names', () => {
        const diff = `
         "node_modules/some-lib": {
-            "version": "2.0.0"
+            "version": "2.1.0"
        `;
        const changes = myExtension.parsePackageLockDiff(diff);
        assert.deepStrictEqual(changes, [
            { name: 'some-lib', oldVersion: '2.0.0', newVersion: '2.1.0' },
        ]);
    });

    // ── parseComposerLockDiff ─────────────────────────────────────────────────

    test('parseComposerLockDiff should return correct changes', () => {
        const diff = `
             "name": "vendor/package-name"
-            "version": "1.0.0"
+            "version": "1.1.0"
        `;
        const changes = myExtension.parseComposerLockDiff(diff);
        assert.deepStrictEqual(changes, [
            { name: 'vendor/package-name', oldVersion: '1.0.0', newVersion: '1.1.0' },
        ]);
    });

    test('parseComposerLockDiff should ignore "name": lines that are removed or added', () => {
        // Wholly-removed and wholly-added packages produce +/- "name": lines.
        // Only the context (space-prefixed) "name": line should set currentPackage.
        const diff = `
-            "name": "vendor/removed-package"
+            "name": "vendor/added-package"
             "name": "vendor/existing-package"
-            "version": "2.0.0"
+            "version": "2.1.0"
        `;
        const changes = myExtension.parseComposerLockDiff(diff);
        assert.deepStrictEqual(changes, [
            { name: 'vendor/existing-package', oldVersion: '2.0.0', newVersion: '2.1.0' },
        ]);
    });

    // ── parsePubspecYamlDiff ──────────────────────────────────────────────────

    test('parsePubspecYamlDiff should return correct changes', () => {
        const diff = `
-  http: ^0.13.0
+  http: ^1.2.0
        `;
        const changes = myExtension.parsePubspecYamlDiff(diff);
        assert.deepStrictEqual(changes, [
            { name: 'http', oldVersion: '^0.13.0', newVersion: '^1.2.0' },
        ]);
    });

    test('parsePubspecYamlDiff should handle multiple package changes', () => {
        const diff = `
-  http: ^0.13.0
+  http: ^1.2.0
-  provider: ^6.0.0
+  provider: ^6.1.0
        `;
        const changes = myExtension.parsePubspecYamlDiff(diff);
        assert.deepStrictEqual(changes, [
            { name: 'http', oldVersion: '^0.13.0', newVersion: '^1.2.0' },
            { name: 'provider', oldVersion: '^6.0.0', newVersion: '^6.1.0' },
        ]);
    });

    test('parsePubspecYamlDiff should skip section headers with no version digit', () => {
        const diff = `
-dependencies:
+dependencies:
-  http: ^0.13.0
+  http: ^1.2.0
        `;
        const changes = myExtension.parsePubspecYamlDiff(diff);
        assert.deepStrictEqual(changes, [
            { name: 'http', oldVersion: '^0.13.0', newVersion: '^1.2.0' },
        ]);
    });

    suiteTeardown(() => {
        vscode.window.showInformationMessage('All tests done!');
    });
});

// ── Webview content ───────────────────────────────────────────────────────────

suite('Webview Content Test Suite', () => {
    const sampleChanges = [
        { name: 'test-package', oldVersion: '1.0.0', newVersion: '1.1.0' },
    ];

    test('getWebviewContentNice should render a table with package info', () => {
        const html = myExtension.getWebviewContentNice(sampleChanges);
        assert.ok(html.includes('test-package'), 'Missing package name');
        assert.ok(html.includes('1.0.0'), 'Missing old version');
        assert.ok(html.includes('1.1.0'), 'Missing new version');
        assert.ok(html.includes('<table'), 'Missing table element');
    });

    test('getWebviewContentMinimal should render package info with arrow', () => {
        const html = myExtension.getWebviewContentMinimal(sampleChanges);
        assert.ok(html.includes('test-package'), 'Missing package name');
        assert.ok(html.includes('1.0.0'), 'Missing old version');
        assert.ok(html.includes('1.1.0'), 'Missing new version');
        assert.ok(html.includes('-&gt;'), 'Missing HTML-escaped arrow');
    });

    test('getWebviewContentNice should HTML-escape special characters', () => {
        const xssChanges = [
            { name: '<script>alert(1)</script>', oldVersion: '1.0.0', newVersion: '2.0.0' },
        ];
        const html = myExtension.getWebviewContentNice(xssChanges);
        assert.ok(!html.includes('<script>'), 'Raw script tag must not appear in output');
        assert.ok(html.includes('&lt;script&gt;'), 'Script tag should be HTML-escaped');
    });

    test('getWebviewContentMinimal should HTML-escape special characters', () => {
        const xssChanges = [
            { name: '<b>bold</b>', oldVersion: '1.0.0', newVersion: '2.0.0' },
        ];
        const html = myExtension.getWebviewContentMinimal(xssChanges);
        assert.ok(!html.includes('<b>bold</b>'), 'Raw HTML tag must not appear in output');
        assert.ok(html.includes('&lt;b&gt;'), 'Tag should be HTML-escaped');
    });
});
