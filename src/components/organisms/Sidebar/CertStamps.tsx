/// Section-complete "stamps" row rendered under the MiniCertBanner
/// in the active-course sidebar slot. One stamp per chapter — each
/// stamp is a small disc with its own Lucide icon, and lights up
/// holographically once every lesson in its chapter is done.
///
/// Visual language:
///   - Pending stamps: muted grey ring + dimmed icon, no foil.
///   - Earned stamps: parchment-tinted disc + the chapter's
///     icon + a vivid holographic foil overlay so each completed
///     chapter reads as a "you got the badge" moment in the same
///     visual family as the cert banner above.
///
/// Each chapter gets its own icon by hashing the chapter id into
/// a curated icon palette. Stable across sessions since the hash
/// is deterministic and the palette never reorders. Chapters
/// added later in the course's lifecycle get whatever icon their
/// id hashes to without disturbing earlier stamps.

import { Icon } from "@base/primitives/icon";
import type { Chapter } from "@/data/types";
import Hologram from "@/components/atoms/Hologram/Hologram";
import { pickIcon } from "./chapterBadgeIcons";
import { useT } from "@/i18n/i18n";
import "./CertStamps.css";

interface Props {
  courseId: string;
  chapters: Chapter[];
  completed: Set<string>;
}

export default function CertStamps({ courseId, chapters, completed }: Props) {
  const t = useT();
  // Render nothing if the course has no chapters at all — the
  // stamps row would be empty and just leave a gap below the
  // cert banner.
  if (chapters.length === 0) return null;

  return (
    <ul className="libre-cert-stamps" aria-label={t("certificates.ariaStamps")}>
      {chapters.map((chapter) => {
        const total = chapter.lessons.length;
        const done = chapter.lessons.filter((l) =>
          completed.has(`${courseId}:${l.id}`),
        ).length;
        const isEarned = total > 0 && done === total;
        const icon = pickIcon(chapter.id);
        return (
          <li
            key={chapter.id}
            className={`libre-cert-stamp ${
              isEarned ? "libre-cert-stamp--earned" : "libre-cert-stamp--pending"
            }`}
            title={
              isEarned
                ? `${chapter.title} · ${t("certificates.earnedSuffix")}`
                : `${chapter.title} · ${t("certificates.stampLessonProgress", { done, total })}`
            }
          >
            {isEarned && (
              <Hologram
                surface="light"
                intensity="vivid"
                sparkle="snake"
                className="libre-cert-stamp__holo"
              />
            )}
            <span className="libre-cert-stamp__icon" aria-hidden>
              <Icon icon={icon} size="xs" color="currentColor" />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
