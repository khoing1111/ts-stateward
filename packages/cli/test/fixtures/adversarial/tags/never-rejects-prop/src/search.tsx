type Props = {
  /** Shows its own errors. @neverRejects */
  onSearch: (query: string) => Promise<void>;
};

export function Search({ onSearch }: Props) {
  return <input onChange={(event) => void onSearch(event.target.value)} />;
}
