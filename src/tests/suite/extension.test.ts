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
        assert.ok(commands.includes('update-packages-summary.diffPubspecLock'));
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

    // ── parsePubspecLockDiff ──────────────────────────────────────────────────

    test('parsePubspecLockDiff should return correct changes', () => {
        // Raw git diff lines: context lines start with ' ', removed with '-', added with '+'
        // Package name is at 2-space indent (3 chars including the diff space marker).
        // Version is at 4-space indent (5 chars including the diff marker).
        const diff = [
            '   archive:',
            '     dependency: transitive',
            '     source: hosted',
            '-    version: "4.0.7"',
            '+    version: "4.0.9"',
        ].join('\n');
        const changes = myExtension.parsePubspecLockDiff(diff);
        assert.deepStrictEqual(changes, [
            { name: 'archive', oldVersion: '4.0.7', newVersion: '4.0.9' },
        ]);
    });

    test('parsePubspecLockDiff should handle multiple package changes', () => {
        const diff = [
            '   archive:',
            '     dependency: transitive',
            '-    version: "4.0.7"',
            '+    version: "4.0.9"',
            '   async:',
            '     dependency: transitive',
            '-    version: "2.13.0"',
            '+    version: "2.13.1"',
        ].join('\n');
        const changes = myExtension.parsePubspecLockDiff(diff);
        assert.deepStrictEqual(changes, [
            { name: 'archive', oldVersion: '4.0.7', newVersion: '4.0.9' },
            { name: 'async', oldVersion: '2.13.0', newVersion: '2.13.1' },
        ]);
    });

    test('parsePubspecLockDiff should ignore sha256 lines and only capture version', () => {
        const diff = [
            '   dbus:',
            '     dependency: transitive',
            '     description:',
            '       name: dbus',
            '-      sha256: "79e0c234..."',
            '+      sha256: d0c98dcd...',
            '       url: "https://pub.dev"',
            '     source: hosted',
            '-    version: "0.7.11"',
            '+    version: "0.7.12"',
        ].join('\n');
        const changes = myExtension.parsePubspecLockDiff(diff);
        assert.deepStrictEqual(changes, [
            { name: 'dbus', oldVersion: '0.7.11', newVersion: '0.7.12' },
        ]);
    });

    test('parsePubspecLockDiff should not use +/- name lines as currentPackage', () => {
        // A wholly-removed then wholly-added package produces +/- at the name level.
        // These must not corrupt the tracker; only context (space-prefixed) name lines count.
        const diff = [
            '-  removed_pkg:',
            '-    version: "1.0.0"',
            '+  added_pkg:',
            '+    version: "1.0.0"',
            '   real_pkg:',
            '-    version: "2.0.0"',
            '+    version: "2.1.0"',
        ].join('\n');
        const changes = myExtension.parsePubspecLockDiff(diff);
        assert.deepStrictEqual(changes, [
            { name: 'real_pkg', oldVersion: '2.0.0', newVersion: '2.1.0' },
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
