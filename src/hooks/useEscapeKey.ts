import { useEffect } from "react";

/// Fire `onEscape` whenever the user presses the Escape key while this
/// hook is mounted. The listener is attached on mount and cleaned up on
/// unmount, so the hook is safe to use inside conditionally-rendered
/// dialogs / overlays — listening only happens while the surface is on
/// screen.
///
/// Why not just inline the useEffect? Because every dialog in the app
/// needs the same five-line incantation:
///
///     useEffect(() => {
///       const onKey = (e: KeyboardEvent) => {
///         if (e.key === "Escape") onClose();
///       };
///       window.addEventListener("keydown", onKey);
///       return () => window.removeEventListener("keydown", onKey);
///     }, [onClose]);
///
/// Repeated verbatim across ConfirmDialog, SignInDialog, SettingsDialog,
/// ImportDialog, BulkImportDialog, FixApplierDialog, GeneratePackDialog,
/// DocsImportDialog, CourseSettingsModal — extracting it to one hook
/// removes ~9 copies of the same five-line snippet and makes "what does
/// Escape do" answerable from one file.
///
/// `enabled` defaults to true. Pass `false` to skip wiring up the
/// listener — useful when a dialog is open-state'd from a parent and
/// you want a single hook call rather than a conditional mount.
export function useEscapeKey(onEscape: () => void, enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEscape, enabled]);
}
