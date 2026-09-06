import type { ReactNode } from "react";
import Avatar from "./Avatar";
import "./ui.css";

export default function ChatBubble({
  role,
  children,
  characterName,
  actions,
}: {
  role: "user" | "character";
  children: ReactNode;
  characterName?: string;
  actions?: ReactNode;
}) {
  return (
    <div className={`k-bubble-row k-bubble-row--${role}`}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexDirection: role === "user" ? "row-reverse" : "row" }}>
        {role === "character" && <Avatar name={characterName ?? "?"} size="sm" />}
        <div className={`k-bubble k-bubble--${role}`}>{children}</div>
      </div>
      {actions}
    </div>
  );
}
