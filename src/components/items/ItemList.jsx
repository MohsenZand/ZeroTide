import ItemCard from './ItemCard';

export default function ItemList({ items, onDelete }) {
  return (
    <div className="list">
      {items.map((it) => (
        <ItemCard key={it.id} intention={it} onDelete={onDelete} />
      ))}
    </div>
  );
}
