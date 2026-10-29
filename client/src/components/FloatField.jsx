import { cloneElement } from "react";
import styles from "./FloatField.module.scss";

export function FloatField({ label, className, children }) {
  const text = children.type === "input" || children.type === "textarea";
  const control = cloneElement(children, {
    className: [children.props.className, styles.control].filter(Boolean).join(" "),
    ...(text ? { placeholder: " " } : null),
  });

  const Tag = text ? "label" : "div";
  return (
    <Tag className={[styles.field, className].filter(Boolean).join(" ")}>
      {control}
      <span className={styles.hint} aria-hidden={text ? undefined : true}>
        {label}
      </span>
    </Tag>
  );
}
