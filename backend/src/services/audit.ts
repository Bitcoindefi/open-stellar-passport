import { v4 as uuidv4 } from "uuid";

interface AuditEntry {
  id: string;
  action: string;
  actor: string;
  target?: string;
  reason?: string;
  note?: string;
  timestamp: Date;
}

const auditLog: AuditEntry[] = [];

export async function emitAudit(
  entry: Omit<AuditEntry, "id" | "timestamp">
): Promise<void> {
  const fullEntry: AuditEntry = {
    id: uuidv4(),
    ...entry,
    timestamp: new Date(),
  };
  auditLog.push(fullEntry);
  // In production: write to DB / event bus / SIEM
  console.log("[AUDIT]", JSON.stringify(fullEntry));
}

export function getAuditLog(): AuditEntry[] {
  return [...auditLog];
}