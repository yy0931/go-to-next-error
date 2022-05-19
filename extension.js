const vscode = require("vscode")

exports.activate = (/** @type {vscode.ExtensionContext} */context) => {
    /** @type {{ uri: vscode.Uri, position:vscode.Position }| null} */
    let lastPosition = null

    const getFirstMarker = (/** @type {vscode.Diagnostic[]} */diagnostics) =>
        diagnostics.sort((a, b) => a.range.start.isBefore(b.range.start) ? -1 : (a.range.start.isEqual(b.range.start) ? 0 : 1))[0]

    /**
     * Selects the next error in the active file.
     * Returns false if loop = false and there are no errors after the cursor.
     */
    const gotoNextMarkerInFile = async (/** @type {vscode.DiagnosticSeverity[]} */filter, /** @type {boolean} */loop = true) => {
        const editor = vscode.window.activeTextEditor
        if (editor === undefined) { return false }
        const diagnostics = vscode.languages.getDiagnostics(editor.document.uri)
            .filter((d) => filter.includes(d.severity))

        if (lastPosition?.uri.toString() !== editor.document.uri.toString()) {
            lastPosition = null
        }
        /** @type {vscode.Diagnostic | null} */
        let next = null
        if (diagnostics.length === 0) { return false }

        for (const d of diagnostics) {
            if (editor.selection.start.isBeforeOrEqual(d.range.start) &&  // Select only errors after the cursor.
                (lastPosition === null || !d.range.start.isEqual(lastPosition.position)) && // Don't select the same error consecutively.
                (next === null || d.range.start.isBefore(next.range.start))  // Select the error closest to the cursor.
            ) {
                next = d
            }
        }

        if (next === null && loop) {
            next = getFirstMarker(diagnostics)

            // Fix: When there is only one error location in the file, multiple command calls will select a non-error marker.
            if (lastPosition !== null &&
                lastPosition.position.isEqual(next.range.start) &&
                lastPosition.uri.toString() === editor.document.uri.toString() &&
                editor.selection.start.isEqual(next.range.start)
            ) {
                return true
            }
        }

        if (next === null) { return false }

        lastPosition = { position: next.range.start, uri: editor.document.uri }
        editor.selection = new vscode.Selection(next.range.start, next.range.start)
        await vscode.commands.executeCommand("editor.action.marker.next")
        return true
    }

    const gotoNextMarkerInFiles = async (/** @type {vscode.DiagnosticSeverity[]} */filter) => {
        // If there is an error after the cursor in the file, select it.
        if (await gotoNextMarkerInFile(filter, false)) { return }

        // Get the first error in the next document.
        const filesSorted = vscode.languages.getDiagnostics()
            .filter((file) => {
                file[1] = file[1].filter((d) => filter.includes(d.severity))
                return file[1].length > 0
            })
            .sort(([uri1], [uri2]) => uri1.toString() < uri2.toString() ? -1 : (uri1.toString() === uri2.toString() ? 0 : 1))
        if (filesSorted.length === 0) { return }
        if (filesSorted.length === 1 && filesSorted[0][0].toString() === vscode.window.activeTextEditor?.document.uri.toString()) {
            // Fix: When there is only one error location in all files, multiple command calls will select a non-error marker.
            await gotoNextMarkerInFile(filter, true)
            return
        }

        const currentDocumentUri = vscode.window.activeTextEditor?.document.uri.toString()
        const activeFileIndex = filesSorted.findIndex(([uri]) => uri.toString() === currentDocumentUri)
        const [uri, diagnostics] = filesSorted[activeFileIndex === -1 ? 0 : ((activeFileIndex + 1) % filesSorted.length)]
        const next = getFirstMarker(diagnostics)

        // Open the document and select the error.
        lastPosition = { position: next.range.start, uri }
        const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri))
        editor.selection = new vscode.Selection(next.range.start, next.range.start)
        await vscode.commands.executeCommand("editor.action.marker.nextInFiles")
    }

    context.subscriptions.push(
        vscode.commands.registerCommand("go-to-next-error.next.error", () => gotoNextMarkerInFile([vscode.DiagnosticSeverity.Error])),
        vscode.commands.registerCommand("go-to-next-error.nextInFiles.error", () => gotoNextMarkerInFiles([vscode.DiagnosticSeverity.Error])),
        vscode.commands.registerCommand("go-to-next-error.next.warning", () => gotoNextMarkerInFile([vscode.DiagnosticSeverity.Error, vscode.DiagnosticSeverity.Warning])),
        vscode.commands.registerCommand("go-to-next-error.nextInFiles.warning", () => gotoNextMarkerInFiles([vscode.DiagnosticSeverity.Error, vscode.DiagnosticSeverity.Warning])),
    )
}

exports.deactivate = () => { }
