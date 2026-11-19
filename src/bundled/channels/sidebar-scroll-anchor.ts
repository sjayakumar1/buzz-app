const rowSelector = '[data-variant="row"], summary, [data-solo-disclosure]';

function layoutTop(row: Element, rect: DOMRect) {
  const slide = row.closest("[data-moving]");
  if (!slide) return rect.top;
  // Team rows animate a vertical translation over their new layout slots.
  return (
    rect.top - new DOMMatrixReadOnly(getComputedStyle(slide).transform).m42
  );
}

/**
 * Native anchoring can lose its anchor during a keyed reorder or follow the
 * focused row as it moves. Keep a small sample of the rows the user is reading.
 */
export function sidebarScrollAnchor(
  viewport: HTMLElement,
  adjust: (top: number) => void,
) {
  let scrollTop = 0;
  let anchors: { row: Element; offset: number }[] = [];
  let inputFrame = 0;
  let pointerDown = false;
  const events = new AbortController();
  const inputOptions = { passive: true, signal: events.signal };

  function onInput() {
    cancelAnimationFrame(inputFrame);
    inputFrame = requestAnimationFrame(() => {
      inputFrame = requestAnimationFrame(() => {
        inputFrame = 0;
      });
    });
  }
  for (const event of ["wheel", "touchmove"])
    viewport.addEventListener(event, onInput, inputOptions);
  // The conversation stepping shortcut can start outside the sidebar.
  window.addEventListener("keydown", onInput, {
    ...inputOptions,
    capture: true,
  });
  viewport.addEventListener(
    "pointerdown",
    () => {
      pointerDown = true;
    },
    inputOptions,
  );
  for (const event of ["pointerup", "pointercancel"])
    window.addEventListener(
      event,
      () => {
        pointerDown = false;
      },
      inputOptions,
    );
  function scrolled() {
    if (inputFrame || pointerDown) onInput();
    capture();
  }

  function capture() {
    scrollTop = viewport.scrollTop;
    anchors = [];
    if (scrollTop <= 0) return;

    const { left, top, width } = viewport.getBoundingClientRect();
    const bottom = top + Math.min(viewport.clientHeight, 160);
    const x = left + width / 2;
    // Hit test the visible strip instead of measuring the entire roster on
    // each scroll. Skip to the next row once we hit one.
    for (let y = Math.max(0, top + 1); y < bottom && anchors.length < 3; ) {
      const row = document
        .elementsFromPoint(x, y)
        // A Solo link can cover just one part of its rendered row.
        .map(
          (hit) =>
            hit.closest("[data-solo-destination-root]") ??
            hit.closest(rowSelector),
        )
        .find((hit) => hit && viewport.contains(hit));
      if (!row) {
        y += 8;
        continue;
      }
      const rect = row.getBoundingClientRect();
      const offset = layoutTop(row, rect) - top;
      if (offset >= 0 && offset + rect.height <= bottom - top)
        anchors.push({ row, offset });
      y = Math.max(y + 1, rect.bottom + 1);
    }
  }

  function refresh() {
    const current = viewport.scrollTop;
    // A browser can move the scrollport during the DOM commit. Only treat
    // that move as drift if layout also changed and no input is in flight.
    const userInput = inputFrame || pointerDown;
    if (anchors.length && (current === scrollTop || !userInput)) {
      const top = viewport.getBoundingClientRect().top;
      const bottom = top + viewport.clientHeight;
      const positions = anchors.flatMap(({ row, offset }) => {
        if (!viewport.contains(row)) return [];
        const rect = row.getBoundingClientRect();
        const rowTop = layoutTop(row, rect);
        return rect.height
          ? [
              {
                shift: rowTop - top - offset,
                outside: rowTop + rect.height <= top || rowTop >= bottom,
              },
            ]
          : [];
      });
      // A single surviving sample far from view may have been promoted. Keep
      // the current scroll offset and sample the rows that remain nearby.
      if (positions.length === 1 && positions[0]?.outside) {
        capture();
        return;
      }
      const shifts = positions.map(({ shift }) => shift);
      if (
        current === scrollTop &&
        shifts.length === anchors.length &&
        shifts.every((shift) => Math.abs(shift) < 0.5)
      )
        return;
      // A single task can move past otherwise stationary neighbors. Use the
      // middle shift when all three survive so it cannot pull the viewport.
      // With two, prefer the row that moved less in the content.
      const browserShift = current - scrollTop;
      const shift =
        shifts.length === 3
          ? shifts.sort((a, b) => a - b)[1]
          : shifts.sort(
              (a, b) => Math.abs(a + browserShift) - Math.abs(b + browserShift),
            )[0];
      if (shift && Math.abs(shift + browserShift) >= 0.5)
        adjust(current + shift);
    }
    capture();
  }

  function dispose() {
    cancelAnimationFrame(inputFrame);
    events.abort();
  }

  return { capture, scrolled, refresh, dispose };
}
