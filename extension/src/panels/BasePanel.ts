import * as fs from 'fs';
import * as path from 'path';
import * as vscode from "vscode";
import { Gui, imperative, IZoweDatasetTreeNode, MessageSeverity } from "@zowe/zowe-explorer-api";
import { Get } from "@zowe/zos-files-for-zowe-sdk";
import { IJob } from "@zowe/zos-jobs-for-zowe-sdk";
import {  
    writeConfigFile,
    openJobForEdit,
    submitJob,
    cancel,
    parseResponse,
    submitJcl,
    getJobContent,
    isInputValid,
    getJobUri
} from "../shared/utils";
import { PanelConfig } from "../shared/PanelConfig";

/**
 * @description Base class for all panels
 */
export abstract class BasePanel<T> {
    public static currentPanel: BasePanel<any> | undefined;
    public readonly _panel: vscode.WebviewPanel;
    protected readonly _context: vscode.ExtensionContext;
    protected readonly _config: PanelConfig;
    protected _session: imperative.Session;
    protected _sessionName: string | vscode.TreeItemLabel;
    protected _username: string | undefined;
    protected _pdsName: string | vscode.TreeItemLabel;
    protected _memberName: string | vscode.TreeItemLabel;
    protected _panelId: string;
    protected _inputValues: any;
    protected _fatal: boolean;

    protected readonly _disposeCallback: () => void;
    protected abstract _generateDefaultValues(defaultValueDataset: string): any;
    protected abstract _modifyHtmlOnWebview(htmlContent: string): string;
    protected abstract _modifyConfigData(data: any): string;

    /**
     * @description Base class for all panels
     * @param context Extension context 
     * @param panel Webview panel
     * @param node Zowe dataset tree node that the command is ran on
     * @param config The panel config settings for the child panel
     * @param disposeCallback Callback function to dispose of the panel
     */
    constructor(
        context: vscode.ExtensionContext,
        panel: vscode.WebviewPanel,
        node: IZoweDatasetTreeNode,
        config: PanelConfig,
        disposeCallback: () => void
    ) {
        this._panel = panel;
        this._context = context;
        this._config = config;
        this._disposeCallback = disposeCallback;
        
        this._session = node.getSession();
        this._username = this._session.ISession.user?.toUpperCase();
        this._memberName = node.getLabel().toString().toUpperCase();
        this._sessionName = '';
        this._pdsName = '';
        this._panelId = '';
        this._fatal = false;
    
        this._initialize(context, node);
    }

    private async _initialize(
        context: vscode.ExtensionContext,
        node: IZoweDatasetTreeNode
    ): Promise<void> {
        // Support for sequential data sets
        let isSpds = false;
    
        try {
            const children = await node.getChildren();
            isSpds = children.length !== 0;
    
            if (isSpds) {
                this._sessionName = node.getParent()?.getLabel() as string;
                this._pdsName = node.getLabel().toString().toUpperCase();
            } else {
                this._sessionName = node.getParent()?.getParent().getLabel() as string;
                this._pdsName = node.getParent()?.getLabel().toString().toUpperCase();
            }
        } catch (error) {
            Gui.showMessage(
                `[${this._memberName}] Error fetching children: ${error}`,
                { severity: MessageSeverity.ERROR }
            );
            this._fatal = true;
            return;
        }
    
        // Unique ID for storing the panel's state for each node
        this._panelId = `org-zowe-developer-tools-
                         ${context.extension.packageJSON.version}-
                         ${this._panel.title}-
                         ${this._username}-
                         ${this._pdsName}-
                         ${this._memberName}`;
    
        // Fetch the default values from the defaults file
        this._fetchDefaults();
    
        // Restore state for this specific node's panel, only for this session
        this._restoreState();
    
        // Listen for messages from the webview
        this._panel.webview.onDidReceiveMessage((message) => {
            if (message.command === 'submit') {
                // First we need to set all the fields in this._config.DEFAULT_VALUES that are present in message
                for (const key in message.state) {
                    this._inputValues[key] = message.state[key].toUpperCase();
                }
    
                // Validation
                if (!isInputValid(message.state, this._config.ALLOWED_EMPTY_FIELDS, this._config.PDS_FIELDS)) { return; }
    
                // Run the rest of the process
                (async () => {
                    const closePanel = await this._run();
    
                    // Now close the panel
                    if (closePanel) { this.disposePanel(); }
                })();
            }
            if (message.command === 'updateState') {
                this._context.workspaceState.update(this._panelId, message.state);
            }
        }, null, []);
    
        if (this._fatal) {
            this.disposePanel();
        }
    
        this._panel.onDidDispose(() => {
            this._disposeCallback();
        });
    
        this._panel.onDidChangeViewState(() => {
            if (!this._panel.active) {
                // Hacky fix to make sure the state is saved
                setTimeout(() => this._saveState(), 100);
            } else {
                // Debugging option: increase timer to check state pre-population
                setTimeout(() => this._restoreState(), 0);
            }
        });
    }

    /**
     * @description Saves the state of the panel then disposes it
     */
    public disposePanel(): void {
        this._saveState();
        BasePanel.currentPanel = undefined;
        this._panel.dispose();
    }

    private async _fetchDefaults(): Promise<void> {
         try {
            const response = await Get.dataSet(this._session, this._config.DEFAULT_VALUES);
            if (response.toString() === '') {
                Gui.showMessage(
                    `[${this._memberName}] Fatal error: Failed to get default values for the ${this._config.TYPE} panel`,
                    { severity: MessageSeverity.ERROR }
                );
                this._fatal = true;
                return;
            }
            this._inputValues = this._generateDefaultValues(parseResponse(response.toString()));
            this._panel.webview.html = this._getHtmlForWebview(this._inputValues);
        } catch (error) {
            Gui.showMessage(
                `[${this._memberName}] Error getting default values: ${error}`,
                { severity: MessageSeverity.ERROR }
            );
            this._fatal = true;
            return;
        }
    }

    /**
     * @description Saves the state of the panel to the workspace
     */
    private _saveState(): void {
        const state = this._context.workspaceState.get(this._panelId);
        if (state) {
            this._context.workspaceState.update(this._panelId, state);
        }
    }

    /**
     * @description Restores the state of the panel from the workspace
     */
    private _restoreState(): void {
        const state = this._context.workspaceState.get(this._panelId);
        if (state) {
            this._panel.webview.postMessage({ command: 'restoreState', state });
        }
    }

    /**
     * @description Get the HTML content from the .html file into the Panel webview
     * While injecting, it also injects the default values into the HTML content
     * @param defaultValues Default values for the panel 
     * @returns HTML content for the webview
     */
    private _getHtmlForWebview(defaultValues: any): string {
        const htmlFilePath = path.resolve(__dirname, `../webviews/${this._config.HTML_FILE}`);
        let htmlContent = fs.readFileSync(htmlFilePath, 'utf8');

        // Inject defaultValues into the HTML content
        for (const [key, value] of Object.entries(defaultValues)) {
            const placeholder = new RegExp(`\\$\\{defaultValues\\.${key}\\}`, 'g');
            htmlContent = htmlContent.replace(placeholder, String(value));
        }

        // Any panel can modify extra optional HTML content
        htmlContent = this._modifyHtmlOnWebview(htmlContent);

        return htmlContent;
    }

    /**
     * @description Formats the data from the webview into a string suitable for the config file
     * That is pushed to the mainframe for the REXX program to pick up
     * @param data The data to be formatted
     * @returns Formatted string
     */
    private _formatConfigData(data: any): string {
        let formattedData = '';
        for (const key in data) {
            formattedData += `${key} = ${data[key].toUpperCase()}\n`;
        }

        // Hardcode VSC as path in config file
        formattedData += `path = VSC\n`;

        // Any panel can modify extra optional config data
        formattedData = this._modifyConfigData(formattedData);

        return formattedData;
    }

    /**
     * @description After the user has submitted the form, this function runs through the steps to generate the JCL
     * @returns True if the panel should be closed, false if it should remain open (i.e. if error has occured)
     */
    private async _run(): Promise<boolean> {
        let closePanel = true;
        let title = `[${this._memberName}] ${this._config.TYPE}`;

        // Show the Gui progress bar for each of the following steps
        await Gui.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: title,
            cancellable: true
        },
        async (progress, token) => {
            let totalSteps = 4;
            let step = 0;

            // Submit the submitted frontend data to the PDS that the REXX program picks up
            Gui.reportProgress(progress, totalSteps, step++, `Submitting data to config file, `);
            const data = this._formatConfigData(this._inputValues);
            if (!await writeConfigFile(data, this._config.CONFIGS, this._session)) { closePanel = false; return; }

            if (cancel(token, title)) { closePanel = false; return; }

            // Submit job to run the REXX program that generates the skeleton JCL
            Gui.reportProgress(progress, totalSteps, step++, `Generating ${this._config.TYPE} JCL, `);
            const jobResponse: IJob = await submitJcl(this._config.REXX_JOB, this._session);
            const setJobCmd = getJobUri(jobResponse.jobid, this._sessionName);
            if (jobResponse.retcode != "CC 0000" && jobResponse.retcode != "CC 0004") {
                // This means the job hard failed, fatal error
                Gui.showMessage(
                    `[${this._memberName}] Error generating ${this._config.TYPE} JCL: 
                    ${jobResponse.retcode}, [${jobResponse.jobid}](${setJobCmd})`,
                    { severity: MessageSeverity.ERROR }
                );
                closePanel = false;
                return;
            }

            if (cancel(token, title)) { closePanel = false; return; }

            // Check if an error returned from the REXX program by reading SYSTPRNT DD
            Gui.reportProgress(progress, totalSteps, step++, `Checking ${this._config.TYPE} JCL OK, `);
            const content: string = await getJobContent(jobResponse, 104, this._session);
            if (!content.search("Success")) {
                Gui.showMessage(
                    `[${this._memberName}] Error generating ${this._config.TYPE} JCL: 
                    ${content}, [${jobResponse.jobid}](${setJobCmd})`,
                    { severity: MessageSeverity.ERROR }
                );
                closePanel = false;
                return;
            }

            if (cancel(token, title)) { closePanel = false; return; }
            
            // Once the REXX program is finished, it will write JCL to this._config.JCL
            // Now submit the JCL or open it for editing if the user wants to
            if (this._inputValues.editjcl === 'Y') {
                Gui.reportProgress(progress, totalSteps, step++, `Opening ${this._config.JCL} for editing, `);
                await openJobForEdit(this._config.JCL);
            } else {
                Gui.reportProgress(progress, totalSteps, step++, `Submitting ${this._config.TYPE} job, `);
                if (!await submitJob(this._config.JCL, this._config.TYPE, this._memberName, this._session, this._sessionName)) { closePanel = false; return; };
            }
        });

        return closePanel;
    }
}