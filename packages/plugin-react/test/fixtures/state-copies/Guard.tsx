import { useEffect, useState } from "react";

/** `shouldBlock` follows `isDirty`, except that proceeding sets it to `false` until `isDirty` changes. */
export function LeaveGuard({ isDirty }: { isDirty: boolean }) {
  const [shouldBlock, setShouldBlock] = useState(isDirty);
  useEffect(() => {
    setShouldBlock(isDirty);
  }, [isDirty]);
  const handleProceed = () => {
    setShouldBlock(false);
  };
  return <button onClick={handleProceed}>{shouldBlock ? "Leave anyway" : "Leave"}</button>;
}
