"use client";

import { CenteredModal } from "@/components/CenteredModal";
import { CreateClientForm } from "./AdminForms";

const SUBTLE_BTN = "text-xs text-muted hover:text-brand-2";

interface ManageUsersModalProps {
  spaceName: string;
  /** Server-rendered panel (people list with revoke buttons + access form). */
  children: React.ReactNode;
}

/** Column "Acessos", last row of a space: "Gerenciar usuários" opens a centered modal for that space. */
export function ManageUsersModal({ spaceName, children }: ManageUsersModalProps) {
  return (
    <CenteredModal
      label={`Usuários de ${spaceName}`}
      width={600}
      trigger={(open) => <button type="button" onClick={open} className={SUBTLE_BTN}>Gerenciar usuários →</button>}
    >
      {() => children}
    </CenteredModal>
  );
}

/** Last row of the table, column "Cliente": creates a client (it shows up as a new block above). */
export function NewClientModal({ orgSlug }: { orgSlug: string }) {
  return (
    <CenteredModal
      label="Novo cliente"
      width={460}
      trigger={(open) => <button type="button" onClick={open} className={SUBTLE_BTN}>+ Adicionar cliente</button>}
    >
      {() => <CreateClientForm orgSlug={orgSlug} />}
    </CenteredModal>
  );
}
