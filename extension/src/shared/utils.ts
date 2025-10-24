import * as vscode from "vscode";
import { 
    Copy, 
    Create, 
    CreateDataSetTypeEnum, 
    Get, 
    ICopyDatasetOptions, 
    ICreateDataSetOptions, 
    IDataSet, 
    Upload 
} from "@zowe/zos-files-for-zowe-sdk";
import { GetJobs, IJob, SubmitJobs } from "@zowe/zos-jobs-for-zowe-sdk";
import { IIssueResponse, IssueTso } from "@zowe/zos-tso-for-zowe-sdk";
import { Gui, MessageSeverity } from "@zowe/zowe-explorer-api";

export function parseResponse(response: string): any {
    let lines = response.split('\n');
    const result: any = {};
    lines = lines.filter(line => line.trim() !== '');
    lines.forEach(line => {
        const [key, value] = line.split('=').map(item => item.trim());
        result[key.toLowerCase()] = value.trim();
    });
    return result;
}

function validateInputData(
    data: any, 
    emptyFields: string[], 
    pdsFields: string[]
): { valid: boolean, issues: { emptyFields: string[], invalidPDS: string[] } } {
    const issues = { emptyFields: [] as string[], invalidPDS: [] as string[] };

    for (const key in data) {
        // If field is empty but field name is not a field that is allowed to be empty, add to emptyFields
        if (data[key] === '' && !emptyFields.includes(key)) {
            issues.emptyFields.push(key);
        }
        
        // If field is in pdsFields and is not empty, check that the field is a valid PDS structure
        if (pdsFields.includes(key) && data[key] !== '') {
            const pdsValue = data[key];
            if (pdsValue.length > 44) {
                issues.invalidPDS.push(key);
            } else {
                const pdsRegex = (
                    /^[a-zA-Z#@$][a-zA-Z0-9#@$-]{1,7}(\.[a-zA-Z#@$][a-zA-Z0-9#@$-]{1,7}){1,4}(\([a-zA-Z#@$][a-zA-Z#@$]{1,7}\))?$/
                );
                if (!pdsRegex.test(pdsValue)) {
                    issues.invalidPDS.push(key);
                }
            }
        }
    }

    return { valid: issues.emptyFields.length === 0 && issues.invalidPDS.length === 0, issues };
}

export function isInputValid(message: any, emptyFields: string[], pdsFields: string[]): boolean {
    const validationResult = validateInputData(message, emptyFields, pdsFields);
    if (!validationResult.valid) {
        let errorMessage = '';
        if (validationResult.issues.emptyFields.length > 0) {
            errorMessage = `The following fields are empty and must be populated: ${validationResult.issues.emptyFields.join(', ')}\n`;
            Gui.showMessage(
                errorMessage.trim(),
                { severity: MessageSeverity.ERROR }
            );
        }
        if (validationResult.issues.invalidPDS.length > 0) {
            errorMessage = `The following fields are not valid PDS structures: ${validationResult.issues.invalidPDS.join(', ')}\n`;
            Gui.showMessage(
                errorMessage.trim(),
                { severity: MessageSeverity.ERROR }
            );
        }

        // Return false, as we don't want to dispose the panel to give the user another opportunity to fix the data
        return false;
    }
    return true;
}

export function cancel(token: vscode.CancellationToken, title: string): boolean {
    if (token.isCancellationRequested) {
        Gui.showMessage(
            `${title} cancelled`,
            { severity: MessageSeverity.INFO }
        );
        return true;
    }
    return false;
}

export async function openJobForEdit(jclDataset: string): Promise<void> {
    const pdsMemberMatch = jclDataset.match(/(.+)\((.+)\)/);
    let pdsMemberUri;
    if (pdsMemberMatch) {
        const pdsName = pdsMemberMatch[1];
        const memberName = pdsMemberMatch[2];
        pdsMemberUri = vscode.Uri.parse(`zowe-ds:/zosmf/${pdsName}/${memberName}?fetch=true`);
    } else {
        pdsMemberUri = vscode.Uri.parse(`zowe-ds:/zosmf/${jclDataset}?fetch=true`);
    }
    try {
        await vscode.workspace.fs.stat(pdsMemberUri);
        pdsMemberUri = pdsMemberUri.with({ query: "" });
        await vscode.commands.executeCommand("vscode.open", pdsMemberUri);
    } catch (err: any) {
        console.log(err);
        Gui.showMessage(
            `Failed to open the JCL dataset for editing: ${err.message}`,
            { severity: MessageSeverity.ERROR }
        );
        return;
    }
}

export async function submitJob(jclDataset: string, type: string, member: any, session: any, sessionName: any): Promise<boolean> {
    const jobResponse = await submitJcl(jclDataset, session);
    const setJobCmd = getJobUri(jobResponse.jobid, sessionName);
    Gui.showMessage(
        `[${member}] ${type} job completed [${jobResponse.jobid}](${setJobCmd})`,
    );

    if (jobResponse.retcode != "CC 0000" && jobResponse.retcode != "CC 0004") {
        Gui.showMessage(
            `[${member}] ${type} job failed with return code: ${jobResponse.retcode}`,
            { severity: MessageSeverity.ERROR }
        )
        return false;
    }
    return true;
}

export function getJobUri(jobId: string, sessionName: any): string {
    const args = [sessionName, jobId];
    return `command:zowe.jobs.setJobSpool?${encodeURIComponent(JSON.stringify(args))}`;
}

export function isJobSuccessful(job: IJob): boolean {
    if (job.retcode === "CC 0000" || job.retcode === "CC 0004") {
        return true;
    }
    return false;
}

export async function pdsExists(dsName: string, session: any, showErr: boolean = true): Promise<boolean> {
    await Get.dataSet(session, dsName).then((response) => {
        console.log('Dataset does exist', response);
        return true;
    }).catch((error: any) => {
        console.log('Dataset does not exist', error);
        if (showErr) {
            Gui.showMessage(
                `Failed to get dataset: ${error.message}`,
                { severity: MessageSeverity.ERROR }
            );
        }
        return false;
    });
    return false;
}

export async function getDataset(dsName: string, session: any): Promise<string> {
    await Get.dataSet(session, dsName).then((response) => {
        return response.toString();
    }).catch((error: any) => {
        console.error(error);
        throw error;
    });
    return '';
}

export async function copyDataset(source: string, target: string, session: any): Promise<boolean> {
    try {
        // If source or target includes a member name i.e. inside brackets, split the dataset name and member name
        const sourceMatch = source.match(/(.+)\((.+)\)/);
        const targetMatch = target.match(/(.+)\((.+)\)/);

        const fromDataset: IDataSet = {
            dsn: sourceMatch ? sourceMatch[1] : source,
            member: sourceMatch ? sourceMatch[2] : undefined,
        };
        const copyOptions: ICopyDatasetOptions = {
            "from-dataset": fromDataset,
            replace: true,
        };
        const toDataSet: IDataSet = {
            dsn: targetMatch ? targetMatch[1] : target,
            member: targetMatch ? targetMatch[2] : undefined,
        }

        const response = await Copy.dataSet(session, toDataSet, copyOptions);
        console.log(response);
    } catch (error: any) {
        console.error(error);
        Gui.showMessage(
            `Failed to copy dataset: ${error.message}`,
            { severity: MessageSeverity.ERROR }
        );
        return false;
    }
    Gui.showMessage(
        `Dataset saved successfully`,
        { severity: MessageSeverity.INFO }
    );
    return true;
}

export async function writeConfigFile(data: string, dataset: string, session: any): Promise<boolean> {
    const buffer = Buffer.from(data);
    try {
        const response = await Upload.bufferToDataSet(session, buffer, dataset);
        console.log(response);
    } catch (error: any) {
        console.error(error);
        Gui.showMessage(
            `Failed to write string to dataset: ${error.message}`,
            { severity: MessageSeverity.ERROR }
        );
        return false;
    }
    return true;
}

export async function createDataset(dataset: string, type: CreateDataSetTypeEnum, attributes: ICreateDataSetOptions, session: any): Promise<any> {
    try {
        const response = await Create.dataSet(session, type, dataset, attributes);
        console.log(response);
        return response;
    } catch (error: any) {
        console.error(error);
        Gui.showMessage(
            `Failed to create dataset: ${error.message}`,
            { severity: MessageSeverity.ERROR }
        );
        throw error;
    }
}

export async function submitJcl(dataset: string, session: any): Promise<IJob> {
    try {
        const jobResponse = await SubmitJobs.submitJobNotify(session, dataset);
        console.log(jobResponse);
        return jobResponse;
    } catch (error: any) {
        console.error(error);
        Gui.showMessage(
            `Failed to submit JCL: ${error.message}`,
            { severity: MessageSeverity.ERROR }
        );
        throw error;
    }
}

export async function getJobContent(job: IJob, stepid: number, session: any) : Promise<string> {
    try {
        const jobResponse = await GetJobs.getSpoolContentById(session, job.jobname, job.jobid, stepid);
        if (!jobResponse || jobResponse.length === 0) {
            
        }
        return jobResponse;
    } catch (error: any) {
        Gui.showMessage(
            `Failed to get job content: ${error.message}`,
            { severity: MessageSeverity.ERROR }
        );
        throw error;
    }
}

export async function issueTsoCmd(cmd: string, session: any): Promise<{response: IIssueResponse, success: boolean}> {
    try {
        const response = await IssueTso.issueTsoCmd(session, cmd);
        console.log(response);

        if (!response.commandResponse) {
            Gui.showMessage(
                `Unknown error: No response from TSO command: ${cmd}`,
                { severity: MessageSeverity.ERROR }
            );

            return { response, success: false };
        }

        if (!response.success) {
            Gui.showMessage(
                `Failed to issue TSO command: ${response.commandResponse}`,
                { severity: MessageSeverity.ERROR }
            );

            return { response, success: false };
        }

        // Scan the whole commandResponse for any error codes or RC(-3)
        const errorPattern = /I[A-Z0-9]{7}.*|RC\(-3\)|^\s*\d+\s*\*-\*.*$/gm;
        if (errorPattern.test(response.commandResponse)) {
            Gui.showMessage(
                `Errors found in TSO command response:\n${response.commandResponse}`,
                { severity: MessageSeverity.ERROR }
            );

            return { response, success: false };
        }

        return { response, success: true };
    } catch (error: any) {
        console.error(error);
        Gui.showMessage(
            `Failed to issue TSO command: ${error.message}`,
            { severity: MessageSeverity.ERROR }
        );
        throw error;
    }
}

export async function checkRexxOutput(dataset: string, session: any): Promise<boolean> {
    /**
     *  The REXX program outputs messages in the following format:
     *  ERROR: <message>
     *  WARNING: <message>
     *  SUCCESS
     *  success has no message, it just means the job was successful
     */
    const response = await getDataset(dataset, session).catch((error: any) => {
        console.error(error);
        Gui.showMessage(
            `Failed to get dataset: ${error.message}`,
            { severity: MessageSeverity.ERROR }
        );
        throw error;
    });

    const lines = response.split('\n');
    let success = false;
    let error = false;

    for (const line of lines) {
        if (line.includes('SUCCESS')) {
            success = true;
        } else if (line.includes('ERROR')) {
            error = true;
        }
    }

    if (error) {
        Gui.showMessage(
            `Errors found in REXX output:\n${response}`,
            { severity: MessageSeverity.ERROR }
        );
    }

    return success;
}