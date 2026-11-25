import svg from "../../resources/monkey.svg";

/** Saru's painted monkey head (resources/monkey.svg, the same source as the app icon). */
export function Mark({ className, plain }: { className?: string; plain?: boolean }) {
  const style = plain ? ({ "--f-brush": "none", "--f-soft": "none" } as React.CSSProperties) : undefined;
  return <span className={`mark ${className ?? ""}`} style={style} aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />;
}
