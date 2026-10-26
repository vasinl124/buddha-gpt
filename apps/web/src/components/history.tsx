"use client";

import { SquarePenIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { groups, type SavedChat } from "@/lib/history";

interface HistoryProps {
  chats: SavedChat[];
  current: string;
  disabled: boolean; // a reply is on its way: the conversation stays put
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

// The conversations kept in this browser, newest first and grouped by day, as in ChatGPT. Opening one,
// or starting anew, closes the drawer on a phone. Deleting asks once more, on the same button.
export function History({ chats, current, disabled, onOpen, onNew, onDelete }: HistoryProps) {
  const { isMobile, setOpenMobile } = useSidebar();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [now] = useState(Date.now); // the day's sections move at midnight on the next visit
  const done = () => isMobile && setOpenMobile(false);

  return (
    <Sidebar>
      <SidebarHeader className="pt-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              disabled={disabled}
              onClick={() => {
                onNew();
                done();
              }}
            >
              <SquarePenIcon />
              <span>New conversation</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {chats.length === 0 && <p className="px-4 py-2 text-xs text-muted-foreground">Your conversations will show here.</p>}
        {groups(chats, now).map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarMenu>
              {group.chats.map((chat) => {
                const asking = confirm === chat.id;
                return (
                  <SidebarMenuItem key={chat.id}>
                    <SidebarMenuButton
                      isActive={chat.id === current}
                      disabled={disabled}
                      title={chat.title}
                      onClick={() => {
                        onOpen(chat.id);
                        done();
                      }}
                    >
                      <span>{chat.title}</span>
                    </SidebarMenuButton>
                    <SidebarMenuAction
                      showOnHover={!asking}
                      disabled={disabled}
                      aria-label={asking ? "Delete this conversation" : "Delete conversation"}
                      className={asking ? "aspect-auto w-auto bg-sidebar-accent px-1.5 text-xs font-medium text-destructive hover:text-destructive" : undefined}
                      onBlur={() => setConfirm(null)}
                      onClick={() => {
                        if (!asking) return setConfirm(chat.id);
                        setConfirm(null);
                        onDelete(chat.id);
                      }}
                    >
                      {asking ? "Delete" : <Trash2Icon />}
                    </SidebarMenuAction>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <p className="px-2 pb-1 text-xs text-muted-foreground">Kept in this browser only.</p>
      </SidebarFooter>
    </Sidebar>
  );
}
