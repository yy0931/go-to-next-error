# Go to Next Error

This extension adds the following commands to VSCode.

- `Go to Next Problem (Error)`
- `Go to Next Problem in Files (Error)`
- `Go to Next Problem (Error, Warning)`
- `Go to Next Problem in Files (Error, Warning)`

These commands are like the VSCode's built-in `Go to Next Problem (Error, Warning, Info)` and `Go to Next Problem in Files (Error, Warning, Info)`, but they select only markers of the specified severity.

---

To change the behavior of the F8 key from the default `Go to Next Problem in Files (Error, Warning, Info)` to `Go to Next Problem in Files (Error, Warning)`, add the following code to the `keybinding.json` (press `F1` or `Shift+Ctrl(Cmd)+P` then `Preferences: Open Keyboard Shortcuts (JSON)`).

```json
{
    "key": "f8",
    "command": "-editor.action.marker.nextInFiles",
    "when": "editorFocus"
},
{
    "key": "f8",
    "command": "go-to-next-error.nextInFiles.warning",
    "when": "editorFocus"
}
```

## Related GitHub Issue
https://github.com/microsoft/vscode/issues/105795.

## Known problems
- If there are multiple errors in the exact same location, only the first one will be displayed.
