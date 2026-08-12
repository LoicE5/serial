"use client";

import { useAtom } from "jotai";
import { ArchiveIcon, InboxIcon } from "lucide-react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@serial/ui";
import type { ArchiveStatus, SaveStatus } from "~/lib/content-status";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { contentStatusFilterAtom } from "~/lib/data/atoms";
import { KeyboardShortcutDisplay } from "~/components/ButtonWithShortcut";
import { SHORTCUT_KEYS } from "~/lib/constants/shortcuts";
import { cn } from "~/lib/utils";

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
  const isSaved = contentStatus.saveStatus === "saved";

  return (
    <div className="flex gap-1">
      <SwitchPrimitive.Root
        checked={isSaved}
        onCheckedChange={(checked) => {
          setContentStatus((current) => ({
            ...current,
            saveStatus: checked ? "saved" : "inbox",
          }));
        }}
        aria-label="Inbox or Saved"
        className="group/save-switch focus-visible:border-ring focus-visible:ring-ring/50 bg-muted/30 text-foreground/60 dark:text-muted-foreground relative grid h-9 cursor-pointer grid-cols-2 items-center rounded-lg p-[3px] text-sm font-medium transition-colors focus-visible:ring-[3px] focus-visible:outline-none"
      >
        {SAVE_STATUS_OPTIONS.map((option) => {
          const isSelected = contentStatus.saveStatus === option.value;

          return (
            <span
              aria-hidden="true"
              className={cn(
                "relative z-10 flex h-[calc(100%-1px)] items-center justify-center gap-1.5 rounded-md px-2 py-1 whitespace-nowrap transition-colors",
                isSelected && "text-foreground",
              )}
              key={option.value}
            >
              {option.label}
              <KeyboardShortcutDisplay shortcut={option.shortcut} />
            </span>
          );
        })}
        <SwitchPrimitive.Thumb
          className="bg-background dark:border-input dark:bg-input/30 pointer-events-none absolute top-[3px] z-0 h-[calc(100%-6px)] w-[calc(50%-3px)] rounded-md border border-transparent shadow-sm transition-[left] duration-200"
          style={{ left: isSaved ? "50%" : "3px" }}
        />
      </SwitchPrimitive.Root>

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
            <Tooltip key={option.value}>
              <TooltipTrigger asChild>
                <TabsTrigger
                  className="relative"
                  value={option.value}
                  aria-label={`Switch to ${option.value} content`}
                >
                  {option.Icon}
                  <KeyboardShortcutDisplay shortcut={option.shortcut} />
                </TabsTrigger>
              </TooltipTrigger>
              <TooltipContent>{option.label}</TooltipContent>
            </Tooltip>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
