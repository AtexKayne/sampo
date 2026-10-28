import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./Sheet.module.scss";

const MOBILE = "(max-width: 799px)";
const DISMISS = 88;
const EXIT_MS = 320;
let locks = 0;

function lockPage() {
  locks += 1;
  document.documentElement.dataset.sheet = "1";
  document.body.style.overflow = "hidden";
}

function unlockPage() {
  locks = Math.max(0, locks - 1);
  if (locks === 0) {
    delete document.documentElement.dataset.sheet;
    document.body.style.overflow = "";
  }
}

function mobileSheet() {
  return typeof window !== "undefined" && window.matchMedia(MOBILE).matches;
}

export function Sheet({
  children,
  footer = null,
  onClose,
  labelledBy,
  describedBy,
  className = "",
  size = "m",
  as: Tag = "div",
  ...rest
}) {
  const sheetRef = useRef(null);
  const startY = useRef(null);
  const dragging = useRef(false);
  const offsetRef = useRef(0);
  const leavingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const [offset, setOffset] = useState(0);
  const [drag, setDrag] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [ready, setReady] = useState(false);
  onCloseRef.current = onClose;

  useEffect(() => {
    lockPage();
    return unlockPage;
  }, []);

  useEffect(() => {
    if (!mobileSheet()) {
      setReady(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setReady(true), EXIT_MS + 30);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape") dismiss();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!leaving) return undefined;
    const timer = window.setTimeout(() => onCloseRef.current(), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  function dismiss() {
    if (leavingRef.current) return;
    if (!mobileSheet()) {
      onCloseRef.current();
      return;
    }
    leavingRef.current = true;
    dragging.current = false;
    setDrag(false);
    setLeaving(true);
  }

  function beginDrag(event) {
    if (leavingRef.current || !mobileSheet() || event.pointerType === "mouse") return;
    if (!event.target.closest("[data-sheet-handle]")) return;
    dragging.current = true;
    startY.current = event.clientY;
    setReady(true);
    setDrag(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveDrag(event) {
    if (!dragging.current || startY.current == null) return;
    const next = Math.max(0, event.clientY - startY.current);
    offsetRef.current = next;
    setOffset(next);
  }

  function endDrag() {
    if (!dragging.current) return;
    dragging.current = false;
    startY.current = null;
    setDrag(false);
    if (offsetRef.current >= DISMISS) {
      dismiss();
      return;
    }
    offsetRef.current = 0;
    setOffset(0);
  }

  const sizeClass = size === "xl" ? styles.xl : size === "l" ? styles.l : "";
  const interact = ready || drag || leaving || offset > 0;
  const motion = interact
    ? {
        transform: leaving ? "translateY(100%)" : `translateY(${offset}px)`,
        transition: drag ? "none" : `transform ${EXIT_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`,
        animation: "none",
      }
    : undefined;
  const dimMotion = interact
    ? {
        opacity: leaving ? 0 : offset > 0 ? Math.max(0.12, 1 - offset / 400) : 1,
        transition: drag ? "none" : `opacity ${EXIT_MS}ms ease-out`,
        animation: "none",
      }
    : undefined;

  return createPortal(
    <div className={[styles.backdrop, leaving ? styles.leaving : ""].filter(Boolean).join(" ")} onClick={dismiss}>
      <div className={styles.dim} style={dimMotion} />
      <Tag
        className={[styles.sheet, sizeClass, footer ? styles.withFooter : "", ready ? styles.ready : "", className].filter(Boolean).join(" ")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        ref={sheetRef}
        style={motion}
        onClick={(event) => event.stopPropagation()}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget) setReady(true);
        }}
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        {...rest}
      >
        <div className={styles.handle} data-sheet-handle aria-hidden="true">
          <span className={styles.grip} />
        </div>
        <div className={styles.body}>{children}</div>
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </Tag>
    </div>,
    document.body,
  );
}
