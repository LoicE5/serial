"use client";

import { useAtom } from "jotai";
import { ArchiveIcon, InboxIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@serial/ui";
import type { ArchiveStatus, SaveStatus } from "~/lib/content-status";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { contentStatusFilterAtom } from "~/lib/data/atoms";
import { KeyboardShortcutDisplay } from "~/components/ButtonWithShortcut";
import { SHORTCUT_KEYS } from "~/lib/constants/shortcuts";

const SAVE_STATUS_OPTIONS: Array<{
  value: SaveStatus;
  label: string;
  shortcut: string;
}> = [
  { value: "inbox", label: "Inbox", shortcut: SHORTCUT_KEYS.INBOX },
  { value: "saved", label: "Saved", shortcut: SHORTCUT_KEYS.SAVED },
];

const ARCHIVE_STATUS_OPTIONS: Array<{
  value: ArchiveStatus;
  label: string;
  shortcut: string;
  Icon: React.ReactNode;
}> = [
  {
    value: "unread",
    label: "Unread",
    shortcut: SHORTCUT_KEYS.UNREAD,
    Icon: <InboxIcon />,
  },
  {
    value: "archived",
    label: "Archived",
    shortcut: SHORTCUT_KEYS.ARCHIVED,
    Icon: <ArchiveIcon />,
  },
];

export function ContentStatusControls() {
  const [contentStatus, setContentStatus] = useAtom(contentStatusFilterAtom);

  return (
    <div className="flex gap-1">
      <Tabs
        value={contentStatus.saveStatus}
        onValueChange={(saveStatus) => {
          if (!saveStatus) return;
          setContentStatus((current) => ({
            ...current,
            saveStatus: saveStatus as SaveStatus,
          }));
        }}
      >
        <TabsList>
          {SAVE_STATUS_OPTIONS.map((option) => (
            <TabsTrigger
              className="relative"
              key={option.value}
              value={option.value}
            >
              {option.label}
              <KeyboardShortcutDisplay shortcut={option.shortcut} />
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Tabs
        value={contentStatus.archiveStatus}
        onValueChange={(archiveStatus) => {
          if (!archiveStatus) return;
          setContentStatus((current) => ({
            ...current,
            archiveStatus: archiveStatus as ArchiveStatus,
          }));
        }}
      >
        <TabsList>
          {ARCHIVE_STATUS_OPTIONS.map((option) => (
            <Tooltip delayDuration={500} key={option.value}>
              <TabsTrigger
                className="relative"
                value={option.value}
                aria-label={`Switch to ${option.value} content`}
                asChild
              >
                <TooltipTrigger>
                  {option.Icon}
                  <KeyboardShortcutDisplay shortcut={option.shortcut} />
                </TooltipTrigger>
              </TabsTrigger>
              <TooltipContent>{option.label}</TooltipContent>
            </Tooltip>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
