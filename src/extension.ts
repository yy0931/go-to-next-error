import * as vscode from "vscode"

export const activate = (context: vscode.ExtensionContext) => {
    /** Keep track of the last marker position to prevent selecting the same marker repeatedly */
    let lastPosition: { uri: vscode.Uri, position: vscode.Position } | null = null

    /** Sorts markers based on their start positions in ascending order, in place. */
    const sortMarkers = (diagnostics: vscode.Diagnostic[]) =>
        diagnostics.sort((a, b) => a.range.start.isBefore(b.range.start) ? -1 : (a.range.start.isEqual(b.range.start) ? 0 : 1))

    /**
     * Returns either `marker` or `soFarClosest`, depending on which one is closer to and located before the current cursor position.
     * - If `soFarClosest` is null: Returns `marker` if `marker <= cursor`. Returns null otherwise.
     * - If `soFarClosest` is not null: Returns `marker` if `soFarClosest < marker <= cursor`. Returns `soFarClosest` otherwise.
     */
    const getCloserPrev = (editor: vscode.TextEditor, marker: vscode.Diagnostic, soFarClosest: vscode.Diagnostic | null) => {
        if (soFarClosest === null) {
            return marker.range.start.isBeforeOrEqual(editor.selection.start) ? marker : soFarClosest
        } else {
            return (marker.range.start.isBeforeOrEqual(editor.selection.start) && marker.range.start.isAfter(soFarClosest.range.start)) ? marker : soFarClosest
        }
    }

    /**
     * Returns either `marker` or `soFarClosest`, depending on which one is closer to and located after the current cursor position.
     * - If `soFarClosest` is null: Returns `marker` if `cursor <= marker`. Returns null otherwise.
     * - If `soFarClosest` is not null: Returns `marker` if `cursor <= marker < soFarClosest`. Returns `soFarClosest` otherwise.
     */
    const getCloserNext = (editor: vscode.TextEditor, marker: vscode.Diagnostic, soFarClosest: vscode.Diagnostic | null) => {
        if (soFarClosest === null) {
            return marker.range.start.isAfterOrEqual(editor.selection.start) ? marker : soFarClosest
        } else {
            return (marker.range.start.isAfterOrEqual(editor.selection.start) && marker.range.start.isBefore(soFarClosest.range.start)) ? marker : soFarClosest
        }
    }

    /**
     * Navigates to the next/previous error in the active file.
     * @param filter - The targeted marker severities.
     * @param direction - Specifies the direction of navigation.
     * @param loop - If true, when the direction is "next" and the currently active marker is the last one in the file, this function will cycle back to and select the first marker in the file. Similarly, if the direction is "prev" and the currently active marker is the first one in the file, this function will select the last marker in the file.
     * @returns true if the next/previous marker was found; This includes the case where the first marker is selected when `loop` is true. If no such marker is found, the function returns false.
     */
    const gotoMarkerInFile = async (filter: vscode.DiagnosticSeverity[], direction: "next" | "prev", loop = true) => {
        // Get active text editor
        const editor = vscode.window.activeTextEditor
        if (editor === undefined) { return false }

        // Get markers in the text editor that matches severity in filter
        const diagnostics = vscode.languages.getDiagnostics(editor.document.uri)
            .filter((d) => filter.includes(d.severity))

        // Reset lastPosition if active document has changed
        if (lastPosition?.uri.toString() !== editor.document.uri.toString()) {
            lastPosition = null
        }

        // Return if there are no diagnostics in the active text editor
        if (diagnostics.length === 0) { return false }

        let next: vscode.Diagnostic | null = null

        // Find the next/previous marker in the active text editor
        for (const d of diagnostics) {
            if (lastPosition && d.range.start.isEqual(lastPosition.position)) {
                continue
            }

            next = direction === "next"
                ? getCloserNext(editor, d, next)
                : getCloserPrev(editor, d, next)
        }

        // If there is no next/previous marker and `loop` is true, then select the first/last marker in the active text editor.
        if (next === null && loop) {
            const sortedMarkers = sortMarkers(diagnostics)
            next = direction === "next" ? sortedMarkers[0] : sortedMarkers[sortedMarkers.length - 1]

            // Fixes: When there is only one error location in the file, multiple command calls will select a non-error marker.
            if (lastPosition !== null &&
                lastPosition.position.isEqual(next.range.start) &&
                editor.selection.start.isEqual(next.range.start)
            ) {
                return true
            }
        }

        if (next === null) { return false }

        // Update `lastPosition`
        lastPosition = { position: next.range.start, uri: editor.document.uri }

        // Move the cursor to the start position of the selected marker.
        editor.selection = new vscode.Selection(next.range.start, next.range.start)

        await vscode.commands.executeCommand("closeMarkersNavigation")  // Issue #3

        // Show the error using either the "editor.action.marker.next" command or the "editor.action.showHover" command.
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

    /**
     * Navigates to the next/previous error in the active file if one exists.
     * If not, navigates to the next/previous marker in the next text file, sorted by URI.
     * @param filter - The targeted marker severities.
     * @param direction - Specifies the direction of navigation.
     */
    const gotoNextMarkerInFiles = async (filter: vscode.DiagnosticSeverity[], direction: "next" | "prev") => {
        // If there is an error before/after the cursor in the file, select it.
        if (await gotoMarkerInFile(filter, direction, false)) { return }

        // List files that contain markers of the specified severities.
        const filesSorted = vscode.languages.getDiagnostics()
            // Skip files that do not contain markers of targeted severities.
            .filter((file) => {
                file[1] = file[1].filter((d) => filter.includes(d.severity))
                return file[1].length > 0
            })
            // Sort files by URI
            .sort(([uri1], [uri2]) => uri1.toString() < uri2.toString() ? -1 : (uri1.toString() === uri2.toString() ? 0 : 1))

        // If there are no files that contain markers
        if (filesSorted.length === 0) { return }

        // If there are no files that contain markers except the active file
        if (filesSorted.length === 1 && filesSorted[0][0].toString() === vscode.window.activeTextEditor?.document.uri.toString()) {
            // Fixes: When there is only one error location in all files, consecutive command calls will select a non-error marker.
            await gotoMarkerInFile(filter, direction, true)
            return
        }

        // Selects the next file.
        const getNextFile = () => {
            // Get the array index of the active file in `filesSorted`
            const currentDocumentUri = vscode.window.activeTextEditor?.document.uri.toString()
            const activeFileIndex = filesSorted.findIndex(([uri]) => uri.toString() === currentDocumentUri)

            // Return the next/previous file
            return filesSorted[activeFileIndex === -1 ? 0 : ((activeFileIndex + 1) % filesSorted.length)]
        }
        const [uri, diagnostics] = getNextFile()

        // Select the next/previous marker
        const sortedMarkers = sortMarkers(diagnostics);
        const next = direction === "next" ? sortedMarkers[0] : sortedMarkers[sortedMarkers.length - 1]

        // Update `lastPosition`
        lastPosition = { position: next.range.start, uri }

        // Open the document
        const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri))

        // Move the cursor to the start position of the selected marker.
        editor.selection = new vscode.Selection(next.range.start, next.range.start)

        await vscode.commands.executeCommand("closeMarkersNavigation")  // Issue #3

        // Show the error
        if (direction === "next") {
            await vscode.commands.executeCommand("editor.action.marker.nextInFiles")
        } else {
            await vscode.commands.executeCommand("editor.action.marker.prevInFiles")
        }
    }

    context.subscriptions.push(
        // Go to Next/Previous Problem (Error)
        vscode.commands.registerCommand("go-to-next-error.next.error", () => gotoMarkerInFile([vscode.DiagnosticSeverity.Error], "next")),
        vscode.commands.registerCommand("go-to-next-error.prev.error", () => gotoMarkerInFile([vscode.DiagnosticSeverity.Error], "prev")),

        // Go to Next/Previous Problem in Files (Error)
        vscode.commands.registerCommand("go-to-next-error.nextInFiles.error", () => gotoNextMarkerInFiles([vscode.DiagnosticSeverity.Error], "next")),
        vscode.commands.registerCommand("go-to-next-error.prevInFiles.error", () => gotoNextMarkerInFiles([vscode.DiagnosticSeverity.Error], "prev")),

        // Go to Next/Previous Problem (Error, Warning)
        vscode.commands.registerCommand("go-to-next-error.next.warning", () => gotoMarkerInFile([vscode.DiagnosticSeverity.Error, vscode.DiagnosticSeverity.Warning], "next")),
        vscode.commands.registerCommand("go-to-next-error.prev.warning", () => gotoMarkerInFile([vscode.DiagnosticSeverity.Error, vscode.DiagnosticSeverity.Warning], "prev")),

        // Go to Next/Previous Problem in Files (Error, Warning)
        vscode.commands.registerCommand("go-to-next-error.nextInFiles.warning", () => gotoNextMarkerInFiles([vscode.DiagnosticSeverity.Error, vscode.DiagnosticSeverity.Warning], "next")),
        vscode.commands.registerCommand("go-to-next-error.prevInFiles.warning", () => gotoNextMarkerInFiles([vscode.DiagnosticSeverity.Error, vscode.DiagnosticSeverity.Warning], "prev")),
    )
}

export const deactivate = () => { }
