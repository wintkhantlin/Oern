"use client";

import { useState } from "react";
import { ConsoleShell } from "@/components/console/console-shell";
import { AuthDialog } from "@/components/delivery/auth-dialog";
import { LoadingBlock } from "@/components/delivery/common";
import { ComplaintsApp } from "@/components/delivery/complaints-app";
import { useWorkspace } from "@/lib/delivery/use-workspace";
import "./manager-complaints-page.css";

export function ManagerComplaintsPage() {
  const workspace = useWorkspace("manager");
  const [authOpen, setAuthOpen] = useState(false);

  if (workspace.isLoading) {
    return <LoadingBlock title="Opening complaints dashboard…" />;
  }

  return (
    <ConsoleShell
      active="complaints"
      pageTitle="Complaints"
      workspace={workspace}
      onSignIn={() => setAuthOpen(true)}
      className="manager-complaints-page"
    >
      <div className="manager-content">
        <div className="manager-complaints-view">
          <ComplaintsApp hideMobileNav hideClassification />
        </div>
      </div>

      <AuthDialog
        open={authOpen}
        audience="team"
        onClose={() => setAuthOpen(false)}
      />
    </ConsoleShell>
  );
}
