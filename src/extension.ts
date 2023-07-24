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
        if (currentMarker.range.start.isAfterOrEqual(editor.selection.start) && // Select only errors after the cursor.
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

        // Due to the limitations of the VSCode API, we default to using `showHover` instead of `marker.next` when the `filter` is `[Error, Warning]`. #8
        if ((filter.length === 1 && filter[0] === vscode.DiagnosticSeverity.Error) ||
            vscode.workspace.getConfiguration("go-to-next-error").get<"marker" | "hover">("multiSeverityHandlingMethod") === "marker") {
            await vscode.commands.executeCommand("editor.action.marker.next")
        } else {
            // If the problem is not within the viewport
            if (!editor.visibleRanges.every((r) => r.contains(editor.selection))) {
                // Scroll to the error location in the editor
                editor.revealRange(next.range)

                // If smooth scrolling is enabled
                if (vscode.workspace.getConfiguration().get<boolean>("editor.smoothScrolling")) {
                    // Wait for the smooth scroll to complete before displaying the hover because scrolling hides the hover.
                    // 150ms seems to work on all platforms.
                    await new Promise((resolve) => setTimeout(resolve, 150))
                }
            }

            await vscode.commands.executeCommand("editor.action.showHover")
        }
        return true
    }

    const gotoNextMarkerInFiles = async (filter: vscode.DiagnosticSeverity[], direction: "next" | "prev") => {
        // If there is an error before/after the cursor in the file, select it.
        if (await gotoMarkerInFile(filter, direction, false)) { return }

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
            await gotoMarkerInFile(filter, direction, true)
            return
        }

        const currentDocumentUri = vscode.window.activeTextEditor?.document.uri.toString()
        const activeFileIndex = filesSorted.findIndex(([uri]) => uri.toString() === currentDocumentUri)
        const [uri, diagnostics] = filesSorted[activeFileIndex === -1 ? 0 : ((activeFileIndex + 1) % filesSorted.length)]

        const markersSorted = getMarkersSorted(diagnostics);
        const [next, command] = 
            direction === 'next'
            ? [markersSorted[0], "editor.action.marker.nextInFiles"]
            : [markersSorted[markersSorted.length - 1], "editor.action.marker.prevInFiles"]

        // Open the document and select the error.
        lastPosition = { position: next.range.start, uri }
        const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri))
        editor.selection = new vscode.Selection(next.range.start, next.range.start)
        await vscode.commands.executeCommand("closeMarkersNavigation")  // Issue #3
        await vscode.commands.executeCommand(command)
    }

    context.subscriptions.push(
        vscode.commands.registerCommand("go-to-next-error.next.error", () => gotoMarkerInFile([vscode.DiagnosticSeverity.Error], "next")),
        vscode.commands.registerCommand("go-to-next-error.prev.error", () => gotoMarkerInFile([vscode.DiagnosticSeverity.Error], "prev")),
        vscode.commands.registerCommand("go-to-next-error.nextInFiles.error", () => gotoNextMarkerInFiles([vscode.DiagnosticSeverity.Error], "next")),
        vscode.commands.registerCommand("go-to-next-error.prevInFiles.error", () => gotoNextMarkerInFiles([vscode.DiagnosticSeverity.Error], "prev")),
        vscode.commands.registerCommand("go-to-next-error.next.warning", () => gotoMarkerInFile([vscode.DiagnosticSeverity.Error, vscode.DiagnosticSeverity.Warning], "next")),
        vscode.commands.registerCommand("go-to-next-error.prev.warning", () => gotoMarkerInFile([vscode.DiagnosticSeverity.Error, vscode.DiagnosticSeverity.Warning], "prev")),
        vscode.commands.registerCommand("go-to-next-error.nextInFiles.warning", () => gotoNextMarkerInFiles([vscode.DiagnosticSeverity.Error, vscode.DiagnosticSeverity.Warning], "next")),
        vscode.commands.registerCommand("go-to-next-error.prevInFiles.warning", () => gotoNextMarkerInFiles([vscode.DiagnosticSeverity.Error, vscode.DiagnosticSeverity.Warning], "prev")),
    )
}

export const deactivate = () => { }
