"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";

export default function WorkspaceDialog({
  title,
  closeLabel,
  onClose,
  children,
  footer,
  className = "",
}: {
  title: ReactNode;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    }

    window.addEventListener("keydown", handleEscape, true);
    return () => {
      window.removeEventListener("keydown", handleEscape, true);
      previousFocus?.focus?.();
    };
  }, []);

  return (
    <div className="workspace-dialog-layer">
      <button
        type="button"
        className="workspace-dialog-backdrop"
        onClick={onClose}
        aria-label={closeLabel}
      />
      <section
        className={`workspace-dialog popup-3d ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="workspace-dialog-header">
          <h2 id={titleId} className="font-display">
            {title}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            className="menu-action workspace-dialog-close"
            onClick={onClose}
            aria-label={closeLabel}
          >
            x
          </button>
        </header>
        <div className="workspace-dialog-body">{children}</div>
        {footer ? <footer className="workspace-dialog-footer">{footer}</footer> : null}
      </section>
    </div>
  );
}
