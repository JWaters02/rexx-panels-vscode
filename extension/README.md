# Zowe Developer Tools 4 Org

VS Code extension extending Zowe Explorer that adds frontend panels for REXX developer tools on the mainframe.

## Build

To compile code changes, run `npm run compile`

To package into `.vsix` file, run `npm run package` (this will also compile).

To bump the extension version, change the version number in the version field in the `package.json`. 

When the package command runs, it will automatically make and move the `.vsix` file into `vsix/` with the extension name + the version number.