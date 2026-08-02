export default function ZipCodeField({ value, onChange }) {
  return (
    <div className="field">
      <label htmlFor="zip">Your ZIP code</label>
      <input
        id="zip"
        type="text"
        inputMode="numeric"
        maxLength={5}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
        placeholder="10001"
      />
    </div>
  );
}
