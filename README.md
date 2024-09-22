# update-packages-summary README

Made this because tracking which version of a package upgraded is humanely difficult to do.
Helps developers to keep track of updated packages via git in a simplified and beautiful manner.

## Features

To use

- Make sure the lock file is open in the editor, is the active tab and has already being committed.
- Open the command pallette (Mac `Cmd+Shift+P` or Windows `Shift+Ctrl+P`)
- Type in `Update Packages Summary` and select the type of lock file you want to summarize
- Enter the previous commit's has and the current commit's (that has your lock file changes) hash.
- Follow rest of the prompts and it will generate summary for you

## Requirements

- Git
- The lock file must be in a git repository

## Release Notes

### 1.0.0

Initial release of update-packages-summary. Supports package-lock.json and composer.lock for now.

---

## Running the Sample

- Run `npm install` in terminal to install dependencies
- Run the `Run Extension` target in the Debug View. This will:
  - Start a task `npm: watch` to compile the code
  - Run the extension in a new VS Code window

## Contributing

Contributions are highly welcome. Help me make this package meaningful to others.

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

- [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)
