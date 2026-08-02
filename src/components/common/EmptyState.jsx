export default function EmptyState({ title, children }) {
  return (
    <div className="empty">
      <h4>{title}</h4>
      <div>{children}</div>
    </div>
  );
}
