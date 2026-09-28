import { localValue } from '../storage/local-value'

const squareNames = localValue('chess-trainer.square-names')

export function useSquareNames(): [boolean, (value: boolean) => void] {
  const value = squareNames.use()
  return [value === '1', (next) => squareNames.set(next ? '1' : '0')]
}

export function SquareNamesToggle() {
  const [value, setValue] = useSquareNames()
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input type="checkbox" checked={value} onChange={(event) => setValue(event.target.checked)} />
      Afficher le nom de chaque case
    </label>
  )
}
