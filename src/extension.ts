import * as vscode from "vscode"

export const activate = (context: vscode.ExtensionContext) => {
    let lastPosition: { uri: vscode.Uri, position: vscode.Position } | null = null

    const getMarkersSorted = (diagnostics: vscode.Diagnostic[]) =>
        diagnostics.sort((a, b) => a.range.start.isBefore(b.range.start) ? -1 : (a.range.start.isEqual(b.range.start) ? 0 : 1))

    const getCloserPrev = (editor: vscode.TextEditor, currentMarker: vscode.Diagnostic, soFarClosest: vscode.Diagnostic | null) => {
        if (currentMarker.range.start.isBeforeOrEqual(editor.selection.start) && // Select only errors before the cursor.
            (soFarClosest === null || currentMarker.range.start.isAfter(soFarClosest.range.start)) // Select the error closest to the cursor.
        ) {
            return currentMarker
        }
        return soFarClosest
    }

    const getCloserNext = (editor: vscode.TextEditor, currentMarker: vscode.Diagnostic, soFarClosest: vscode.Diagnostic | null) => {
        if (currentMarker.range.start.isAfterOrEqual(editor.selection.start) && // Select only errors before the cursor.
            (soFarClosest === null || currentMarker.range.start.isBefore(soFarClosest.range.start)) // Select the error closest to the cursor.
        ) {
            return currentMarker
        }
        return soFarClosest
    }

    /**
     * Selects the next error in the active file.
     * Returns false if loop = false and there are no errors after the cursor.
     */
    const gotoMarkerInFile = async (filter: vscode.DiagnosticSeverity[], direction: "next" | "prev", loop = true) => {
        const editor = vscode.window.activeTextEditor
        if (editor === undefined) { return false }
        const diagnostics = vscode.languages.getDiagnostics(editor.document.uri)
            .filter((d) => filter.includes(d.severity))

        if (lastPosition?.uri.toString() !== editor.document.uri.toString()) {
            lastPosition = null
        }
        let next: vscode.Diagnostic | null = null
        if (diagnostics.length === 0) { return false }

        for (const d of diagnostics) {
            if (lastPosition && d.range.start.isEqual(lastPosition.position)) {
                continue
            }

            next = direction === "next"
                ? getCloserNext(editor, d, next)
                : getCloserPrev(editor, d, next)
        }

        if (next === null && loop) {
            const sortedMarkers = getMarkersSorted(diagnostics)
            next = direction === "next" ? sortedMarkers[0] : sortedMarkers[sortedMarkers.length - 1]

            // Fix: When there is only one error location in the file, multiple command calls will select a non-error marker.
            if (lastPosition !== null &&
                lastPosition.position.isEqual(next.range.start) &&
                editor.selection.start.isEqual(next.range.start)
            ) {
                return true
            }
        }

        if (next === null) { return false }

        lastPosition = { position: next.range.start, uri: editor.document.uri }
        editor.selection = new vscode.Selection(next.range.start, next.range.start)
        await vscode.commands.executeCommand("closeMarkersNavigation")  // Issue #3
        await vscode.commands.executeCommand("editor.action.marker.next")
        return true
    }

    const gotoNextMarkerInFiles = async (filter: vscode.DiagnosticSeverity[]) => {
        // If there is an error after the cursor in the file, select it.
        if (await gotoMarkerInFile(filter, "next", false)) { return }

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
            await gotoMarkerInFile(filter, "next", true)
            return
        }

        const currentDocumentUri = vscode.window.activeTextEditor?.document.uri.toString()
        const activeFileIndex = filesSorted.findIndex(([uri]) => uri.toString() === currentDocumentUri)
        const [uri, diagnostics] = filesSorted[activeFileIndex === -1 ? 0 : ((activeFileIndex + 1) % filesSorted.length)]
        const next = getMarkersSorted(diagnostics)[0]

        // Open the document and select the error.
        lastPosition = { position: next.range.start, uri }
        const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri))
        editor.selection = new vscode.Selection(next.range.start, next.range.start)
        await vscode.commands.executeCommand("closeMarkersNavigation")  // Issue #3
        await vscode.commands.executeCommand("editor.action.marker.nextInFiles")
    }

    context.subscriptions.push(
        vscode.commands.registerCommand("go-to-next-error.next.error", () => gotoMarkerInFile([vscode.DiagnosticSeverity.Error], "next")),
        vscode.commands.registerCommand("go-to-next-error.prev.error", () => gotoMarkerInFile([vscode.DiagnosticSeverity.Error], "prev")),
        vscode.commands.registerCommand("go-to-next-error.nextInFiles.error", () => gotoNextMarkerInFiles([vscode.DiagnosticSeverity.Error])),
        vscode.commands.registerCommand("go-to-next-error.next.warning", () => gotoMarkerInFile([vscode.DiagnosticSeverity.Error, vscode.DiagnosticSeverity.Warning], "next")),
        vscode.commands.registerCommand("go-to-next-error.prev.warning", () => gotoMarkerInFile([vscode.DiagnosticSeverity.Error, vscode.DiagnosticSeverity.Warning], "prev")),
        vscode.commands.registerCommand("go-to-next-error.nextInFiles.warning", () => gotoNextMarkerInFiles([vscode.DiagnosticSeverity.Error, vscode.DiagnosticSeverity.Warning])),
    )
}

export const deactivate = () => { }
