import * as vscode from "vscode";
import type { IZoweDatasetTreeNode } from "@zowe/zowe-explorer-api";
import { ExamplePanel } from "./panels/ExamplePanel";

const openPanels: Map<string, Map<string, any>> = new Map();

/**
 * @description Generates a unique key for a given node based on the user session and node label
 * @param node The node for which to generate the key
 * @returns A unique key string
 */
const getNodeKey = (node: IZoweDatasetTreeNode): string => {
    return `${node.getSession().ISession.user?.toUpperCase()}-${node.resourceUri?.toString().toUpperCase()}`;
};

/**
 * @description Registers a command that opens a panel that may only be opened once per node
 * @param context The extension context
 * @param title The title of the panel
 * @param command The command to register
 * @param PanelClass The class of the panel to open
 */
const registerLimitedPanel = (
    context: vscode.ExtensionContext,
    title: string,
    command: string,
    PanelClass: any
) => {
    const disposable = vscode.commands.registerCommand(command, (node: IZoweDatasetTreeNode) => {
        const nodeKey = getNodeKey(node);
        if (!openPanels.has(nodeKey)) {
            openPanels.set(nodeKey, new Map());
        }
        const panels = openPanels.get(nodeKey);
        const panelType = PanelClass.name.toLowerCase();

        // If the panel is already open
        if (panels?.has(panelType)) {
            // Reveal the existing panel
            panels.get(panelType)._panel.reveal(vscode.ViewColumn.One);
        } else {
            // Create a new panel
            const member = node.getLabel().toString().toUpperCase();
            const panel = vscode.window.createWebviewPanel(
                panelType,
                `${title} (${member})`,
                vscode.ViewColumn.One,
                { enableScripts: true }
            );
            const panelInstance = new PanelClass(context, panel, node, () => {
                // When the panel is disposed, remove it from the map
                panels?.delete(panelType);
                if (panels?.size === 0) {
                    openPanels.delete(nodeKey);
                }
            });

            // Save the panel instance to the map
            panels?.set(panelType, panelInstance);
        }
    });
    context.subscriptions.push(disposable);
};

/**
 * @description Registers a command that opens a panel that may be opened multiple times per node
 * @param context The extension context
 * @param title The title of the panel
 * @param command The command to register
 * @param PanelClass The class of the panel to open
 */
const registerUnlimitedPanel = (
    context: vscode.ExtensionContext,
    title: string,
    command: string,
    PanelClass: any
) => {
    const disposable = vscode.commands.registerCommand(command, (node: IZoweDatasetTreeNode) => {    
        const member = node.getLabel().toString().toUpperCase();
        const panel = vscode.window.createWebviewPanel(
            PanelClass.name.toLowerCase(),
            `${title} (${member})`,
            vscode.ViewColumn.One,
            { enableScripts: true }
        );

        // Create a new instance of the panel
        // The dispose callback is a no-op for unlimited panels
        new PanelClass(context, panel, node, () => {});
    });
    context.subscriptions.push(disposable);
};

/**
 * @description Activates the extension and registers the commands
 * @param context The extension context
 */
export function activate(context: vscode.ExtensionContext): void {
    registerLimitedPanel(context, "Example", "org-zowe-developer-tools.showExampleMenu", ExamplePanel);

    // Clear the workspace state which is called from the command palette
    // This command may be used to clear the saved panel values if something is not working correctly
    context.subscriptions.push(
        vscode.commands.registerCommand("org-zowe-developer-tools.clearWorkspaceState", () => {
            context.workspaceState.keys().forEach(key => {
                if (key.startsWith('org-zowe-developer-tools')) {
                    { context.workspaceState.update(key, undefined)}
                }
            });
            vscode.window.showInformationMessage('Workspace state cleared');
        })
    );
}

/**
 * @description Deactivates the extension
 * @param _context The extension context
 */
export function deactivate(_context: vscode.ExtensionContext): void {}

module.exports = {
    activate,
    deactivate
};