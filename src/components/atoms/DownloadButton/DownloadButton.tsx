/// Split-button download — primary face for the user's detected
/// OS, caret on the right that reveals every platform option.
/// Mirrors the "+ Add course ▾" split-button pattern in
/// AddCourseButton so the two CTAs feel like part of the same UI
/// vocabulary.
///
/// Used wherever the web build needs to send a visitor to a
/// platform-specific desktop download — the welcome screen, the
/// floating InstallBanner, and any future marketing-side copy
/// that consumes this repo's components.

import { useRef, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { download as downloadIcon } from "@base/primitives/icon/icons/download";
import { chevronDown } from "@base/primitives/icon/icons/chevron-down";
import "@base/primitives/icon/icon.css";
import { downloadUrl } from "@/lib/platform";
import { track } from "@/lib/track";
import { useDismiss } from "@/hooks/useDismiss";
import "./DownloadButton.css";

interface Props {
  /// Optional className the host can use to size or position the
  /// button differently per surface (e.g. larger on the welcome
  /// screen, compact in the InstallBanner). Applied to the root
  /// wrapper so internal styles still work.
  className?: string;
  /// When set, overrides the default primary CTA label
  /// ("Download for macOS"). The dropdown items keep the per-OS
  /// labels regardless.
  primaryLabel?: string;
}

export default function DownloadButton({ className, primaryLabel }: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const { primary, all } = downloadUrl();

  // Click-outside (+ Escape) dismiss. Avoids weaving refs through every
  // conceivable child of whatever this sits inside.
  useDismiss(wrapperRef, () => setOpen(false), {
    enabled: open,
    event: "mousedown",
  });

  const labelFor = (os: "macos" | "windows" | "linux") =>
    os === "macos" ? "macOS" : os === "windows" ? "Windows" : "Linux";

  return (
    <div
      className={`libre-download${className ? ` ${className}` : ""}`}
      ref={wrapperRef}
    >
      <div className="libre-download-split">
        <a
          href={primary.url}
          className="libre-download-main"
          target="_blank"
          rel="noopener noreferrer"
          title="Open the latest desktop release on GitHub"
          onClick={() => track.installClick(primary.os)}
        >
          <Icon icon={downloadIcon} size="xs" color="currentColor" />
          <span>{primaryLabel ?? primary.label}</span>
        </a>
        <button
          type="button"
          className="libre-download-caret"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="Pick a different platform"
          title="Pick a different platform"
        >
          <Icon icon={chevronDown} size="xs" color="currentColor" />
        </button>
      </div>

      {open && (
        <div
          className="libre-download-menu"
          role="menu"
          aria-label="Pick a platform"
        >
          {all.map((target) => {
            const isPrimary = target.os === primary.os;
            return (
              <a
                key={target.os}
                role="menuitem"
                href={target.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`libre-download-item${
                  isPrimary ? " libre-download-item--primary" : ""
                }`}
                onClick={() => {
                  track.installClick(target.os);
                  setOpen(false);
                }}
              >
                <Icon icon={downloadIcon} size="xs" color="currentColor" />
                <span className="libre-download-item-body">
                  <span className="libre-download-item-title">
                    {labelFor(target.os)}
                  </span>
                  <span className="libre-download-item-hint">
                    {target.os === "macos"
                      ? ".dmg · Apple Silicon + Intel"
                      : target.os === "windows"
                        ? ".msi installer · x64"
                        : ".AppImage / .deb · x64"}
                  </span>
                </span>
                {isPrimary && (
                  <span className="libre-download-item-badge">
                    Detected
                  </span>
                )}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
