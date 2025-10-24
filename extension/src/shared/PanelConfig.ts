export interface PanelConfig {
    /**
     * @readonly
     * @description Name of the panel's HTML file
     * This file is injected into the panel during extension compile/package
     */
    HTML_FILE: string;

    /**
     * @readonly
     * @description Location of the defaults file for the panel on the mainframe
     */
    DEFAULT_VALUES: string;

    /**
     * @readonly
     * @description Location of where the data inputted from the frontend is stored on the mainframe
     * The values in this file are picked up in the REXX program that populates the skeleton JCL
     */
    CONFIGS: string;

    /**
     * @readonly
     * @description Location of the JCL job that runs the REXX program that populates the skeleton JCL
     */
    REXX_JOB: string;

    /**
     * @readonly
     * @description Location of the JCL that is populated by the REXX program
     * This is the JCL that is submitted as a job or opened for editing
     */
    JCL: string;

    /**
     * @readonly
     * @description The type of panel by name
     */
    TYPE: string;

    /**
     * @readonly
     * @description IDs of the HTML fields that are allowed to be empty when submitting the form
     * Other fields are required to have a value
     */
    ALLOWED_EMPTY_FIELDS: string[];

    /**
     * @readonly
     * @description IDs of the HTML fields that are PDS fields
     * PDS fields are validated with regex to ensure they are valid PDS formats
     */
    PDS_FIELDS: string[];
}