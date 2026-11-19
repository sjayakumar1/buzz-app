import type { ReactNode } from "react";
import { ArrowSquareOutIcon } from "../../shared/design-system/icons";
import { Button } from "../../shared/design-system/ui/Button";
import { Switch } from "../../shared/design-system/ui/Switch";
import { ToastNotice } from "../../shared/design-system/ui/Toast";
import styles from "./InlineThreadIntro.module.css";
import {
  setThreadPlacementPreference,
  useThreadPlacementPreference,
} from "./thread-preferences";

const seenKey = "buzz-inline-thread-intro.v1";

/** Whether this device has already been shown how inline threads work. An
 * unreadable store counts as seen, so the intro never repeats on every open. */
export function inlineThreadIntroSeen(): boolean {
  try {
    return localStorage.getItem(seenKey) === "seen";
  } catch {
    return true;
  }
}

export function markInlineThreadIntroSeen(): void {
  try {
    localStorage.setItem(seenKey, "seen");
  } catch {
    // The intro stays for this thread; it may show once more next launch.
  }
}

/** The first inline thread explains itself: reply from its composer, pop it
 * out to a tab, or turn inline threads off. Lives with its thread sheet. */
export function InlineThreadIntro({ onDone }: { onDone(): void }) {
  const { placement } = useThreadPlacementPreference();
  const done = () => {
    markInlineThreadIntroSeen();
    onDone();
  };
  return (
    <ToastNotice
      title="Threads now open right here"
      description="Read the thread and reply from its composer without leaving the conversation."
      details={
        <p className={`text-body-sm ${styles.details}`}>
          Select{" "}
          <ArrowSquareOutIcon
            size={14}
            aria-label="Open in tab"
            className={styles.icon}
          />{" "}
          to turn it into a tab any time. Prefer tabs? Turn this off here or
          later in Appearance settings.
        </p>
      }
      tone="info"
      closeLabel="Dismiss thread tip"
      onDismiss={done}
    >
      <div className={styles.actions}>
        <Switch
          label="Open threads inline"
          checked={placement === "inline"}
          onCheckedChange={(inline) => {
            // Off restores the earlier default; open sheets stay where they are.
            setThreadPlacementPreference(inline ? "inline" : "side");
            markInlineThreadIntroSeen();
          }}
        />
        <Button type="button" size="sm" variant="prominent" onClick={done}>
          Got it
        </Button>
      </div>
    </ToastNotice>
  );
}

/** Rings the control the intro points at while the intro is showing. */
export function IntroSpotlight({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <span className={styles.spotlight} data-active={active || undefined}>
      {children}
    </span>
  );
}
