import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./Sheet.module.scss";

const MOBILE = "(max-width: 799px)";
const DISMISS = 88;
const EXIT_MS = 320;
const DESKTOP_MS = 180;
let locks = 0;
let savedY = 0;
let touchY = 0;
let pinnedRoot = null;

function canScroll(node, deltaY) {
  if (!(node instanceof HTMLElement)) return false;
  const overflowY = window.getComputedStyle(node).overflowY;
  if (overflowY !== "auto" && overflowY !== "scroll") return false;
  const room = node.scrollHeight - node.clientHeight;
  if (room <= 0) return false;
  if (deltaY < 0) return node.scrollTop > 0;
  if (deltaY > 0) return node.scrollTop < room - 1;
  return true;
}

function pathCanScroll(target, deltaY) {
  let node = target instanceof Text ? target.parentElement : target;
  while (node instanceof HTMLElement && node !== document.body && node !== document.documentElement) {
    if (canScroll(node, deltaY)) return true;
    node = node.parentElement;
  }
  return false;
}

function onWheel(event) {
  if (event.ctrlKey) return;
  if (pathCanScroll(event.target, event.deltaY)) return;
  event.preventDefault();
}

function onTouchStart(event) {
  touchY = event.touches[0]?.clientY ?? 0;
}

function onTouchMove(event) {
  if (event.touches.length !== 1) return;
  const target = event.target;
  if (target instanceof Element && target.closest("[data-sheet-handle]")) return;
  const y = event.touches[0]?.clientY ?? touchY;
  const deltaY = touchY - y;
  if (pathCanScroll(target, deltaY)) {
    touchY = y;
    return;
  }
  event.preventDefault();
}

function pinLockedPage() {
  const root = pinnedRoot;
  if (!root) return;
  const offset = window.visualViewport?.offsetTop ?? 0;
  root.style.top = `${-savedY + offset}px`;
}

function onWindowScroll() {
  if (window.scrollY !== 0) window.scrollTo(0, 0);
  pinLockedPage();
}

function onFocusIn() {
  window.scrollTo(0, 0);
  pinLockedPage();
  requestAnimationFrame(() => {
    window.scrollTo(0, 0);
    pinLockedPage();
  });
}

function lockPage() {
  locks += 1;
  if (locks !== 1) return;
  savedY = window.scrollY;
  const html = document.documentElement;
  const root = document.getElementById("root");
  html.dataset.sheet = "1";
  html.style.overflow = "hidden";
  document.body.style.overflow = "hidden";
  pinnedRoot = root;
  if (root) {
    root.style.position = "fixed";
    root.style.left = "0";
    root.style.right = "0";
    root.style.width = "100%";
    pinLockedPage();
  }
  window.scrollTo(0, 0);
  document.addEventListener("wheel", onWheel, { capture: true, passive: false });
  document.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
  document.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
  document.addEventListener("focusin", onFocusIn, true);
  window.addEventListener("scroll", onWindowScroll, { capture: true });
  window.visualViewport?.addEventListener("scroll", pinLockedPage);
  window.visualViewport?.addEventListener("resize", pinLockedPage);
}

function unlockPage() {
  locks = Math.max(0, locks - 1);
  if (locks !== 0) return;
  const html = document.documentElement;
  const root = pinnedRoot;
  pinnedRoot = null;
  delete html.dataset.sheet;
  html.style.overflow = "";
  document.body.style.overflow = "";
  if (root) {
    root.style.position = "";
    root.style.top = "";
    root.style.left = "";
    root.style.right = "";
    root.style.width = "";
  }
  document.removeEventListener("wheel", onWheel, { capture: true });
  document.removeEventListener("touchstart", onTouchStart, { capture: true });
  document.removeEventListener("touchmove", onTouchMove, { capture: true });
  document.removeEventListener("focusin", onFocusIn, true);
  window.removeEventListener("scroll", onWindowScroll, { capture: true });
  window.visualViewport?.removeEventListener("scroll", pinLockedPage);
  window.visualViewport?.removeEventListener("resize", pinLockedPage);
  window.scrollTo(0, savedY);
}

function fitBackdrop(node) {
  const viewport = window.visualViewport;
  if (!viewport) {
    node.style.top = "0px";
    node.style.left = "0px";
    node.style.right = "0px";
    node.style.bottom = "0px";
    node.style.width = "";
    node.style.height = "";
    return;
  }
  const layoutBottom = Math.max(window.innerHeight, document.documentElement.clientHeight);
  node.style.top = `${viewport.offsetTop}px`;
  node.style.left = `${viewport.offsetLeft}px`;
  node.style.width = `${viewport.width}px`;
  node.style.height = `${Math.max(viewport.height, layoutBottom - viewport.offsetTop)}px`;
  node.style.right = "auto";
  node.style.bottom = "auto";
}

function mobileSheet() {
  return typeof window !== "undefined" && window.matchMedia(MOBILE).matches;
}

function exitMs() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return 0;
  return mobileSheet() ? EXIT_MS : DESKTOP_MS;
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
  const backdropRef = useRef(null);
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

  useLayoutEffect(() => {
    const node = backdropRef.current;
    if (!node) return undefined;
    const viewport = window.visualViewport;
    function sync() {
      fitBackdrop(node);
    }
    sync();
    viewport?.addEventListener("resize", sync);
    viewport?.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);
    return () => {
      viewport?.removeEventListener("resize", sync);
      viewport?.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);

  useEffect(() => {
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
    const timer = window.setTimeout(() => onCloseRef.current(), exitMs());
    return () => window.clearTimeout(timer);
  }, [leaving]);

  function dismiss() {
    if (leavingRef.current) return;
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
  const mobile = mobileSheet();
  const interact = ready || drag || leaving || offset > 0;
  const motion =
    interact && mobile
      ? {
          transform: leaving ? "translateY(100%)" : `translateY(${offset}px)`,
          transition: drag ? "none" : `transform ${EXIT_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`,
          animation: "none",
        }
      : undefined;
  const dimMotion =
    interact && mobile
      ? {
          opacity: leaving ? 0 : offset > 0 ? Math.max(0.12, 1 - offset / 400) : 1,
          transition: drag ? "none" : `opacity ${EXIT_MS}ms ease-out`,
          animation: "none",
        }
      : undefined;

  return createPortal(
    <div
      className={[styles.backdrop, leaving ? styles.leaving : ""].filter(Boolean).join(" ")}
      ref={backdropRef}
      onClick={dismiss}
    >
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
