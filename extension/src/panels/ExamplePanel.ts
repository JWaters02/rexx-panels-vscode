import * as vscode from "vscode";
import { IZoweDatasetTreeNode } from "@zowe/zowe-explorer-api";
import { BasePanel } from "./BasePanel";
import { PanelConfig } from "../shared/PanelConfig";

export class ExamplePanel extends BasePanel<ExamplePanel> {
    private constructor(
        context: vscode.ExtensionContext, 
        panel: vscode.WebviewPanel, 
        node: IZoweDatasetTreeNode, 
        disposeCallback: () => void
    ) {
        const username = node.getSession().ISession.user?.toUpperCase();
        const examplePanelConfig: PanelConfig = {
            HTML_FILE: 'example.html',
            DEFAULT_VALUES: `SOME.HLQ.EXAMPLE(EXPLDFLT)`,
            CONFIGS: `SOME.HLQ.EXAMPLE.CONFIGS(${username})`,
            REXX_JOB: "SOME.HLQ.EXAMPLE(EXPLREXJ)",
            JCL: `SOME.HLQ.EXAMPLE.JCL(${username})`,
            TYPE: "Example",
            ALLOWED_EMPTY_FIELDS: [],
            PDS_FIELDS: ['pdsname']
        };

        super(context, panel, node, examplePanelConfig, disposeCallback);
    }

    protected _generateDefaultValues(parsedResponse: any): any {
        return {
            jobname: `${this._username}$`,
            jobclass: parsedResponse.jobclass,
            editjcl: parsedResponse.editjcl,
            pdsname: `${this._pdsName}` // Use the selected node's PDS name as default
        };
    }

    protected _modifyHtmlOnWebview(htmlContent: string): string {
        return htmlContent;
    }

    protected _modifyConfigData(data: any): string {
        return data;
    }
}