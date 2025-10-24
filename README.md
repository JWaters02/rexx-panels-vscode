# REXX Panels for VS Code

The solution supports both existing ISPF panels and new VS Code panels at once and keeps all core REXX logic in the mainframe in one place, allowing for maintanence to be made once on the mainframe and does not require updates to the VS Code extension for developer tool logic.

The solution currently only supports REXX programs that populate skeleton JCL members for submitting or editing but obviously this can be changed in the extension to support any kind of REXX panels.

## Demonstration

To demonstrate the solution, an example panel has been created (REXX probably doesn't work but I haven't tested it, it's just for reference).

This is how it works from the ISPF perspective (user running REXX program `EXPLREXX`):
1. `EXPLREXX` reads defaults dataset `EXPLDFLT`.
2. `EXPLREXX` displays `EXPLISPF` panel using default values as input.
3. `EXPLREXX` then writes user submitted values to config dataset with their userid as member name (`CONFIGS(IBMUSER)`).
4. `EXPLREXX` calls other REXX program (`EXPLREXJ`) using the userid's config dataset as the sysin.
5. `EXPLREXJ` builds out the skeleton JCL (`EXPLSJCL`) and then saves it to the JCL location with userid as member name (`JCL(IBMUSER)`).
6. Depending on if `editjcl` = `Y`/`N`, the REXX program `EXPLREXJ` either submits the created JCL directly or displays it to the user.

This is how it works from the VS Code perspective:
1. VS Code picks up defaults from dataset (`EXPLDFLT`).
2. VS Code shows user web view (`ExamplePanel.ts`) using default values as input.
3. VS Code writes user submitted values to a config dataset with their userid as member name (`CONFIGS(IBMUSER)`).
4. VS Code submits a job that runs the REXX program (`EXPLREXJ`), using the userid's config dataset as the sysin.
5. REXX program builds out the skeleton JCL (`EXPLSJCL`) and then saves it to the JCL location with userid as member name (`JCL(IBMUSER)`).
6. Depending on if `editjcl` = `Y`/`N`, VS Code either submits the created JCL directly or opens it in the editor.

## How to add new panels

I have designed the extension to add new panels as easily as possible. Each new panel will require two parts:
1. Server/Mainframe side - this being the defaults, config files, REXX and jcl jobs.
2. Client/VS Code side - this being the panel's HTML, details and registering the command.

### Mainframe side

1. Create a DEFAULTS file that contains the variable names and their default values for the REXX/VS Code panels. The path must be `path = VSC` (this is hardcoded in the extension for simplicity).
2. Create a PDS for holding config files that will contain the variables with their values populated by REXX/VS Code panels. 
3. Edit the existing REXX program that handles the screen by splitting it into two:
   1. The first program should read the DEFAULTS file, populate the screen; then when the screen is submitted, populate the config file and then call the second REXX program.
   2. The second REXX program reads the variables from the config file, then does all the logic on those variables and populates the skeleton JCL or whatever else it does.

### VS Code side

1. Add the command ID to `package.json` under the "contributes" sections. This command ID will be used when registering the command. Reference vs code docs for when clause and group clause information - this tells VS Code when and where the command is triggered from. The best way I use to see examples of when clauses is to look at `package.json` on the Zowe Explorer package and search for menu items I know only appear on certain nodes (you can test this out yourself).
2. Register your command ID in the activate function in extension.ts. Pick the type of panel you want to register:
   1. Limited panel for a panel that may only be opened once per file.
   2. Unlimited panel for a panel that may be opened any number of times per file.
3. Make a new file in `src/panels/` called `<panel name>Panel.ts` which implements the `BasePanel.ts` abstract class.
4. Implement the constructor by defining your panel configurations. 
5. Implement `_generateDefaultValues`. `parsedResponse` is the `key: value` pair for each variable in the DEFAULTS file.
6. Create your HTML/CSS/JS in `src/webviews`. Note that the id of each HTML form element must be the same as the key names you set in your `_generateDefaultValues`. These key names will also be stored in the config file.
7. Implement the `_modifyHTMLOnWebview` function. If you are doing something special in the HTML file of a panel, implement the code in there. Otherwise, just return `HTMLContent` immediately.
8. Populate the allowed empty fields and pds fields ids from the HTML in the `PanelConfig` you setup in the constructor.

## Other surrounding systems

### Inject HTML at runtime

This means that instead of specifying HTML code inside the Panel's `_getHTMLForWebview` function, you can put your HTML/CSS/JS into a separate file in the project, then in the panel's config specify the name of that file and it will load that HTML into the panel, inject the default values into it and display the panel. This makes editing the frontend much easier.

### Persist panel state in a session

When the user opens a panel, makes some changes and closes the panel (either by finishing a job or by closing it themselves/VS Code), the panel's state is saved for that member, in that VS Code session. This means that when working on a project and the user needs to change the defaults a lot, their values are saved for when they next open their panel. 

However, they lose their saved state when the extension updates. This is done on purpose as if the defaults values on the mainframe changes, the saved state would still override the new defaults, which may cause something to break.

### Possible future problems to consider

If the structure of a DEFAULTS file for a panel changes, for example a property name changes, the extension will break. This is because it will try to access a property that no longer exists. But simply changing a value will be fine. 

Therefore, when changing the structure of a DEFAULTS file, consider making a copy of the file with the new changes and in the bumped major version of the extension, point towards that new location. This way the old version of the extension still works.

The same as above goes for changing the locations of JCL jobs or other critical files on the mainframe.

Note that if you add new properties to a DEFAULTS file or change the values of existing ones, the extension will not break. The extension will pick up the changed values, but would need to be updated to pick up the new properties and do something with them (e.g. a new field on the panel).
