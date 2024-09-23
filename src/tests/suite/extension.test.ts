import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon'; 
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
    });

    test('parsePackageLockDiff should return correct changes', () => {
        const diff = `
         "package-name":
-            "version": "1.0.0"
+            "version": "1.1.0"
        `;
        const changes = myExtension.parsePackageLockDiff(diff);
        assert.deepStrictEqual(changes, [
            { name: "package-name", oldVersion: "1.0.0", newVersion: "1.1.0" }
        ]);
    });

    test('parseComposerLockDiff should return correct changes', () => {
        const diff = `
             "name": "vendor/package-name"
-            "version": "1.0.0"
+            "version": "1.1.0"
        `;
        const changes = myExtension.parseComposerLockDiff(diff);
        assert.deepStrictEqual(changes, [
            { name: "vendor/package-name", oldVersion: "1.0.0", newVersion: "1.1.0" }
        ]);
    });

    suiteTeardown(() => {
        vscode.window.showInformationMessage('All tests done!');
    });
});

suite('Webview Panel Creation Test Suite', () => {
    
    let createWebviewPanelStub: sinon.SinonStub;
    
    setup(async () => {
        // Mock vscode.window.createWebviewPanel to verify webview panel creation
        createWebviewPanelStub = sinon.stub(vscode.window, 'createWebviewPanel'); 
    });
    
    teardown(() => {
        sinon.restore();  
    });

    test('Should create a webview panel with the correct content', async () => {
       
        await vscode.commands.executeCommand('update-packages-summary.diffPackageLock');

        assert.ok(createWebviewPanelStub.calledOnce, 'createWebviewPanel was not called');

        const panelArgs = createWebviewPanelStub.args[0];
        assert.strictEqual(panelArgs[1], 'Package-lock.json Changes', 'Webview title is incorrect');
        
     
        const panel = panelArgs[0];  // This is the stubbed panel object
        const htmlContent = panelArgs[3].webview.html;
        assert.ok(htmlContent.includes('test-package'), 'Webview does not contain package name');
        assert.ok(htmlContent.includes('1.0.0'), 'Webview does not contain old version');
        assert.ok(htmlContent.includes('1.1.0'), 'Webview does not contain new version');
    });

    test('Should handle different display modes (minimal vs nice)', async () => {
     
        await vscode.commands.executeCommand('update-packages-summary.diffPackageLock');

        const minimalArgs = createWebviewPanelStub.args[0];
        const minimalHtmlContent = minimalArgs[0].webview.html;
        assert.ok(minimalHtmlContent.includes('test-package'), 'Minimal view missing package name');
        assert.ok(minimalHtmlContent.includes('1.0.0 -> 1.1.0'), 'Minimal view missing version transition');

        await vscode.commands.executeCommand('update-packages-summary.diffPackageLock');

        const niceArgs = createWebviewPanelStub.args[1];
        const niceHtmlContent = niceArgs[0].webview.html;
        assert.ok(niceHtmlContent.includes('<table'), 'Nice view should have a table format');
    });

});