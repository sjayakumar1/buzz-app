// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { registerOverlayComposer } from "../../features/messages/composer-overlay";
import {
  setThreadPlacementPreference,
  threadPlacementPreference,
} from "../../features/messages/thread-preferences";
import { ChannelBody } from "./ChannelBody";

const fixture = vi.hoisted(() => {
  let snapshot = {
    status: "ready",
    rows: [{ id: "root" }],
    error: undefined as string | undefined,
  };
  const listeners = new Set<() => void>();
  return {
    session: {
      channels: {
        ensure: () => {},
        window: () => snapshot,
        subscribeWindow: (_id: string, listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
    },
    update(status: string, rows: { id: string }[], error?: string) {
      snapshot = { status, rows, error };
      for (const listener of listeners) listener();
    },
  };
});
// Isolate ChannelBody's ownership from the independent message renderers. The
// sheet, subscription, focus boundary and editor DOM lifetime remain real.
vi.mock("../../features/conversation/Conversation", () => ({
  useConversation: () => ({
    session: fixture.session,
    channelId: "alpha",
    ownSoloConversation: false,
  }),
  ConversationTimeline: ({
    onOpenThread,
  }: {
    onOpenThread(messageId: string, rootId: string): void;
  }) => (
    <button type="button" onClick={() => onOpenThread("root", "root")}>
      Open reply
    </button>
  ),
  ConversationThread: () => <textarea aria-label="Thread draft" />,
}));
vi.mock("../../features/relay/RecoveryNotice", () => ({
  useRecoveryOwns: () => false,
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

it("keeps the focused thread and draft mounted through channel loading and recovery", () => {
  fixture.update("ready", [{ id: "root" }]);
  const view = render(
    <div data-composer-host="">
      <ChannelBody cached={false} onOpenThread={() => {}} />
      <form
        data-message-composer
        ref={(node) => (node ? registerOverlayComposer(node) : undefined)}
        style={{ borderRadius: "12px" }}
      />
    </div>,
  );
  const trigger = screen.getByRole("button", { name: "Open reply" });
  trigger.focus();
  fireEvent.click(trigger);
  const editor = screen.getByRole("textbox", { name: "Thread draft" });
  fireEvent.change(editor, { target: { value: "Unfinished reply" } });
  editor.focus();
  for (const status of ["loading", "error", "ready"]) {
    act(() =>
      fixture.update(
        status,
        status === "ready" ? [{ id: "new" }] : [],
        "Refresh failed",
      ),
    );
    expect(screen.getByRole("dialog", { name: "Thread" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Thread draft" })).toBe(editor);
    expect(editor).toHaveValue("Unfinished reply");
    expect(editor).toHaveFocus();
  }
  fireEvent.click(screen.getByRole("button", { name: "Close thread" }));
  view.unmount();
});

it.each(["side", "main"] as const)(
  "opens threads in a tab instead of inline when they open in the %s pane",
  (pane) => {
    setThreadPlacementPreference(pane);
    fixture.update("ready", [{ id: "root" }]);
    const openThread = vi.fn();
    render(
      <div data-composer-host="">
        <ChannelBody cached={false} onOpenThread={openThread} />
        <form
          data-message-composer
          ref={(node) => (node ? registerOverlayComposer(node) : undefined)}
        />
      </div>,
    );
    const trigger = screen.getByRole("button", { name: "Open reply" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(openThread).toHaveBeenCalledWith("root", "root", undefined);
    expect(screen.queryByRole("dialog", { name: "Thread" })).toBeNull();
  },
);

it("reads at the bottom even when a separate thread tab exists", () => {
  fixture.update("ready", [{ id: "root" }]);
  const openThread = vi.fn();
  render(
    <div data-composer-host="">
      <ChannelBody
        cached={false}
        onOpenThread={openThread}
        hasThreadTab={(channelId, rootId) =>
          channelId === "alpha" && rootId === "root"
        }
      />
      <form
        data-message-composer
        ref={(node) => (node ? registerOverlayComposer(node) : undefined)}
      />
    </div>,
  );
  const trigger = screen.getByRole("button", { name: "Open reply" });
  trigger.focus();
  fireEvent.click(trigger);
  expect(openThread).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "Thread draft" })).toBeVisible();
});

it("introduces the first inline thread once in two steps: replying here, then its tab button and inline switch", async () => {
  fixture.update("ready", [{ id: "root" }]);
  const view = render(
    <div data-composer-host="">
      <ChannelBody cached={false} onOpenThread={() => {}} />
      <form
        data-message-composer
        ref={(node) => (node ? registerOverlayComposer(node) : undefined)}
      />
    </div>,
  );
  const open = () => {
    const trigger = screen.getByRole("button", { name: "Open reply" });
    trigger.focus();
    fireEvent.click(trigger);
  };
  open();
  const editor = screen.getByRole("textbox", { name: "Thread draft" });
  // Step 1 points at the thread's title and leaves its composer focused.
  const first = await screen.findByRole("dialog", {
    name: "Threads can now open without a tab",
  });
  expect(first).toHaveTextContent("1 of 2");
  expect(screen.getByText("Thread").closest("[data-shape]")).toHaveAttribute(
    "data-active",
  );
  // The step never takes focus from the thread's composer.
  editor.focus();
  await act(async () => {});
  expect(editor).toHaveFocus();
  // Reading the thread does not dismiss it.
  fireEvent.pointerDown(editor);
  expect(
    screen.getByRole("dialog", { name: "Threads can now open without a tab" }),
  ).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  const second = await screen.findByRole("dialog", {
    name: "Open in a tab anytime",
  });
  expect(second).toHaveTextContent("2 of 2");
  const popOut = screen.getByRole("button", { name: "Open thread in tab" });
  expect(popOut.parentElement).toHaveAttribute("data-active");

  // Turning inline off applies to later threads; the step stays to undo it.
  fireEvent.click(screen.getByRole("switch", { name: "Open threads inline" }));
  expect(threadPlacementPreference()).toBe("side");
  fireEvent.click(screen.getByRole("switch", { name: "Open threads inline" }));
  expect(threadPlacementPreference()).toBe("inline");

  fireEvent.click(screen.getByRole("button", { name: "Got it" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Open in a tab anytime" }),
    ).toBeNull(),
  );
  // Once done, the button names itself on hover again.
  expect(
    screen
      .getByRole("button", { name: "Open thread in tab" })
      .closest("[data-shape]"),
  ).not.toHaveAttribute("data-active");

  fireEvent.click(screen.getByRole("button", { name: "Close thread" }));
  open();
  expect(screen.getByRole("dialog", { name: "Thread" })).toBeVisible();
  await act(async () => {});
  expect(
    screen.queryByRole("dialog", {
      name: "Threads can now open without a tab",
    }),
  ).toBeNull();
  view.unmount();
});
