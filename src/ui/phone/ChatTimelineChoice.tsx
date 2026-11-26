export function ChatTimelineChoice({
  value,
  onChange,
}: {
  value: 'discard' | 'keep';
  onChange: (value: 'discard' | 'keep') => void;
}) {
  return (
    <fieldset>
      <legend>失去原回合的待结算聊天</legend>
      <label>
        <input
          type="radio"
          name="phone-timeline"
          checked={value === 'discard'}
          onChange={() => onChange('discard')}
        />
        丢弃这些聊天
      </label>
      <label>
        <input
          type="radio"
          name="phone-timeline"
          checked={value === 'keep'}
          onChange={() => onChange('keep')}
        />
        保留，视为在恢复后的时间重新发生
      </label>
    </fieldset>
  );
}
