/** "DiffDoc." wordmark — display serif with the leaf-green full stop. */
export function Wordmark({ size = "text-2xl" }: { size?: string }) {
  return (
    <a href="/" className={`font-display font-bold tracking-tight text-ink ${size}`}>
      DiffDoc<span className="text-leaf">.</span>
    </a>
  );
}
