/** Version + build timestamp, stamped by next.config at build time. */
export function BuildStamp() {
  return (
    <span title="Application version and build time">
      v{process.env.NEXT_PUBLIC_APP_VERSION ?? "dev"}
      {process.env.NEXT_PUBLIC_BUILD_TIME && (
        <> · {process.env.NEXT_PUBLIC_BUILD_TIME}</>
      )}
    </span>
  );
}
